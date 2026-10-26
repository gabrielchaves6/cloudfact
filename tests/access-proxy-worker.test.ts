import fs from 'node:fs';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PROXY_WORKER_SOURCE } from '../src/backends/workers/proxy-worker.js';
import { AUD, SESSION_SECRET, TEAM, claims, cookieOf, jwt, login, rsa } from './access-helpers.js';
import { tmpDir } from './helpers.js';

const ORIGIN = 'https://tunnel.trycloudflare.com';
const ORIGIN_KEY = 'origin-key-abc';

describe('access proxy worker', () => {
  let dir: string;
  let worker: { fetch: (req: Request, env: unknown) => Promise<Response> };
  let keys: Awaited<ReturnType<typeof rsa>>;
  let origins: { url: string; headers: Headers }[] = [];
  const env = {
    CLOUDFACT_ACCESS: '1',
    CLOUDFACT_ACCESS_AUD: AUD,
    CLOUDFACT_ACCESS_TEAM: TEAM,
    CLOUDFACT_ACCESS_EMAILS: 'ana@example.com',
    CLOUDFACT_SESSION_SECRET: SESSION_SECRET,
    CLOUDFACT_ORIGIN: ORIGIN,
    CLOUDFACT_ORIGIN_KEY: ORIGIN_KEY,
  };
  const call = async (headers: Record<string, string> = {}, e: unknown = env, url = 'https://app.example.workers.dev/painel?a=1') =>
    worker.fetch(new Request(url, { headers }), e);
  let session = '';
  const signedIn = async () => ({ cookie: session });

  beforeAll(async () => {
    dir = tmpDir();
    const file = path.join(dir, 'proxy.mjs');
    fs.writeFileSync(file, PROXY_WORKER_SOURCE);
    worker = (await import(file)).default;
    keys = await rsa();
    const jwk = { ...(await webcrypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'k1', use: 'sig' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === `https://${TEAM}/cdn-cgi/access/certs`)
          return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json' } });
        if (url.startsWith(ORIGIN)) {
          origins.push({ url, headers: new Headers(init?.headers) });
          return new Response('live page', { headers: { 'content-type': 'text/html' } });
        }
        throw new TypeError('fetch failed'); // an unreachable origin throws, it does not answer
      }),
    );
    session = cookieOf(
      await login(worker as never, env, await jwt(keys.privateKey, 'k1', claims()), 'remember=1', 'https://app.example.workers.dev'),
    );
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('without a session: the sign-in page for a page load, 401 otherwise, and never the origin', async () => {
    origins = [];
    const res = await call({ accept: 'text/html' });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<form id="emailForm" hidden>');
    expect((await call()).status).toBe(401);
    expect((await call({ 'cf-access-jwt-assertion': await jwt(keys.privateKey, 'k1', claims()) })).status).toBe(401);
    expect(origins).toHaveLength(0);
  });

  it('forwards a signed-in request to the origin, preserving path and query', async () => {
    origins = [];
    const res = await call(await signedIn());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('live page');
    expect(origins[0].url).toBe(`${ORIGIN}/painel?a=1`);
    expect(res.headers.get('cache-control')).toBe('private, no-cache');
  });

  it('swaps the visitor cookies (the session included) for the origin key and drops the Access assertion', async () => {
    origins = [];
    await call({ cookie: `CF_Authorization=abc; other=1; ${session}`, 'cf-access-jwt-assertion': 'x' });
    expect(origins[0].headers.get('cookie')).toBe(`cloudfact_access=${ORIGIN_KEY}`);
    expect(origins[0].headers.get('cf-access-jwt-assertion')).toBeNull();
  });

  it('mints no session from a forged token', async () => {
    const other = await rsa();
    const res = await login(
      worker as never,
      env,
      await jwt(other.privateKey, 'k1', claims()),
      'remember=1',
      'https://app.example.workers.dev',
    );
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('fails closed with no Access config and reports a missing origin', async () => {
    expect((await call(await signedIn(), { ...env, CLOUDFACT_ACCESS_AUD: '' })).status).toBe(503);
    const res = await call(await signedIn(), { ...env, CLOUDFACT_ORIGIN: '' });
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/no tunnel right now/);
  });

  it('answers 502 when the machine behind the tunnel is unreachable', async () => {
    const res = await call(await signedIn(), { ...env, CLOUDFACT_ORIGIN: 'https://gone.example.com' });
    expect(res.status).toBe(502);
  });
});
