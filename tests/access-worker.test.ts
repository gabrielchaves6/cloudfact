import fs from 'node:fs';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WORKER_SOURCE } from '../src/backends/workers/gate-worker.js';
import { tmpDir } from './helpers.js';

const TEAM = 'team.cloudflareaccess.com';
const AUD = 'aud-123';
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

describe('gate worker in Access mode verifies the Access JWT', () => {
  let dir: string;
  let worker: { fetch: (req: Request, env: unknown, ctx: unknown) => Promise<Response> };
  let keys: Awaited<ReturnType<typeof rsa>>;
  let other: Awaited<ReturnType<typeof rsa>>;
  let certsFetches = 0;
  const now = () => Math.floor(Date.now() / 1000);
  const claims = (over: Record<string, unknown> = {}) => ({
    aud: [AUD],
    iss: `https://${TEAM}`,
    exp: now() + 600,
    nbf: now() - 60,
    email: 'ana@example.com',
    ...over,
  });
  const env = {
    CLOUDFACT_ACCESS: '1',
    CLOUDFACT_ACCESS_AUD: AUD,
    CLOUDFACT_ACCESS_TEAM: TEAM,
    ASSETS: { fetch: async () => new Response('secret page', { headers: { 'content-type': 'text/html' } }) },
  };
  const call = (headers: Record<string, string> = {}, e: unknown = env) =>
    worker.fetch(new Request('https://site.example.workers.dev/', { headers }), e, {});

  beforeAll(async () => {
    dir = tmpDir();
    const file = path.join(dir, 'worker.mjs');
    fs.writeFileSync(file, WORKER_SOURCE);
    worker = (await import(file)).default;
    keys = await rsa();
    other = await rsa();
    const jwk = { ...(await webcrypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'k1', use: 'sig' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        if (String(input) === `https://${TEAM}/cdn-cgi/access/certs`) {
          certsFetches += 1;
          return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json' } });
        }
        return new Response('not found', { status: 404 });
      }),
    );
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('refuses a request without an Access token', async () => {
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/protected by Cloudflare Access/);
  });

  it('serves the assets for a valid token in the header, with private caching', async () => {
    const res = await call({ 'cf-access-jwt-assertion': await jwt(keys.privateKey, 'k1', claims()) });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('secret page');
    expect(res.headers.get('cache-control')).toBe('private, no-cache');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('accepts the CF_Authorization cookie and caches the team keys', async () => {
    const before = certsFetches;
    const res = await call({ cookie: `foo=bar; CF_Authorization=${await jwt(keys.privateKey, 'k1', claims())}` });
    expect(res.status).toBe(200);
    expect(certsFetches).toBe(before); // keys cached from the previous request
  });

  it('rejects the wrong audience, another team, expired and forged tokens', async () => {
    const cases = [
      await jwt(keys.privateKey, 'k1', claims({ aud: ['someone-else'] })),
      await jwt(keys.privateKey, 'k1', claims({ iss: 'https://evil.cloudflareaccess.com' })),
      await jwt(keys.privateKey, 'k1', claims({ exp: now() - 1 })),
      await jwt(other.privateKey, 'k1', claims()), // right kid, wrong key
      'not.a.jwt',
    ];
    for (const token of cases) expect((await call({ 'cf-access-jwt-assertion': token })).status).toBe(403);
  });

  it('refreshes the keys once for an unknown kid, then refuses', async () => {
    const before = certsFetches;
    const res = await call({ 'cf-access-jwt-assertion': await jwt(other.privateKey, 'rotated', claims()) });
    expect(res.status).toBe(403);
    expect(certsFetches).toBe(before + 1);
  });

  it('fails closed when the app is not configured yet', async () => {
    const res = await call({ 'cf-access-jwt-assertion': await jwt(keys.privateKey, 'k1', claims()) }, { ...env, CLOUDFACT_ACCESS_AUD: '' });
    expect(res.status).toBe(503);
  });
});
