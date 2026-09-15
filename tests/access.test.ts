import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { tmpDir, writeSite } from './helpers.js';

/** In-memory stand-in for the Cloudflare API: organizations, identity providers, access apps. */
function fakeCloudflareApi() {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  let org: { auth_domain: string } | null = null;
  const idps: { id: string; type: string }[] = [];
  const apps: { id: string; aud: string; domain: string; body: unknown }[] = [];
  const json = (result: unknown, status = 200) => new Response(JSON.stringify({ success: true, result }), { status });
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const p = url.pathname.replace(/^\/client\/v4/, '');
    calls.push({ method, path: p, body });
    if (p.endsWith('/workers/subdomain')) return json({ subdomain: 'example-sub' });
    if (p.endsWith('/access/organizations')) {
      if (method === 'GET')
        return org
          ? json(org)
          : new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: 'none' }] }), { status: 404 });
      org = { auth_domain: (body as { auth_domain: string }).auth_domain };
      return json(org);
    }
    if (p.endsWith('/access/identity_providers')) {
      if (method === 'GET') return json(idps);
      const idp = { id: `idp-${idps.length + 1}`, type: (body as { type: string }).type };
      idps.push(idp);
      return json(idp);
    }
    if (p.endsWith('/access/apps')) {
      if (method === 'GET') return json(apps.map((a) => ({ id: a.id, domain: a.domain })));
      const app = { id: `app-${apps.length + 1}`, aud: `aud-${apps.length + 1}`, domain: (body as { domain: string }).domain, body };
      apps.push(app);
      return json(app);
    }
    const m = p.match(/\/access\/apps\/([^/]+)$/);
    if (m) {
      const app = apps.find((a) => a.id === m[1])!;
      if (method === 'PUT') {
        app.body = body;
        return json({ id: app.id, aud: app.aud });
      }
      if (method === 'DELETE') {
        apps.splice(apps.indexOf(app), 1);
        return json({ id: app.id });
      }
    }
    return new Response('not found', { status: 404 });
  });
  return {
    fetchImpl,
    calls,
    state: {
      get org() {
        return org;
      },
      idps,
      apps,
    },
  };
}

describe('Cloudflare Access', () => {
  let home: string;
  let site: string;
  const api = fakeCloudflareApi();

  beforeAll(() => {
    home = tmpDir();
    site = tmpDir('cloudfact-site-');
    writeSite(site);
    process.env.CLOUDFACT_HOME = home;
    process.env.CLOUDFLARE_API_TOKEN = 'test-token';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acc123';
    process.env.FAKE_WRANGLER_LOG = path.join(home, 'wrangler.log');
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ wranglerCommand: path.resolve('tests/fixtures/fake-wrangler.sh') }));
    vi.stubGlobal('fetch', api.fetchImpl);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(site, { recursive: true, force: true });
  });

  it('creates the team, the one-time PIN provider and the app; deploys the worker in access mode', async () => {
    const { deploy } = await import('../src/cloudfact.js');
    const r = await deploy({
      path: site,
      name: 'team-site',
      backend: 'workers',
      access: ['Ana@Example.com', 'bob@example.com', 'ana@example.com'],
    });
    expect(r.url).toBe('https://team-site.example-sub.workers.dev');
    expect(r.privateUrl).toBeNull(); // identity replaces the key link
    expect(r.access).toEqual({
      appId: 'app-1',
      aud: 'aud-1',
      domain: 'team-site.example-sub.workers.dev',
      emails: ['ana@example.com', 'bob@example.com'],
      teamDomain: 'cloudfact-acc123.cloudflareaccess.com',
    });
    expect(api.state.org?.auth_domain).toBe('cloudfact-acc123.cloudflareaccess.com');
    expect(api.state.idps.map((i) => i.type)).toEqual(['onetimepin']);
    const app = api.state.apps[0].body as { type: string; domain: string; policies: { include: { email: { email: string } }[] }[] };
    expect(app.type).toBe('self_hosted');
    expect(app.domain).toBe('team-site.example-sub.workers.dev');
    expect(app.policies[0].include.map((i) => i.email.email)).toEqual(['ana@example.com', 'bob@example.com']);
    const log = fs.readFileSync(path.join(home, 'wrangler.log'), 'utf8');
    expect(log).toContain(
      '--var CLOUDFACT_ACCESS:1 --var CLOUDFACT_ACCESS_AUD:aud-1 --var CLOUDFACT_ACCESS_TEAM:cloudfact-acc123.cloudflareaccess.com',
    );
    expect(log).not.toContain('secret put');
    expect(log.split('\n').filter((l) => l.startsWith('deploy'))).toHaveLength(1); // app created first: no second deploy needed
  });

  it('redeploy updates the existing app (PUT) instead of creating another', async () => {
    const { deploy } = await import('../src/cloudfact.js');
    await deploy({ path: site, name: 'team-site', backend: 'workers', access: ['carol@example.com'] });
    expect(api.state.apps).toHaveLength(1);
    expect(api.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  });

  it('remove deletes the worker and the access app', async () => {
    const { remove } = await import('../src/cloudfact.js');
    const r = await remove('team-site');
    expect(r.remote).toBe('worker deleted; access app deleted');
    expect(api.state.apps).toHaveLength(0);
  });

  it('--access on the tunnel backend is refused with guidance', async () => {
    const { deploy } = await import('../src/cloudfact.js');
    await expect(deploy({ path: site, backend: 'tunnel', access: ['x@y.z'] })).rejects.toThrow(/workers backend/);
  });
});

describe('Access without an API token', () => {
  it('explains how to get one', async () => {
    const { accessContext } = await import('../src/services/access.js');
    expect(() => accessContext({})).toThrow(/cloudfact login --token/);
  });
});
