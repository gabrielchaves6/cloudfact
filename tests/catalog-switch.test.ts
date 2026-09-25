import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fakeCloudflareApi } from './fake-cloudflare.js';
import { tmpDir, writeSite } from './helpers.js';

describe('the switch on the catalog page', () => {
  let home: string;
  let site: string;
  let log: string;
  const api = fakeCloudflareApi();
  const targets = { workers: ['site'], tunnels: {} };
  const stateOf = (name: string) => JSON.parse(fs.readFileSync(path.join(home, 'deploys', name, 'state.json'), 'utf8'));

  beforeAll(() => {
    home = tmpDir();
    site = tmpDir('cloudfact-site-');
    writeSite(site);
    log = path.join(home, 'wrangler.log');
    process.env.CLOUDFACT_HOME = home;
    process.env.CLOUDFLARE_API_TOKEN = 'test-token';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acc123';
    process.env.FAKE_WRANGLER_LOG = log;
    process.env.CLOUDFACT_NO_CATALOG_REFRESH = '1';
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ wranglerCommand: path.resolve('tests/fixtures/fake-wrangler.sh') }));
    vi.stubGlobal('fetch', api.fetchImpl);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFACT_NO_CATALOG_REFRESH;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(site, { recursive: true, force: true });
  });

  it('ships the API token and the list as secrets of the version itself, and leaves no file behind', async () => {
    const { deployWorkers } = await import('../src/backends/workers/index.js');
    const control = { accountId: 'acc123', token: 'test-token', targets };
    await deployWorkers({ name: 'panel', mode: 'dir', root: site, file: null, private: true, access: ['me@example.com'], control });
    const lines = fs.readFileSync(log, 'utf8');
    expect(lines).toMatch(
      /deploy --config \S+ --var CLOUDFACT_ACCESS:1 .* --var CLOUDFACT_CONTROL:1 --var CLOUDFACT_ACCOUNT_ID:acc123 --secrets-file \S+/,
    );
    const secrets = JSON.parse(fs.readFileSync(`${log}.secrets`, 'utf8'));
    expect(secrets.CLOUDFACT_API_TOKEN).toBe('test-token');
    expect(JSON.parse(secrets.CLOUDFACT_CONTROL_TARGETS)).toEqual(targets);
    expect(fs.existsSync(path.join(home, 'deploys', 'panel', 'worker', '.control-secrets.json'))).toBe(false);
    expect(lines).not.toContain('test-token'); // never on a command line
    expect(fs.readFileSync(path.join(home, 'deploys', 'panel', 'wrangler.log'), 'utf8')).not.toContain('test-token');
    expect(stateOf('panel').control).toBe(true);
  });

  it('republished without it, the token is taken out of the Worker', async () => {
    const { deployWorkers } = await import('../src/backends/workers/index.js');
    await deployWorkers({ name: 'panel', mode: 'dir', root: site, file: null, private: true, access: ['me@example.com'] });
    expect(fs.readFileSync(log, 'utf8')).toContain('secret bulk --name panel');
    expect(JSON.parse(fs.readFileSync(`${log}.bulk`, 'utf8'))).toEqual({ CLOUDFACT_API_TOKEN: null, CLOUDFACT_CONTROL_TARGETS: null });
    expect(stateOf('panel').control).toBe(false);
  });

  it('never in front of a key link', async () => {
    const { deployWorkers } = await import('../src/backends/workers/index.js');
    const control = { accountId: 'acc123', token: 'test-token', targets };
    await deployWorkers({ name: 'keyed', mode: 'dir', root: site, file: null, private: true, key: 'k'.repeat(43), control });
    const keyed = fs
      .readFileSync(log, 'utf8')
      .split('\n')
      .filter((l) => l.includes('keyed'));
    expect(keyed.join('\n')).not.toMatch(/CLOUDFACT_CONTROL|secrets-file/);
    expect(stateOf('keyed').control).toBe(false);
  });

  it('publishing the catalog behind sign-in gives the page the switch for the account, never for itself', async () => {
    const { publishCatalog } = await import('../src/cloudfact.js');
    await publishCatalog({ name: 'cloudfacts' });
    const html = fs.readFileSync(path.join(home, 'catalog', 'index.html'), 'utf8');
    expect(html).toContain('<body data-control="1">');
    expect(html).toContain('aria-label="Turn off site"');
    expect(html).not.toContain('aria-label="Turn off cloudfacts"');
    const secrets = JSON.parse(fs.readFileSync(`${log}.secrets`, 'utf8'));
    expect(JSON.parse(secrets.CLOUDFACT_CONTROL_TARGETS)).toEqual({ workers: ['site'], tunnels: {} });
  });

  it('a catalog open to anyone has no switch and no token', async () => {
    const { publishCatalog } = await import('../src/cloudfact.js');
    fs.rmSync(`${log}.secrets`, { force: true });
    await publishCatalog({ name: 'open-catalog', public: true });
    const html = fs.readFileSync(path.join(home, 'catalog', 'index.html'), 'utf8');
    expect(html).toContain('</head><body>');
    expect(html).not.toContain('aria-label="Turn off');
    expect(fs.existsSync(`${log}.secrets`)).toBe(false);
  });
});
