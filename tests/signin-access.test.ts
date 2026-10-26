import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WORKER_SOURCE } from '../src/backends/workers/gate-worker.js';
import { AUD, SESSION_SECRET, TEAM, claims, jwt, rsa } from './access-helpers.js';
import { loadWorker, postJson, type WorkerModule } from './signin-helpers.js';

const HOST = 'site.example.workers.dev';
const NONCE = 'n0nce_ABC-123456';
const CODE = '123456';

describe('sign-in before a Resend key is set: the same page, with Access mailing and checking the code behind it', () => {
  let dir: string;
  let mod: WorkerModule;
  let goodToken: string;
  let foreignToken: string;
  let calls: { url: string; body: URLSearchParams }[];
  let mode: { ask: 'ok' | 'down' | 'once'; success: 'token' | 'foreign' };
  let allowed: boolean;
  const env = {
    CLOUDFACT_ACCESS: '1',
    CLOUDFACT_ACCESS_AUD: AUD,
    CLOUDFACT_ACCESS_TEAM: TEAM,
    CLOUDFACT_ACCESS_EMAILS: 'ana@example.com',
    CLOUDFACT_SESSION_SECRET: SESSION_SECRET,
    SESSION_LIMIT: { limit: async () => ({ success: allowed }) },
    ASSETS: { fetch: async () => new Response('secret page', { headers: { 'content-type': 'text/html' } }) },
  };
  const post = (route: string, body: unknown, headers: Record<string, string> = {}) =>
    postJson(mod.default, env, HOST, route, body, headers);
  const err = async (res: Response) => ((await res.json()) as { error: string }).error;

  beforeAll(async () => {
    ({ mod, dir } = await loadWorker(WORKER_SOURCE));
    const keys = await rsa();
    goodToken = await jwt(keys.privateKey, 'k1', claims());
    foreignToken = await jwt(keys.privateKey, 'k1', claims({ aud: ['another-app'] }));
    const jwk = { ...(await webcrypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'k1', use: 'sig' };
    const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === `https://${TEAM}/cdn-cgi/access/certs`) return new Response(JSON.stringify({ keys: [jwk] }));
        const body = new URLSearchParams(String(init?.body ?? ''));
        calls.push({ url, body });
        if (url.startsWith(`https://${TEAM}/cdn-cgi/access/verify-code/${HOST}?`)) {
          if (mode.ask === 'down') return new Response('oops', { status: 500 });
          if (mode.ask === 'once') {
            mode.ask = 'ok'; // turned away once, as Access does with a burst from Workers
            return new Response('slow down', { status: 429 });
          }
          return redirect(`https://${TEAM}/cdn-cgi/access/verify-code/${HOST}?kid=${AUD}&nonce=${NONCE}`);
        }
        if (url === `https://${TEAM}/cdn-cgi/access/callback`) {
          if (body.get('code') !== CODE || body.get('nonce') !== NONCE)
            return redirect(`https://${TEAM}/cdn-cgi/access/login/${HOST}?kid=${AUD}`);
          const token = mode.success === 'token' ? goodToken : foreignToken;
          return redirect(`https://${HOST}/cdn-cgi/access/authorized?token=${token}&redirect_url=%2F`);
        }
        return new Response('not found', { status: 404 });
      }),
    );
  });
  beforeEach(() => {
    calls = [];
    mode = { ask: 'ok', success: 'token' };
    allowed = true;
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('code: asks Access to mail it, with the way back to the official page, and hands the nonce to the page', async () => {
    const res = await post('code', { email: ' Ana@Example.com ', remember: true, next: '/painel?a=1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      request: NONCE,
      message: 'Se este e-mail tiver acesso, o código chega em instantes. Confira também o spam.',
    });
    const asked = new URL(calls[0].url);
    expect(asked.searchParams.get('kid')).toBe(AUD);
    expect(asked.searchParams.get('redirect_url')).toBe('/.cloudfact/login?remember=1&next=%2Fpainel%3Fa%3D1');
    expect(calls[0].body.get('email')).toBe('ana@example.com');
  });

  it('enter: a right code signs in with "Remember me"', async () => {
    const res = await post('enter', { request: NONCE, code: ' 123 456 ', remember: true, next: '/painel?a=1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, next: '/painel?a=1' });
    expect(res.headers.get('set-cookie')).toMatch(/^cloudfact_session=[\w-]+\.[\w-]+; .*Max-Age=34560000$/);
  });

  it('enter: a wrong code says so and sets nothing', async () => {
    const res = await post('enter', { request: NONCE, code: '654321', remember: true, next: '/' });
    expect(res.status).toBe(400);
    expect(await err(res)).toBe('Código incorreto.');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('enter: an answer of a shape it does not know sends the browser to finish the official way', async () => {
    mode.success = 'foreign';
    const res = await post('enter', { request: NONCE, code: CODE, remember: true, next: '/' });
    const data = (await res.json()) as { next: string };
    expect(data.next).toMatch(new RegExp(`^https://${HOST}/cdn-cgi/access/authorized\\?token=`));
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('tries once more when Access turns the first ask away; then offers the official way in', async () => {
    mode.ask = 'once';
    expect((await post('code', { email: 'ana@example.com', remember: true, next: '/' })).status).toBe(200);
    expect(calls).toHaveLength(2);
    mode.ask = 'down';
    const res = await post('code', { email: 'ana@example.com', remember: true, next: '/painel' });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: 'Não deu para pedir o código ao Cloudflare',
      official: '/.cloudfact/login?remember=1&next=%2Fpainel',
    });
  });

  it('slows down a flood, and keeps bad input and other sites away from Access', async () => {
    allowed = false;
    expect((await post('code', { email: 'ana@example.com' })).status).toBe(429);
    expect((await post('enter', { request: NONCE, code: CODE })).status).toBe(429);
    allowed = true;
    expect(await err(await post('code', { email: 'nope' }))).toBe('Informe um e-mail válido.');
    expect(await err(await post('enter', { request: 'bad nonce!', code: CODE }))).toBe('Peça um novo código.');
    expect((await post('code', { email: 'ana@example.com' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('a GET on the routes is refused', async () => {
    const res = await mod.default.fetch(new Request(`https://${HOST}/.cloudfact/code`), env, {});
    expect(res.status).toBe(405);
  });
});
