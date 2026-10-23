import fs from 'node:fs';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WORKER_SOURCE } from '../src/backends/workers/gate-worker.js';
import { AUD, SESSION_SECRET, TEAM, claims, cookieOf, jwt, rsa } from './access-helpers.js';
import { tmpDir } from './helpers.js';

const HOST = 'site.example.workers.dev';
const NONCE = 'n0nce_ABC-123456';
const CODE = '123456';

describe('sign-in pages in front of Access: email, then code, with the one-time PIN driven behind them', () => {
  let dir: string;
  let worker: { fetch: (req: Request, env: unknown, ctx: unknown) => Promise<Response> };
  let goodToken: string;
  let foreignToken: string;
  let calls: { url: string; body: URLSearchParams }[];
  /** How the fake Access behaves for the next calls. */
  let mode: { emailStep: 'ok' | 'down' | 'once'; success: 'token' | 'foreign' | 'elsewhere' };
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
  const post = (p: string, fields: Record<string, string>, headers: Record<string, string> = {}) =>
    worker.fetch(
      new Request(`https://${HOST}${p}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin: `https://${HOST}`, 'accept-language': 'pt-BR', ...headers },
        body: new URLSearchParams(fields).toString(),
      }),
      env,
      {},
    );
  const get = (p: string, headers: Record<string, string> = {}) =>
    worker.fetch(new Request(`https://${HOST}${p}`, { headers: { accept: 'text/html', ...headers } }), env, {});

  beforeAll(async () => {
    dir = tmpDir();
    const file = path.join(dir, 'worker.mjs');
    fs.writeFileSync(file, WORKER_SOURCE);
    worker = (await import(file)).default;
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
          if (mode.emailStep === 'down') return new Response('oops', { status: 500 });
          if (mode.emailStep === 'once') {
            mode.emailStep = 'ok'; // turned away once, like Access does with a burst
            return new Response('slow down', { status: 429 });
          }
          return redirect(`https://${TEAM}/cdn-cgi/access/verify-code/${HOST}?kid=${AUD}&nonce=${NONCE}`);
        }
        if (url === `https://${TEAM}/cdn-cgi/access/callback`) {
          if (body.get('code') !== CODE || body.get('nonce') !== NONCE)
            return redirect(`https://${TEAM}/cdn-cgi/access/login/${HOST}?kid=${AUD}`);
          if (mode.success === 'elsewhere') return redirect(`https://${TEAM}/cdn-cgi/access/something-new?x=1`);
          const token = mode.success === 'token' ? goodToken : foreignToken;
          return redirect(`https://${HOST}/cdn-cgi/access/authorized?token=${token}&redirect_url=%2F`);
        }
        return new Response('not found', { status: 404 });
      }),
    );
  });
  beforeEach(() => {
    calls = [];
    mode = { emailStep: 'ok', success: 'token' };
    allowed = true;
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('email: asks Access for a code behind the page and answers with the code page, all its own', async () => {
    const res = await post('/.cloudfact/email', { email: ' Ana@Example.com ', remember: '1', next: '/painel?a=1' });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<p class="state">ana@example.com</p>');
    expect(html).toContain('<form method="post" action="/.cloudfact/code">');
    expect(html).toContain(`<input type="hidden" name="nonce" value="${NONCE}">`);
    expect(html).toContain('<input type="hidden" name="remember" value="1">');
    expect(html).toContain('autocomplete="one-time-code"');
    expect(html).toContain('>Entrar</button>');
    expect(html).not.toMatch(/<script|cloudflareaccess/);
    expect(calls).toHaveLength(1);
    const asked = new URL(calls[0].url);
    expect(asked.pathname).toBe(`/cdn-cgi/access/verify-code/${HOST}`);
    expect(asked.searchParams.get('kid')).toBe(AUD);
    expect(asked.searchParams.get('redirect_url')).toBe('/.cloudfact/login?remember=1&next=%2Fpainel%3Fa%3D1');
    expect(calls[0].body.get('email')).toBe('ana@example.com');
  });

  it('code: a right one signs in with "Remember me" and goes on to the page asked for', async () => {
    const res = await post('/.cloudfact/code', {
      code: ' 123456 ',
      nonce: NONCE,
      email: 'ana@example.com',
      remember: '1',
      next: '/painel?a=1',
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/painel?a=1');
    expect(res.headers.get('set-cookie')).toMatch(
      /^cloudfact_session=[\w-]+\.[\w-]+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=34560000$/,
    );
    expect(calls[0].body.get('code')).toBe(CODE);
    const ok = await get('/', { cookie: cookieOf(res) });
    expect(await ok.text()).toBe('secret page');
  });

  it('code: not remembered, the cookie ends with the browser', async () => {
    const res = await post('/.cloudfact/code', { code: CODE, nonce: NONCE, email: 'ana@example.com', remember: '', next: '/' });
    expect(res.headers.get('set-cookie')).not.toContain('Max-Age');
  });

  it('code: a wrong one stays on the code page, same nonce, and sets nothing', async () => {
    for (const code of ['654321', '12ab56', '']) {
      const res = await post('/.cloudfact/code', { code, nonce: NONCE, email: 'ana@example.com', remember: '1', next: '/' });
      expect(res.status).toBe(401);
      expect(res.headers.get('set-cookie')).toBeNull();
      const html = await res.text();
      expect(html).toContain('Código incorreto');
      expect(html).toContain(`value="${NONCE}"`);
    }
    expect(calls).toHaveLength(1); // only the well-formed code reached Access
  });

  it('code: an answer of a shape it does not know is handed to the browser to finish the official way', async () => {
    mode.success = 'foreign'; // a token, but not for this app: never turned into a session
    let res = await post('/.cloudfact/code', { code: CODE, nonce: NONCE, email: 'ana@example.com', remember: '1', next: '/' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(new RegExp(`^https://${HOST}/cdn-cgi/access/authorized\\?token=`));
    expect(res.headers.get('set-cookie')).toBeNull();
    mode.success = 'elsewhere';
    res = await post('/.cloudfact/code', { code: CODE, nonce: NONCE, email: 'ana@example.com', remember: '1', next: '/' });
    expect(res.headers.get('location')).toBe(`https://${TEAM}/cdn-cgi/access/something-new?x=1`);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('tries once more when Access turns the first request away', async () => {
    mode.emailStep = 'once';
    const res = await post('/.cloudfact/email', { email: 'ana@example.com', remember: '1', next: '/' });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(`value="${NONCE}"`);
    expect(calls).toHaveLength(2);
  });

  it('when Access does not hand out a code, offers the official way in', async () => {
    mode.emailStep = 'down';
    const res = await post('/.cloudfact/email', { email: 'ana@example.com', remember: '1', next: '/painel' });
    expect(res.status).toBe(502);
    const html = await res.text();
    expect(html).toContain('Não deu para pedir o código ao Cloudflare');
    expect(html).toContain('href="/.cloudfact/login?remember=1&amp;next=%2Fpainel">Entrar pelo Cloudflare</a>');
  });

  it('refuses posts from another site, and does not call Access for them', async () => {
    const res = await post('/.cloudfact/email', { email: 'ana@example.com', next: '/' }, { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('keeps a bad email or nonce away from Access', async () => {
    expect((await post('/.cloudfact/email', { email: 'not-an-email', next: '/' })).status).toBe(400);
    expect((await post('/.cloudfact/code', { code: CODE, nonce: 'bad nonce!', next: '/' })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('slows down a flood of attempts', async () => {
    allowed = false;
    const a = await post('/.cloudfact/email', { email: 'ana@example.com', next: '/' });
    expect(a.status).toBe(429);
    const b = await post('/.cloudfact/code', { code: CODE, nonce: NONCE, email: 'ana@example.com', next: '/' });
    expect(b.status).toBe(429);
    expect(await b.text()).toContain('Muitas tentativas');
    expect(calls).toHaveLength(0);
  });

  it('a stray GET on the form paths goes home; escapes what it echoes', async () => {
    const res = await worker.fetch(new Request(`https://${HOST}/.cloudfact/code`), env, {});
    expect(res.status).toBe(303);
    const echo = await post('/.cloudfact/email', { email: 'a"$&<b>@x.io', next: '/' });
    const html = await echo.text();
    expect(html).toContain('<p class="state">a&quot;$&amp;&lt;b&gt;@x.io</p>');
  });
});
