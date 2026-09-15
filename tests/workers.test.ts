import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tmpDir, writeSite } from './helpers.js';

let home: string;
let site: string;
let wranglerLog: string;
beforeAll(() => {
  home = tmpDir();
  site = tmpDir('cloudfact-site-');
  writeSite(site);
  fs.mkdirSync(path.join(site, 'node_modules'));
  fs.writeFileSync(path.join(site, 'node_modules', 'x.js'), '');
  wranglerLog = path.join(home, 'fake-wrangler.log');
  process.env.CLOUDFACT_HOME = home;
  process.env.CLOUDFLARE_API_TOKEN = 'test-token';
  process.env.FAKE_WRANGLER_LOG = wranglerLog;
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ wranglerCommand: path.resolve('tests/fixtures/fake-wrangler.sh') }));
});
afterAll(() => {
  delete process.env.CLOUDFLARE_API_TOKEN;
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(site, { recursive: true, force: true });
});

describe('workers backend (fake wrangler)', () => {
  it('publishes a copy without dotfiles/node_modules and extracts the URL (public)', async () => {
    const { deploy } = await import('../src/cloudfact.js');
    const r = await deploy({ path: site, name: 'meu-site', backend: 'workers', public: true });
    expect(r.backend).toBe('workers');
    expect(r.status).toBe('deployed');
    expect(r.url).toBe('https://meu-site.example-sub.workers.dev');
    expect(r.versionId).toMatch(/^0000/);
    expect(r.files).toBe(3); // index.html, sub/index.html, style.css
    const staged = path.join(home, 'deploys', 'meu-site', 'site');
    expect(fs.existsSync(path.join(staged, '.secret'))).toBe(false);
    expect(fs.existsSync(path.join(staged, 'node_modules'))).toBe(false);
    expect(fs.readFileSync(wranglerLog, 'utf8')).toContain('deploy --name meu-site --assets');
    expect(r.privateUrl).toBeNull();
  });
  it('private by default: gate worker + secret, privateUrl with key', async () => {
    const { deploy } = await import('../src/cloudfact.js');
    const r = await deploy({ path: site, name: 'priv-site', backend: 'workers', expires: '1h' });
    expect(r.url).toBe('https://priv-site.example-sub.workers.dev');
    expect(r.privateUrl).toMatch(/^https:\/\/priv-site\.example-sub\.workers\.dev\/#key=[A-Za-z0-9_-]{43}$/);
    expect(r.keyExpiresAt).toBeTruthy();
    const workerDir = path.join(home, 'deploys', 'priv-site', 'worker');
    expect(fs.existsSync(path.join(workerDir, 'index.js'))).toBe(true);
    const cfg = JSON.parse(fs.readFileSync(path.join(workerDir, 'wrangler.jsonc'), 'utf8'));
    expect(cfg.assets.run_worker_first).toBe(true);
    const log = fs.readFileSync(wranglerLog, 'utf8');
    expect(log).toContain('deploy --config');
    expect(log).toContain('--var CLOUDFACT_KEY_EXPIRES:');
    expect(log).toContain('secret put CLOUDFACT_KEY --name priv-site');
  });
  it('rotate on a private workers deploy uploads a new secret without redeploy', async () => {
    const { rotate } = await import('../src/cloudfact.js');
    const before = fs.readFileSync(wranglerLog, 'utf8').split('\n').length;
    const r = await rotate('priv-site');
    expect(r.privateUrl).toMatch(/#key=/);
    const lines = fs
      .readFileSync(wranglerLog, 'utf8')
      .split('\n')
      .slice(before - 1)
      .filter(Boolean);
    expect(lines.some((l) => l.startsWith('secret put CLOUDFACT_KEY'))).toBe(true);
    expect(lines.some((l) => l.startsWith('deploy'))).toBe(true); // expiry var reset requires a deploy
  });
  it('a single file becomes index.html', async () => {
    const { deploy } = await import('../src/cloudfact.js');
    const file = path.join(site, 'sub', 'index.html');
    const r = await deploy({ path: file, name: 'single-file', backend: 'workers', public: true });
    expect(r.files).toBe(1);
    expect(fs.existsSync(path.join(home, 'deploys', 'single-file', 'site', 'index.html'))).toBe(true);
  });
  it('backend aliases resolve', async () => {
    const { resolveBackend } = await import('../src/cloudfact.js');
    expect(resolveBackend('pages')).toBe('workers');
    expect(resolveBackend('auto')).toBe('workers'); // token in env
  });
  it('remove deletes the worker and the record', async () => {
    const { remove, listDeploys } = await import('../src/cloudfact.js');
    const r = await remove('meu-site');
    expect(r.remote).toBe('worker deleted');
    expect(fs.readFileSync(wranglerLog, 'utf8')).toContain('delete --name meu-site --force');
    expect(
      listDeploys()
        .map((s) => s.name)
        .sort(),
    ).toEqual(['priv-site', 'single-file']);
  });
});
