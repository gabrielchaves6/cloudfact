import fs from 'node:fs';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PROXY_WORKER_SOURCE } from '../src/backends/workers/proxy-worker.js';
import { tmpDir } from './helpers.js';

const TEAM = 'team.cloudflareaccess.com';
const AUD = 'aud-123';
const ORIGIN = 'https://tunnel.trycloudflare.com';
const ORIGIN_KEY = 'origin-key-abc';
const b64url = (data: string | Uint8Array) => Buffer.from(data).toString('base64url');

async function jwt(privateKey: CryptoKey, kid: string, payload: Record<string, unknown>): Promise<string> {
  const head = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = await webcrypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

const rsa = () =>
  webcrypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );

describe('access proxy worker', () => {
  let dir: string;
  let worker: { fetch: (req: Request, env: unknown) => Promise<Response> };
  let keys: Awaited<ReturnType<typeof rsa>>;
  let origins: { url: string; headers: Headers }[] = [];
  const now = () => Math.floor(Date.now() / 1000);
  const claims = () => ({ aud: [AUD], iss: `https://${TEAM}`, exp: now() + 600, nbf: now() - 60, email: 'ana@example.com' });
  const env = {
    CLOUDFACT_ACCESS: '1',
    CLOUDFACT_ACCESS_AUD: AUD,
    CLOUDFACT_ACCESS_TEAM: TEAM,
    CLOUDFACT_ORIGIN: ORIGIN,
    CLOUDFACT_ORIGIN_KEY: ORIGIN_KEY,
  };
  const call = async (headers: Record<string, string> = {}, e: unknown = env, url = 'https://app.example.workers.dev/painel?a=1') =>
    worker.fetch(new Request(url, { headers }), e);
  const signedIn = async () => ({ 'cf-access-jwt-assertion': await jwt(keys.privateKey, 'k1', claims()) });

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
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('refuses a request with no Access token and never touches the origin', async () => {
    origins = [];
    const res = await call();
    expect(res.status).toBe(403);
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

  it('swaps the visitor cookies for the origin key and drops the Access assertion', async () => {
    origins = [];
    await call({ ...(await signedIn()), cookie: 'CF_Authorization=abc; other=1' });
    expect(origins[0].headers.get('cookie')).toBe(`cloudfact_access=${ORIGIN_KEY}`);
    expect(origins[0].headers.get('cf-access-jwt-assertion')).toBeNull();
  });

  it('rejects a forged token', async () => {
    const other = await rsa();
    const res = await call({ 'cf-access-jwt-assertion': await jwt(other.privateKey, 'k1', claims()) });
    expect(res.status).toBe(403);
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
