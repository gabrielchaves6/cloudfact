import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DeployState } from '../src/types.js';
import { tmpDir } from './helpers.js';

let home: string;
const children: ChildProcess[] = [];
beforeAll(() => {
  home = tmpDir();
  process.env.CLOUDFACT_HOME = home;
  process.env.CLOUDFACT_NO_CATALOG_REFRESH = '1';
  process.env.CLOUDFLARE_API_TOKEN = 'test-token';
  process.env.CLOUDFLARE_ACCOUNT_ID = 'acc123';
});
afterAll(() => {
  vi.unstubAllGlobals();
  for (const c of children) c.kill();
  delete process.env.CLOUDFACT_NO_CATALOG_REFRESH;
  delete process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  fs.rmSync(home, { recursive: true, force: true });
});

function writeDeploy(state: Partial<DeployState> & { name: string }): void {
  const dir = path.join(home, 'deploys', state.name);
  fs.mkdirSync(dir, { recursive: true });
  const full = { backend: 'tunnel', mode: 'dir', root: null, file: null, status: 'running', startedAt: '2026-09-25T09:00:00Z', ...state };
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(full));
}
const readDeploy = (name: string): DeployState => JSON.parse(fs.readFileSync(path.join(home, 'deploys', name, 'state.json'), 'utf8'));
const parked = (): string[] | undefined => JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')).parked;

/** Stands in for a tunnel host: a process for stopTunnel() to end. */
function fakeHost(): number {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  children.push(child);
  return child.pid!;
}

/** Just enough of the Cloudflare API: tags, the workers.dev address and the listing the catalog reads. */
function fakeWorkersApi(tags: Record<string, string[]>) {
  const subdomain: Record<string, { enabled: boolean }> = {};
  const json = (result: unknown) => new Response(JSON.stringify({ success: true, result }));
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const p = new URL(String(input)).pathname.replace(/^\/client\/v4\/accounts\/acc123/, '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const m = /^\/workers\/scripts\/([^/]+)\/(tags|subdomain)$/.exec(p);
    if (m) {
      const name = decodeURIComponent(m[1]);
      if (m[2] === 'tags') {
        if (method === 'PUT') tags[name] = body;
        return json(tags[name] ?? []);
      }
      subdomain[name] = body;
      return json(body);
    }
    if (p === '/workers/scripts') return json(Object.entries(tags).map(([id, t]) => ({ id, tags: t })));
    return new Response(JSON.stringify({ success: false, errors: [{ code: 7003, message: 'no route' }] }), { status: 404 });
  });
  return { fetchImpl, tags, subdomain };
}

describe('cloudfact off / on without a name', () => {
  const api = fakeWorkersApi({ site: ['cloudfact'], resting: ['cloudfact', 'cloudfact:off'] });
  beforeAll(() => {
    vi.stubGlobal('fetch', api.fetchImpl);
    writeDeploy({ name: 'tun', hostPid: fakeHost(), url: 'https://a.trycloudflare.com', controlKey: 'c' });
    writeDeploy({ name: 'tun-paused', hostPid: fakeHost(), url: 'https://b.trycloudflare.com', controlKey: 'c', off: true });
    writeDeploy({ name: 'tun-stopped', status: 'stopped' });
    writeDeploy({ name: 'site', backend: 'workers', status: 'deployed', url: 'https://site.example-sub.workers.dev' });
    writeDeploy({ name: 'resting', backend: 'workers', status: 'deployed' });
  });

  it('off leaves nothing running, and remembers only what it turned off', async () => {
    const { powerMachine } = await import('../src/cloudfact.js');
    const r = await powerMachine(false);
    expect(r.failed).toEqual([]);
    expect(r.switched.map((s) => s.name).sort()).toEqual(['site', 'tun', 'tun-paused']);
    expect(r.switched.find((s) => s.name === 'tun-paused')?.note).toContain('stays off');
    expect(readDeploy('tun').status).toBe('stopped');
    expect(readDeploy('tun-paused').status).toBe('stopped');
    expect(api.subdomain.site).toEqual({ enabled: false, previews_enabled: false });
    expect(api.subdomain.resting).toBeUndefined(); // already off on its own: not touched
    expect(parked()?.sort()).toEqual(['site', 'tun']);
  });

  it('off twice forgets nothing', async () => {
    const { powerMachine } = await import('../src/cloudfact.js');
    expect((await powerMachine(false)).switched).toEqual([]);
    expect(parked()?.sort()).toEqual(['site', 'tun']);
  });

  it('on brings back what off turned off, and keeps what it could not for the next try', async () => {
    writeDeploy({ ...readDeploy('tun'), key: 'k', keyExpiresAt: '2026-01-01T00:00:00Z' }); // a tunnel that cannot start again
    const { powerMachine } = await import('../src/cloudfact.js');
    const r = await powerMachine(true);
    expect(r.failed).toEqual([]);
    expect(r.switched).toEqual([
      { name: 'site', backend: 'workers', url: 'https://site.example-sub.workers.dev' },
      { name: 'tun', backend: 'tunnel', note: expect.stringContaining('expired') },
    ]);
    expect(api.subdomain.site).toEqual({ enabled: true, previews_enabled: false });
    expect(api.tags.site).toEqual(['cloudfact']);
    expect(api.subdomain.resting).toBeUndefined();
    expect(parked()).toEqual([]);
  });

  it('a Worker that cannot be switched is reported and stays parked', async () => {
    const { powerMachine } = await import('../src/cloudfact.js');
    await powerMachine(false);
    delete process.env.CLOUDFLARE_API_TOKEN;
    try {
      const r = await powerMachine(true);
      expect(r.failed).toEqual([{ name: 'site', error: expect.stringMatching(/not signed in/) }]);
      expect(parked()).toEqual(['site']);
    } finally {
      process.env.CLOUDFLARE_API_TOKEN = 'test-token';
    }
    expect((await powerMachine(true)).switched.map((s) => s.name)).toEqual(['site']);
    expect(parked()).toEqual([]);
  });
});
