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

describe('backend workers (wrangler simulado)', () => {
  it('publica uma cópia sem dotfiles/node_modules e extrai a URL', async () => {
    const { deploy } = await import('../src/cloudfact.js');
    const r = await deploy({ path: site, name: 'meu-site', backend: 'workers' });
    expect(r.backend).toBe('workers');
    expect(r.status).toBe('deployed');
    expect(r.url).toBe('https://meu-site.example-sub.workers.dev');
    expect(r.versionId).toMatch(/^0000/);
    expect(r.files).toBe(3); // index.html, sub/index.html, style.css
    const staged = path.join(home, 'deploys', 'meu-site', 'site');
    expect(fs.existsSync(path.join(staged, '.secret'))).toBe(false);
    expect(fs.existsSync(path.join(staged, 'node_modules'))).toBe(false);
    expect(fs.readFileSync(wranglerLog, 'utf8')).toContain('deploy --name meu-site --assets');
  });
  it('arquivo único vira index.html', async () => {
    const { deploy } = await import('../src/cloudfact.js');
    const file = path.join(site, 'sub', 'index.html');
    const r = await deploy({ path: file, name: 'um-arquivo', backend: 'workers' });
    expect(r.files).toBe(1);
    expect(fs.existsSync(path.join(home, 'deploys', 'um-arquivo', 'site', 'index.html'))).toBe(true);
  });
  it('private força tunnel, então não chega no wrangler', async () => {
    const { resolveBackend } = await import('../src/cloudfact.js');
    expect(resolveBackend('pages')).toBe('workers');
    expect(resolveBackend('auto')).toBe('workers'); // token no env
  });
  it('remove apaga o worker e o registro', async () => {
    const { remove, listDeploys } = await import('../src/cloudfact.js');
    const r = await remove('meu-site');
    expect(r.remote).toBe('worker apagado');
    expect(fs.readFileSync(wranglerLog, 'utf8')).toContain('delete --name meu-site --force');
    expect(listDeploys().map((s) => s.name)).toEqual(['um-arquivo']);
  });
});
