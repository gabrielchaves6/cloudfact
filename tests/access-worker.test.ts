import fs from 'node:fs';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { WORKER_SOURCE } from '../src/backends/workers/gate-worker.js';
import { AUD, SESSION_SECRET, TEAM, claims, cookieOf, jwt, login, rsa } from './access-helpers.js';
import { tmpDir } from './helpers.js';

describe('gate worker in Access mode: its own sign-in pages and "Remember me" cookie, Access behind', () => {
  let dir: string;
  let worker: { fetch: (req: Request, env: unknown, ctx: unknown) => Promise<Response> };
  let keys: Awaited<ReturnType<typeof rsa>>;
  let other: Awaited<ReturnType<typeof rsa>>;
  let certsFetches = 0;
  let assetFetches = 0;
  const env = {
    CLOUDFACT_ACCESS: '1',
    CLOUDFACT_ACCESS_AUD: AUD,
    CLOUDFACT_ACCESS_TEAM: TEAM,
    CLOUDFACT_ACCESS_EMAILS: 'ana@example.com,bob@example.com',
    CLOUDFACT_SESSION_SECRET: SESSION_SECRET,
    ASSETS: {
      fetch: async () => {
        assetFetches += 1;
        return new Response('secret page', { headers: { 'content-type': 'text/html' } });
      },
    },
  };
  const page = (headers: Record<string, string> = {}, e: unknown = env, p = '/') =>
    worker.fetch(new Request('https://site.example.workers.dev' + p, { headers: { accept: 'text/html', ...headers } }), e, {});
  const token = (over: Record<string, unknown> = {}) => jwt(keys.privateKey, 'k1', claims(over));

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
  afterEach(() => vi.useRealTimers());
  afterAll(() => {
    vi.unstubAllGlobals();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('shows the sign-in page, with "Remember me" ticked, to a visitor without a session', async () => {
    assetFetches = 0;
    const res = await page({}, env, '/painel?a=1');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<form method="post" action="/.cloudfact/email">');
    expect(html).toContain('type="email" name="email" required');
    expect(html).toContain('name="remember" value="1" checked>Remember me');
    expect(html).toContain('<input type="hidden" name="next" value="/painel?a=1">');
    expect(html).toContain('<h1>site</h1>');
    expect(html).not.toMatch(/<script/);
    expect(assetFetches).toBe(0);
  });

  it('speaks Portuguese to a Portuguese browser', async () => {
    const html = await (await page({ 'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8' })).text();
    expect(html).toContain('lang="pt"');
    expect(html).toContain('Lembrar meu login');
    expect(html).toContain('>Enviar código</button>');
  });

  it('answers 401, not a page, to a request that is not a page load', async () => {
    const res = await worker.fetch(new Request('https://site.example.workers.dev/data.json'), env, {});
    expect(res.status).toBe(401);
  });

  it('does not take an Access token outside the sign-in path: only the session cookie lets one in', async () => {
    assetFetches = 0;
    const res = await page({ 'cf-access-jwt-assertion': await token() });
    expect(await res.text()).toContain('action="/.cloudfact/email"');
    expect(assetFetches).toBe(0);
  });

  it('remembered: signs in through Access, sets a 400-day cookie and serves the site with it', async () => {
    const res = await login(worker, env, await token(), 'remember=1&next=%2Fpainel%3Fa%3D1');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/painel?a=1');
    const set = res.headers.get('set-cookie')!;
    expect(set).toMatch(/^cloudfact_session=[\w-]+\.[\w-]+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=34560000$/);
    const ok = await page({ cookie: `foo=bar; ${cookieOf(res)}` });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('secret page');
    expect(ok.headers.get('cache-control')).toBe('private, no-cache');
    expect(ok.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(ok.headers.get('set-cookie')).toBeNull(); // fresh: nothing to renew
  });

  it('not remembered: a cookie that ends with the browser, and with the day', async () => {
    const res = await login(worker, env, await token(), 'next=%2F');
    const set = res.headers.get('set-cookie')!;
    expect(set).not.toContain('Max-Age');
    expect((await page({ cookie: cookieOf(res) })).status).toBe(200);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 25 * 3600 * 1000);
    expect(await (await page({ cookie: cookieOf(res) })).text()).toContain('action="/.cloudfact/email"');
  });

  it('a remembered browser stays signed in: after a day its cookie is pushed forward', async () => {
    const res = await login(worker, env, await token());
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 300 * 86400 * 1000); // well past Access's own session
    const ok = await page({ cookie: cookieOf(res) });
    expect(ok.status).toBe(200);
    const renewed = ok.headers.get('set-cookie')!;
    expect(renewed).toMatch(/Max-Age=34560000$/);
    vi.setSystemTime(Date.now() + 300 * 86400 * 1000); // 600 days after signing in, used in between
    expect((await page({ cookie: renewed.split(';')[0] })).status).toBe(200);
  });

  it('accepts the CF_Authorization cookie on the sign-in path and caches the team keys', async () => {
    const before = certsFetches;
    const res = await worker.fetch(
      new Request('https://site.example.workers.dev/.cloudfact/login?remember=1', {
        headers: { cookie: `CF_Authorization=${await token()}` },
      }),
      env,
      {},
    );
    expect(res.status).toBe(303);
    expect(certsFetches).toBe(before); // keys cached from the previous requests
  });

  it('mints nothing for the wrong audience, another team, an expired or forged token, or an email not on the list', async () => {
    const cases = [
      await token({ aud: ['someone-else'] }),
      await token({ iss: 'https://evil.cloudflareaccess.com' }),
      await token({ exp: Math.floor(Date.now() / 1000) - 1 }),
      await jwt(other.privateKey, 'k1', claims()), // right kid, wrong key
      await token({ email: 'eve@example.com' }),
      'not.a.jwt',
    ];
    for (const t of cases) {
      const res = await login(worker, env, t);
      expect(res.status).toBe(403);
      expect(res.headers.get('set-cookie')).toBeNull();
    }
    const none = await worker.fetch(new Request('https://site.example.workers.dev/.cloudfact/login?remember=1'), env, {});
    expect(none.status).toBe(403);
  });

  it('refreshes the keys once for an unknown kid, then refuses', async () => {
    const before = certsFetches;
    const res = await login(worker, env, await jwt(other.privateKey, 'rotated', claims()));
    expect(res.status).toBe(403);
    expect(certsFetches).toBe(before + 1);
  });

  it('refuses a forged, re-signed or replayed cookie', async () => {
    const good = cookieOf(await login(worker, env, await token()));
    const [name, value] = good.split('=');
    const [body, sig] = value.split('.');
    const claimsOf = JSON.parse(Buffer.from(body, 'base64url').toString()) as Record<string, unknown>;
    const forgedBody = Buffer.from(JSON.stringify({ ...claimsOf, e: 'bob@example.com' })).toString('base64url');
    const cases = [
      `${name}=${forgedBody}.${sig}`, // claims changed, old signature
      `${name}=${body}.${sig.slice(0, -2)}AA`, // signature tampered
      `${name}=${body}`, // no signature
    ];
    for (const cookie of cases) expect(await (await page({ cookie })).text()).toContain('action="/.cloudfact/email"');
    // another key (a site that rotated it, or another site), another app, or the email taken off the list
    for (const e of [
      { ...env, CLOUDFACT_SESSION_SECRET: 'another-secret' },
      { ...env, CLOUDFACT_ACCESS_AUD: 'another-app' },
      { ...env, CLOUDFACT_ACCESS_EMAILS: 'bob@example.com' },
    ])
      expect(await (await page({ cookie: good }, e)).text()).toContain('action="/.cloudfact/email"');
  });

  it('only sends the visitor back to a path on this site', async () => {
    const t = await token();
    const where = async (next: string) => (await login(worker, env, t, `next=${encodeURIComponent(next)}`)).headers.get('location');
    expect(await where('/painel?a=1#x')).toBe('/painel?a=1#x');
    for (const next of [
      '//evil.example',
      'https://evil.example/',
      '/\\evil.example',
      '/.cloudfact/login',
      'painel',
      '/a\r\nset-cookie: x=1',
    ])
      expect(await where(next)).toBe('/');
  });

  it('signs out: drops the cookie and ends the Access session', async () => {
    const res = await page({}, env, '/.cloudfact/logout');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/cdn-cgi/access/logout');
    expect(res.headers.get('set-cookie')).toBe('cloudfact_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  });

  it('fails closed when the app is not configured yet', async () => {
    expect((await login(worker, { ...env, CLOUDFACT_ACCESS_AUD: '' }, await token())).status).toBe(503);
    expect((await login(worker, { ...env, CLOUDFACT_SESSION_SECRET: '' }, await token())).status).toBe(503);
    const res = await login(worker, { ...env, CLOUDFACT_ACCESS_EMAILS: '' }, await token());
    expect(res.status).toBe(403); // nobody on the list: nobody gets a session
  });
});
