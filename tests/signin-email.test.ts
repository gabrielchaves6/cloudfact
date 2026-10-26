import fs from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WORKER_SOURCE } from '../src/backends/workers/gate-worker.js';
import { PROXY_WORKER_SOURCE } from '../src/backends/workers/proxy-worker.js';
import { AUD, SESSION_SECRET, TEAM } from './access-helpers.js';
import { fakeLoginNamespace, loadWorker, postJson, type WorkerModule } from './signin-helpers.js';

const HOST = 'site.example.workers.dev';
const OWNER = 'ana@example.com';

describe('sign-in by email: the code mailed through Resend and checked in the LOGIN Durable Object, as the Stash does', () => {
  let dir: string;
  let mod: WorkerModule;
  let login: ReturnType<typeof fakeLoginNamespace>;
  let mails: { headers: Headers; body: { from: string; to: string[]; subject: string; text: string; html: string } }[];
  let resendStatus: number[];
  let accessCalls: number;
  let pendingWork: Promise<unknown>[];
  const ctx = { waitUntil: (p: Promise<unknown>) => void pendingWork.push(p) };
  const env = () => ({
    CLOUDFACT_ACCESS: '1',
    CLOUDFACT_ACCESS_AUD: AUD,
    CLOUDFACT_ACCESS_TEAM: TEAM,
    CLOUDFACT_ACCESS_EMAILS: `${OWNER},bob@example.com`,
    CLOUDFACT_SESSION_SECRET: SESSION_SECRET,
    RESEND_API_KEY: 're_test_key_123456',
    LOGIN: login.namespace,
    ASSETS: { fetch: async () => new Response('secret page', { headers: { 'content-type': 'text/html' } }) },
  });
  const ask = async (email: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) => {
    const res = await postJson(mod.default, env(), HOST, 'code', { email, remember: true, next: '/painel?a=1', ...extra }, headers, ctx);
    await Promise.all(pendingWork);
    return res;
  };
  const enter = (request: string, code: string, extra: Record<string, unknown> = {}) =>
    postJson(mod.default, env(), HOST, 'enter', { request, code, remember: true, next: '/painel?a=1', ...extra }, {}, ctx);
  const lastCode = () => /(\d{6})/.exec(mails[mails.length - 1].body.subject)![1];

  beforeAll(async () => {
    ({ mod, dir } = await loadWorker(WORKER_SOURCE));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === 'https://api.resend.com/emails') {
          const status = resendStatus.shift() ?? 200;
          mails.push({ headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
          return new Response(JSON.stringify(status === 200 ? { id: 'mail-1' } : { message: 'nope' }), { status });
        }
        if (url.startsWith(`https://${TEAM}/`)) accessCalls += 1;
        return new Response('not found', { status: 404 });
      }),
    );
  });
  beforeEach(() => {
    login = fakeLoginNamespace(mod);
    mails = [];
    resendStatus = [];
    accessCalls = 0;
    pendingWork = [];
  });
  afterEach(() => vi.useRealTimers());
  afterAll(() => {
    vi.unstubAllGlobals();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('mails a 6-digit code in the CloudFacts look, from CloudFact <onboarding@resend.dev>, and never touches Access', async () => {
    const res = await ask(' Ana@Example.com ');
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; request: string; message: string };
    expect(data.ok).toBe(true);
    expect(data.request).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(data.message).toBe('Se este e-mail tiver acesso, o código chega em instantes. Confira também o spam.');
    expect(mails).toHaveLength(1);
    const mail = mails[0];
    expect(mail.body.from).toBe('CloudFact <onboarding@resend.dev>');
    expect(mail.body.to).toEqual([OWNER]);
    expect(mail.body.subject).toMatch(/^Seu código do CloudFact: \d{6}$/);
    expect(mail.body.text).toContain('Vale por 1 hora.');
    expect(mail.body.html).toContain('background:#0d0d0d');
    expect(mail.body.html).toContain('Seu código para entrar em site');
    expect(mail.body.html).toContain(lastCode());
    expect(mail.headers.get('authorization')).toBe('Bearer re_test_key_123456');
    expect(mail.headers.get('idempotency-key')).toBe(`cloudfact-login-${data.request}`);
    expect(JSON.stringify([...login.store.values()])).not.toContain(lastCode()); // only a hash is kept
    expect(accessCalls).toBe(0);
  });

  it('the right code signs in with "Remember me", once; the session opens the site', async () => {
    const { request } = (await (await ask(OWNER)).json()) as { request: string };
    const res = await enter(request, ` ${lastCode().slice(0, 3)} ${lastCode().slice(3)} `);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, next: '/painel?a=1' });
    const set = res.headers.get('set-cookie')!;
    expect(set).toMatch(/^cloudfact_session=[\w-]+\.[\w-]+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=34560000$/);
    const claims = JSON.parse(Buffer.from(set.split('=')[1].split('.')[0], 'base64url').toString()) as { e: string };
    expect(claims.e).toBe(OWNER); // named by the address the code was mailed to
    const page = await mod.default.fetch(
      new Request(`https://${HOST}/`, { headers: { accept: 'text/html', cookie: set.split(';')[0] } }),
      env(),
      ctx,
    );
    expect(await page.text()).toBe('secret page');
    const again = await enter(request, lastCode());
    expect(((await again.json()) as { error: string }).error).toBe('Código vencido. Peça um novo.'); // a used code is gone
  });

  it('not remembered: a cookie that ends with the browser', async () => {
    const { request } = (await (await ask(OWNER)).json()) as { request: string };
    const res = await enter(request, lastCode(), { remember: false });
    expect(res.headers.get('set-cookie')).not.toContain('Max-Age');
  });

  it('5 tries per code; the last wrong one says to ask again', async () => {
    const { request } = (await (await ask(OWNER)).json()) as { request: string };
    const wrong = lastCode() === '000000' ? '111111' : '000000';
    const errors = [];
    for (let i = 0; i < 5; i++) errors.push(((await (await enter(request, wrong)).json()) as { error: string }).error);
    expect(errors).toEqual([
      'Código incorreto.',
      'Código incorreto.',
      'Código incorreto.',
      'Código incorreto.',
      'Código incorreto. Peça um novo.',
    ]);
    const late = await enter(request, lastCode());
    expect(late.status).toBe(400);
    expect(((await late.json()) as { error: string }).error).toBe('Código vencido. Peça um novo.');
    expect(late.headers.get('set-cookie')).toBeNull();
  });

  it('a code lasts 1 hour', async () => {
    const { request } = (await (await ask(OWNER)).json()) as { request: string };
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 3601 * 1000);
    expect(((await (await enter(request, lastCode())).json()) as { error: string }).error).toBe('Código vencido. Peça um novo.');
  });

  it('an address without access gets the same answer and no email, and no code of its own ever works', async () => {
    const res = await ask('eve@example.com');
    expect(res.status).toBe(200);
    const data = (await res.json()) as { request: string; message: string };
    expect(data.message).toBe('Se este e-mail tiver acesso, o código chega em instantes. Confira também o spam.');
    expect(mails).toHaveLength(0);
    for (const code of ['000000', '123456', '999999']) expect((await enter(data.request, code)).status).toBe(400);
  });

  it('limits asks: 5 per 15 minutes and 30 per day for an address, 60 per 15 minutes for everyone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    for (let i = 0; i < 5; i++) expect((await ask(OWNER)).status).toBe(200);
    const busy = await ask(OWNER);
    expect(busy.status).toBe(429);
    expect(((await busy.json()) as { error: string }).error).toBe('Muitos pedidos. Tente de novo em alguns minutos.');
    expect(mails).toHaveLength(5);
    // 15 minutes later the address may ask again, until 30 in the day
    for (let block = 1; block < 6; block++) {
      vi.setSystemTime(start + block * 901 * 1000);
      for (let i = 0; i < 5; i++) expect((await ask(OWNER)).status).toBe(200);
    }
    vi.setSystemTime(start + 6 * 901 * 1000);
    expect((await ask(OWNER)).status).toBe(429); // 30 in the day
    vi.setSystemTime(start + 86401 * 1000);
    expect((await ask(OWNER)).status).toBe(200); // a day later
    // everyone together
    login = fakeLoginNamespace(mod);
    for (let i = 0; i < 60; i++) expect((await ask(`p${i}@example.com`)).status).toBe(200);
    expect((await ask('p60@example.com')).status).toBe(429);
  });

  it('Resend refusing with a server error or a 429 gets one more try; a 4xx does not', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    resendStatus = [503, 200];
    const first = ask(OWNER);
    for (let i = 0; i < 40 && mails.length < 2; i++) await vi.advanceTimersByTimeAsync(250); // the retry waits 3 s
    expect((await first).status).toBe(200);
    expect(mails).toHaveLength(2);
    vi.useRealTimers();
    mails = [];
    resendStatus = [403];
    expect((await ask('bob@example.com')).status).toBe(200); // the page answers the same: nothing tells the address apart
    expect(mails).toHaveLength(1);
  });

  it('keeps bad input away from the store, and posts from another site out', async () => {
    expect(((await (await ask('not-an-email')).json()) as { error: string }).error).toBe('Informe um e-mail válido.');
    expect(((await (await enter('short', '123456')).json()) as { error: string }).error).toBe('Peça um novo código.');
    expect(((await (await enter('A'.repeat(32), '12345')).json()) as { error: string }).error).toBe('Digite os 6 números do código.');
    expect((await ask(OWNER, {}, { origin: 'https://evil.example' })).status).toBe(403);
    const form = await mod.default.fetch(
      new Request(`https://${HOST}/.cloudfact/code`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'email=a@b.co',
      }),
      env(),
      ctx,
    );
    expect(form.status).toBe(403); // JSON only, like the Stash's routes
    expect((await postJson(mod.default, env(), HOST, 'code', '{nope', {}, ctx)).status).toBe(400);
    expect((await postJson(mod.default, env(), HOST, 'code', { email: 'x'.repeat(5000) }, {}, ctx)).status).toBe(400);
    expect(login.store.size).toBe(0);
    expect(mails).toHaveLength(0);
  });

  it('speaks English to an English browser, in the page and in the email', async () => {
    const res = await ask(OWNER, {}, { 'accept-language': 'en-US,en;q=0.9' });
    expect(((await res.json()) as { message: string }).message).toBe(
      'If this email has access, the code arrives in a moment. Check the spam folder too.',
    );
    expect(mails[0].body.subject).toMatch(/^Your CloudFact code: \d{6}$/);
  });

  it('the app proxy Worker signs in the same way', async () => {
    const proxy = await loadWorker(PROXY_WORKER_SOURCE);
    const proxyLogin = fakeLoginNamespace(proxy.mod);
    const penv = { ...env(), LOGIN: proxyLogin.namespace, CLOUDFACT_ORIGIN: 'https://tunnel.trycloudflare.com' };
    const asked = await postJson(proxy.mod.default, penv, HOST, 'code', { email: OWNER, remember: true, next: '/' }, {}, ctx);
    await Promise.all(pendingWork);
    const { request } = (await asked.json()) as { request: string };
    const res = await postJson(proxy.mod.default, penv, HOST, 'enter', { request, code: lastCode(), remember: true, next: '/' }, {}, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/^cloudfact_session=/);
    fs.rmSync(proxy.dir, { recursive: true, force: true });
  });
});
