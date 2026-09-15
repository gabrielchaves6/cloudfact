import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStaticHandler, safeResolve } from '../src/backends/tunnel/static-server.js';
import { tmpDir, writeSite } from './helpers.js';

async function listen(handler: http.RequestListener): Promise<{ base: string; close: () => void }> {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  return { base: `http://127.0.0.1:${port}`, close: () => server.close() };
}

describe('safeResolve', () => {
  const root = '/srv/site';
  it('aceita caminhos normais', () => expect(safeResolve(root, '/a/b.html')).toBe('/srv/site/a/b.html'));
  it('recusa traversal', () => {
    expect(safeResolve(root, '/../etc/passwd')).toBeNull();
    expect(safeResolve(root, '/%2e%2e/etc/passwd')).toBeNull();
  });
  it('recusa dotfiles', () => expect(safeResolve(root, '/.env')).toBeNull());
  it('recusa encoding inválido e NUL', () => {
    expect(safeResolve(root, '/%zz')).toBeNull();
    expect(safeResolve(root, '/a%00b')).toBeNull();
  });
});

describe('static handler (dir, público)', () => {
  let root: string;
  let srv: Awaited<ReturnType<typeof listen>>;
  beforeAll(async () => {
    root = tmpDir();
    writeSite(root);
    srv = await listen(createStaticHandler({ mode: 'dir', root }));
  });
  afterAll(() => {
    srv.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('serve index.html na raiz com headers de segurança', async () => {
    const r = await fetch(`${srv.base}/`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('home');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('x-robots-tag')).toContain('noindex');
  });
  it('redireciona pasta sem barra e serve o index dela', async () => {
    const r = await fetch(`${srv.base}/sub`, { redirect: 'manual' });
    expect(r.status).toBe(301);
    expect(r.headers.get('location')).toBe('/sub/');
    expect((await fetch(`${srv.base}/sub/`)).status).toBe(200);
  });
  it('não serve dotfiles nem caminhos fora da raiz', async () => {
    expect((await fetch(`${srv.base}/.secret`)).status).toBe(404);
    expect((await fetch(`${srv.base}/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
  });
  it('mime por extensão e 304 com ETag', async () => {
    const r = await fetch(`${srv.base}/style.css`);
    expect(r.headers.get('content-type')).toContain('text/css');
    const r2 = await fetch(`${srv.base}/style.css`, { headers: { 'if-none-match': r.headers.get('etag')! } });
    expect(r2.status).toBe(304);
  });
  it('recusa métodos além de GET/HEAD', async () => {
    expect((await fetch(`${srv.base}/`, { method: 'POST' })).status).toBe(405);
  });
});

describe('static handler (file, privado)', () => {
  let dir: string;
  let srv: Awaited<ReturnType<typeof listen>>;
  const key = 'k'.repeat(43);
  beforeAll(async () => {
    dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'page.html'), '<h1>single</h1>');
    srv = await listen(createStaticHandler({ mode: 'file', file: path.join(dir, 'page.html'), key }));
  });
  afterAll(() => {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('sem cookie devolve a página de gate', async () => {
    const r = await fetch(`${srv.base}/`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('/api/session');
  });
  it('chave errada 401, chave certa 204 + cookie', async () => {
    const bad = await fetch(`${srv.base}/api/session`, { method: 'POST', headers: { Authorization: 'Bearer nope' } });
    expect(bad.status).toBe(401);
    const ok = await fetch(`${srv.base}/api/session`, { method: 'POST', headers: { Authorization: `Bearer ${key}` } });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('set-cookie')).toContain('HttpOnly');
  });
  it('com cookie serve só o arquivo', async () => {
    const headers = { cookie: `cloudfact_access=${key}` };
    expect(await (await fetch(`${srv.base}/`, { headers })).text()).toContain('single');
    expect((await fetch(`${srv.base}/other.html`, { headers })).status).toBe(404);
  });
});
