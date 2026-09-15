import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProxy } from '../src/backends/tunnel/proxy.js';

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return (server.address() as { port: number }).port;
}

describe('reverse proxy (expose)', () => {
  let app: http.Server;
  let appPort: number;
  let publicPort: number;
  let privatePort: number;
  const key = 'k'.repeat(43);
  const servers: http.Server[] = [];

  beforeAll(async () => {
    app = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ path: req.url, method: req.method, proto: req.headers['x-forwarded-proto'] }));
    });
    appPort = await listen(app);
    const pub = createProxy({ targetPort: appPort });
    const publicServer = http.createServer(pub.handler);
    publicServer.on('upgrade', pub.upgrade);
    publicPort = await listen(publicServer);
    const priv = createProxy({ targetPort: appPort, key });
    const privateServer = http.createServer(priv.handler);
    privatePort = await listen(privateServer);
    servers.push(app, publicServer, privateServer);
  });
  afterAll(() => servers.forEach((s) => s.close()));

  it('forwards path, method and X-Forwarded-Proto', async () => {
    const r = await fetch(`http://127.0.0.1:${publicPort}/api/x?y=1`, { method: 'POST', body: 'hi' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ path: '/api/x?y=1', method: 'POST', proto: 'https' });
  });
  it('answers 502 when the upstream is down', async () => {
    const dead = createProxy({ targetPort: 1 });
    const s = http.createServer(dead.handler);
    const port = await listen(s);
    const r = await fetch(`http://127.0.0.1:${port}/`);
    expect(r.status).toBe(502);
    s.close();
  });
  it('private: gate without cookie, app with cookie', async () => {
    const gate = await fetch(`http://127.0.0.1:${privatePort}/api/x`);
    expect(await gate.text()).toContain('/api/session');
    const bad = await fetch(`http://127.0.0.1:${privatePort}/api/session`, { method: 'POST', headers: { Authorization: 'Bearer nope' } });
    expect(bad.status).toBe(401);
    const ok = await fetch(`http://127.0.0.1:${privatePort}/api/x`, { headers: { cookie: `cloudfact_access=${key}` } });
    expect(((await ok.json()) as { path: string }).path).toBe('/api/x');
  });
});
