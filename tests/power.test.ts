import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGate } from '../src/backends/tunnel/gate.js';
import { createPowerSwitch } from '../src/backends/tunnel/power.js';
import { createStaticHandler } from '../src/backends/tunnel/static-server.js';
import type { CatalogEntry, CatalogResult, DeployState } from '../src/types.js';
import { tmpDir, writeSite } from './helpers.js';

const CONTROL = 'c'.repeat(43);
const KEY = 'k'.repeat(43);

let home: string;
beforeAll(() => {
  home = tmpDir();
  process.env.CLOUDFACT_HOME = home;
  process.env.CLOUDFACT_NO_CATALOG_REFRESH = '1';
});
afterAll(() => {
  delete process.env.CLOUDFACT_NO_CATALOG_REFRESH;
  fs.rmSync(home, { recursive: true, force: true });
});

function writeDeploy(state: Partial<DeployState> & { name: string }): void {
  const dir = path.join(home, 'deploys', state.name);
  fs.mkdirSync(dir, { recursive: true });
  const full = { backend: 'tunnel', mode: 'dir', root: null, file: null, status: 'running', startedAt: '2026-09-25T09:00:00Z', ...state };
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(full));
}
const readDeploy = (name: string): DeployState => JSON.parse(fs.readFileSync(path.join(home, 'deploys', name, 'state.json'), 'utf8'));

/** A tunnel host's server, wired like host.ts: the switch first, then the gate and the files. */
async function hostServer(state: { off: boolean; controlKey: string | null; key: string | null }, onSet?: (off: boolean) => void) {
  const root = tmpDir('cloudfact-site-');
  writeSite(root);
  const power = createPowerSwitch({
    get: () => state,
    set: (off) => {
      state.off = off;
      onSet?.(off);
    },
  });
  const gate = createGate({ getKey: () => ({ key: state.key }) });
  const files = createStaticHandler({ mode: 'dir', root, gate });
  const server = http.createServer((req, res) => {
    if (!power.handle(req, res)) files(req, res);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    base,
    close: () => {
      server.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

describe('the switch on a tunnel host', () => {
  const state = { off: false, controlKey: CONTROL as string | null, key: null as string | null };
  let host: Awaited<ReturnType<typeof hostServer>>;
  beforeAll(async () => {
    host = await hostServer(state);
  });
  afterAll(() => host.close());

  const flip = (on: unknown, key = CONTROL) =>
    fetch(`${host.base}/.cloudfact/power`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ on }),
    });

  it('answers only to the control key', async () => {
    expect((await fetch(`${host.base}/.cloudfact/power`)).status).toBe(401);
    expect((await flip(false, KEY)).status).toBe(401); // the private key opens the page, it does not switch it
    const res = await fetch(`${host.base}/.cloudfact/power`, { headers: { Authorization: `Bearer ${CONTROL}` } });
    expect(await res.json()).toEqual({ on: true });
    expect(state.off).toBe(false);
  });

  it('turned off, every route answers the off page; the same link comes back when turned on', async () => {
    expect(await (await fetch(`${host.base}/`)).text()).toContain('<h1>home</h1>');
    const off = await flip(false);
    expect(await off.json()).toEqual({ on: false });
    const page = await fetch(`${host.base}/`);
    expect(page.status).toBe(503);
    expect(await page.text()).toContain('This page is off');
    expect((await fetch(`${host.base}/style.css`)).status).toBe(503);
    expect((await fetch(`${host.base}/.cloudfact/power`, { headers: { Authorization: `Bearer ${CONTROL}` } })).status).toBe(200);

    expect(await (await flip(true)).json()).toEqual({ on: true });
    expect(await (await fetch(`${host.base}/`)).text()).toContain('<h1>home</h1>');
  });

  it('keeps the gate out of reach while off', async () => {
    state.key = KEY;
    await flip(false);
    const session = await fetch(`${host.base}/api/session`, { method: 'POST', headers: { Authorization: `Bearer ${KEY}` } });
    expect(session.status).toBe(503);
    await flip(true);
    expect((await fetch(`${host.base}/api/session`, { method: 'POST', headers: { Authorization: `Bearer ${KEY}` } })).status).toBe(204);
    state.key = null;
  });

  it('refuses a malformed flip', async () => {
    expect((await flip('yes')).status).toBe(400);
    const put = await fetch(`${host.base}/.cloudfact/power`, { method: 'PUT', headers: { Authorization: `Bearer ${CONTROL}` } });
    expect(put.status).toBe(405);
    expect(state.off).toBe(false);
  });

  it('a deploy from before the switch has no control key: the path stays the site’s', async () => {
    state.controlKey = null;
    try {
      const res = await fetch(`${host.base}/.cloudfact/power`, { headers: { Authorization: `Bearer ${CONTROL}` } });
      expect(res.status).toBe(404); // the static server refuses dotfiles, as it always did
    } finally {
      state.controlKey = CONTROL;
    }
  });
});

describe('power() on a tunnel', () => {
  it('asks the host, which records the switch itself', async () => {
    const recorded: boolean[] = [];
    const host = await hostServer({ off: false, controlKey: CONTROL, key: null }, (off) => recorded.push(off));
    try {
      writeDeploy({ name: 'tun-live', hostPid: process.pid, local: host.base, controlKey: CONTROL, url: 'https://x.trycloudflare.com' });
      const { power } = await import('../src/cloudfact.js');
      expect(await power('tun-live', false)).toEqual({ name: 'tun-live', on: false });
      expect(await power('tun-live', true)).toEqual({ name: 'tun-live', on: true });
      expect(recorded).toEqual([true, false]);
    } finally {
      host.close();
    }
  });

  it('writes the state file when the host does not answer here', async () => {
    writeDeploy({ name: 'tun-quiet', hostPid: process.pid, local: 'http://127.0.0.1:9', controlKey: CONTROL });
    const { power } = await import('../src/cloudfact.js');
    expect((await power('tun-quiet', false)).on).toBe(false);
    expect(readDeploy('tun-quiet').off).toBe(true);
  });

  it('a stopped tunnel is simply recorded, with a word on how to start it', async () => {
    writeDeploy({ name: 'tun-stopped', status: 'stopped', mode: 'proxy', controlKey: CONTROL });
    const { power } = await import('../src/cloudfact.js');
    expect(await power('tun-stopped', false)).toMatchObject({ on: false, note: 'not running' });
    expect(readDeploy('tun-stopped').off).toBe(true);
    expect((await power('tun-stopped', true)).note).toContain('cloudfact expose');
    expect(readDeploy('tun-stopped').off).toBe(false);
  });

  it('a host started by an older cloudfact has no switch, and says what to do instead', async () => {
    writeDeploy({ name: 'tun-old', hostPid: process.pid, local: 'http://127.0.0.1:9' });
    const { power } = await import('../src/cloudfact.js');
    await expect(power('tun-old', false)).rejects.toThrow(/older cloudfact.*cloudfact stop tun-old/);
    expect(readDeploy('tun-old').off).toBeUndefined();
  });

  it('never shows the control key', async () => {
    const { status, listDeploys, summarize } = await import('../src/cloudfact.js');
    expect(JSON.stringify(await status('tun-live', { check: false }))).not.toContain(CONTROL);
    expect(JSON.stringify(listDeploys().map(summarize))).not.toContain(CONTROL);
  });
});

/** Just enough of the Cloudflare API for switching Workers: tags, the workers.dev address, the listing. */
function fakeWorkersApi(tags: Record<string, string[] | null>) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const subdomain: Record<string, { enabled: boolean; previews_enabled: boolean }> = {};
  const json = (result: unknown) => new Response(JSON.stringify({ success: true, result }));
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const p = new URL(String(input)).pathname.replace(/^\/client\/v4\/accounts\/acc123/, '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: p, body });
    const m = /^\/workers\/scripts\/([^/]+)\/(tags|subdomain)$/.exec(p);
    if (m) {
      const name = decodeURIComponent(m[1]);
      if (!(name in tags))
        return new Response(JSON.stringify({ success: false, errors: [{ code: 10007, message: 'This Worker does not exist' }] }), {
          status: 404,
        });
      if (m[2] === 'tags') {
        if (method === 'PUT') tags[name] = body;
        return json(tags[name]);
      }
      subdomain[name] = body;
      return json(body);
    }
    if (p === '/workers/scripts') return json(Object.entries(tags).map(([id, t]) => ({ id, tags: t })));
    return new Response('not found', { status: 404 });
  });
  return { fetchImpl, calls, tags, subdomain };
}

describe('power() on a Worker', () => {
  const api = fakeWorkersApi({ site: ['cloudfact', 'cloudfact:vis:private'], 'not-mine': [], 'old-one': null });
  beforeAll(() => {
    process.env.CLOUDFLARE_API_TOKEN = 'test-token';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acc123';
    vi.stubGlobal('fetch', api.fetchImpl);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
  });

  it('turning off disables the workers.dev address (previews too) and tags it; on undoes both', async () => {
    const { power } = await import('../src/cloudfact.js');
    expect(await power('site', false)).toEqual({ name: 'site', on: false });
    expect(api.subdomain.site).toEqual({ enabled: false, previews_enabled: false });
    expect(api.tags.site).toEqual(['cloudfact', 'cloudfact:vis:private', 'cloudfact:off']);
    await power('site', false); // idempotent: one off tag, not two
    expect(api.tags.site).toEqual(['cloudfact', 'cloudfact:vis:private', 'cloudfact:off']);

    await power('site', true);
    expect(api.subdomain.site).toEqual({ enabled: true, previews_enabled: false });
    expect(api.tags.site).toEqual(['cloudfact', 'cloudfact:vis:private']);
  });

  it('leaves alone a Worker that is not a cloudfact', async () => {
    const { power } = await import('../src/cloudfact.js');
    await expect(power('not-mine', false)).rejects.toThrow(/not a cloudfact/);
    expect(api.subdomain['not-mine']).toBeUndefined();
  });

  it('switches an older deploy without tags when this machine knows it', async () => {
    writeDeploy({ name: 'old-one', backend: 'workers', status: 'deployed' });
    const { power } = await import('../src/cloudfact.js');
    await power('old-one', false);
    expect(api.subdomain['old-one']).toEqual({ enabled: false, previews_enabled: false });
    expect(api.tags['old-one']).toEqual(['cloudfact:off']);
  });

  it('the catalog says what is off, and filing it under a project keeps it off', async () => {
    const { power, catalog, setProject } = await import('../src/cloudfact.js');
    await power('site', false);
    const all = async () => (await catalog()).projects.flatMap((p) => p.deploys);
    expect((await all()).find((d) => d.name === 'site')?.off).toBe(true);
    expect((await all()).find((d) => d.name === 'tun-quiet')?.off).toBe(true); // a tunnel, from its own record
    await setProject('site', 'prototipos');
    expect(api.tags.site).toEqual(expect.arrayContaining(['cloudfact:project:prototipos', 'cloudfact:off']));
    await power('site', true);
    expect((await all()).find((d) => d.name === 'site')?.off).toBe(false);
  });

  it('reports a name the account does not have', async () => {
    const { power } = await import('../src/cloudfact.js');
    await expect(power('ghost', false)).rejects.toThrow(/does not exist/);
  });
});

const entry = (over: Partial<CatalogEntry> & { name: string }): CatalogEntry => ({
  project: null,
  url: `https://${over.name}.example-sub.workers.dev`,
  inAccount: true,
  local: false,
  access: null,
  visibility: 'private',
  kind: 'static',
  hasAssets: true,
  createdAt: null,
  modifiedAt: null,
  backend: 'workers',
  status: 'deployed',
  off: false,
  ...over,
});
const catalogOf = (deploys: CatalogEntry[]): CatalogResult => ({
  accountId: 'acc123',
  accountName: null,
  subdomain: 'example-sub',
  projects: [{ project: null, deploys }],
});

describe('what the catalog page may switch', () => {
  it('account Workers and live tunnels with a switch; never the page itself, nor what this machine does not know', async () => {
    const { withControl } = await import('../src/cloudfact.js');
    const c = catalogOf([
      entry({ name: 'site' }),
      entry({ name: 'cloudfacts' }),
      entry({ name: 'tun', inAccount: false, backend: 'tunnel', url: 'https://tun.trycloudflare.com' }),
      entry({ name: 'tun-old', inAccount: false, backend: 'tunnel' }),
      entry({ name: 'tun-dead', inAccount: false, backend: 'tunnel' }),
      entry({ name: 'found-here', inAccount: false, backend: 'tunnel', untracked: true }),
    ]);
    const live = { backend: 'tunnel', status: 'running', url: 'https://tun.trycloudflare.com' } as const;
    const states = new Map<string, DeployState>([
      ['tun', { ...live, name: 'tun', controlKey: CONTROL } as DeployState],
      ['tun-old', { ...live, name: 'tun-old' } as DeployState],
      ['tun-dead', { ...live, name: 'tun-dead', status: 'dead', url: null, controlKey: CONTROL } as DeployState],
    ]);
    expect(withControl(c, states, 'cloudfacts')).toEqual({
      workers: ['site'],
      tunnels: { tun: { url: 'https://tun.trycloudflare.com', key: CONTROL } },
    });
    const switchable = c.projects[0].deploys.filter((d) => d.switchable).map((d) => d.name);
    expect(switchable).toEqual(['site', 'tun']);
  });

  it('the page carries the switch only when published with it, and what is off goes last', async () => {
    const { galleryHtml } = await import('../src/services/gallery.js');
    const c = catalogOf([
      entry({ name: 'resting', off: true, switchable: true }),
      entry({ name: 'awake', switchable: true }),
      entry({ name: 'shown' }),
    ]);
    const html = galleryHtml(c, { control: true });
    expect(html).toContain('<body data-control="1">');
    expect(html).toContain('aria-label="Turn off awake"');
    expect(html).toContain('aria-label="Turn off resting"');
    expect(html).not.toContain('aria-label="Turn off shown"'); // not on the list the Worker got
    expect(html).toContain('<div class="card off" data-name="resting" data-switch="1"');
    expect(html.indexOf('data-name="awake"')).toBeLessThan(html.indexOf('data-name="resting"'));

    const plain = galleryHtml(c);
    expect(plain).toContain('</head><body>');
    expect(plain).not.toContain('data-switch="1"');
    expect(plain).not.toContain('aria-label="Turn off');
    expect(plain).toContain('<div class="card off" data-name="resting"'); // still says it is off
  });
});
