import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fakeCloudflareApi } from './fake-cloudflare.js';
import { tmpDir, writeSite } from './helpers.js';

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
    expect(api.calls.filter((c) => c.method === 'PUT' && c.path.includes('/access/apps/'))).toHaveLength(1);
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
