import fs from 'node:fs';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WORKER_SOURCE } from '../src/backends/workers/gate-worker.js';
import { tmpDir } from './helpers.js';

const TEAM = 'team.cloudflareaccess.com';
const AUD = 'aud-123';
const ORIGIN = 'https://cloudfacts.example-sub.workers.dev';
const b64url = (data: string | Uint8Array) => Buffer.from(data).toString('base64url');

describe('the catalog Worker switches deploys off and on', () => {
  let dir: string;
  let worker: { fetch: (req: Request, env: unknown, ctx: unknown) => Promise<Response> };
  let token: string;
  let tags: Record<string, string[]>;
  let subdomain: Record<string, unknown>;
  let tunnelCalls: { url: string; auth: string | null; body: unknown }[];
  let tunnelOn: boolean;
  let apiDown: boolean;

  const env = {
    CLOUDFACT_ACCESS: '1',
    CLOUDFACT_ACCESS_AUD: AUD,
    CLOUDFACT_ACCESS_TEAM: TEAM,
    CLOUDFACT_CONTROL: '1',
    CLOUDFACT_ACCOUNT_ID: 'acc123',
    CLOUDFACT_API_TOKEN: 'api-token',
    CLOUDFACT_CONTROL_TARGETS: JSON.stringify({
      workers: ['site'],
      tunnels: { tun: { url: 'https://tun.trycloudflare.com', key: 'control-key' } },
    }),
    ASSETS: { fetch: async () => new Response('catalog page', { headers: { 'content-type': 'text/html' } }) },
  };
  const call = (p: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}, e: unknown = env) =>
    worker.fetch(
      new Request(ORIGIN + p, {
        method: init.method ?? 'GET',
        headers: { 'cf-access-jwt-assertion': token, 'x-cloudfact': '1', ...init.headers },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      }),
      e,
      {},
    );
  const flip = (name: string, on: boolean, headers: Record<string, string> = {}) =>
    call('/.cloudfact/power', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
      body: { name, on },
    });

  beforeAll(async () => {
    dir = tmpDir();
    const file = path.join(dir, 'worker.mjs');
    fs.writeFileSync(file, WORKER_SOURCE);
    worker = (await import(file)).default;
    const keys = await webcrypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    );
    const jwk = { ...(await webcrypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'k1', use: 'sig' };
    const now = Math.floor(Date.now() / 1000);
    const head = b64url(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
    const body = b64url(JSON.stringify({ aud: [AUD], iss: `https://${TEAM}`, exp: now + 600, email: 'owner@example.com' }));
    const sig = await webcrypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, keys.privateKey, new TextEncoder().encode(`${head}.${body}`));
    token = `${head}.${body}.${b64url(new Uint8Array(sig))}`;

    const json = (result: unknown) => new Response(JSON.stringify({ success: true, result }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === `https://${TEAM}/cdn-cgi/access/certs`) return new Response(JSON.stringify({ keys: [jwk] }));
        if (url.startsWith('https://tun.trycloudflare.com/')) {
          const auth = new Headers(init?.headers).get('authorization');
          const sent = init?.body ? JSON.parse(String(init.body)) : undefined;
          tunnelCalls.push({ url, auth, body: sent });
          if (auth !== 'Bearer control-key') return new Response('{"error":"unauthorized"}', { status: 401 });
          if (sent) tunnelOn = sent.on;
          return new Response(JSON.stringify({ on: tunnelOn }));
        }
        const api = 'https://api.cloudflare.com/client/v4/accounts/acc123';
        if (!url.startsWith(api)) return new Response('not found', { status: 404 });
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer api-token');
        if (apiDown)
          return new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }), {
            status: 403,
          });
        const p = url.slice(api.length);
        if (p === '/workers/scripts') return json(Object.entries(tags).map(([id, t]) => ({ id, tags: t })));
        const m = /^\/workers\/scripts\/([^/]+)\/(tags|subdomain)$/.exec(p)!;
        if (m[2] === 'subdomain') {
          subdomain[m[1]] = JSON.parse(String(init!.body));
          return json(subdomain[m[1]]);
        }
        if (init?.method === 'PUT') tags[m[1]] = JSON.parse(String(init.body));
        return json(tags[m[1]]);
      }),
    );
  });
  beforeEach(() => {
    tags = { site: ['cloudfact', 'cloudfact:vis:private'], cloudfacts: ['cloudfact', 'cloudfact:catalog'], other: [] };
    subdomain = {};
    tunnelCalls = [];
    tunnelOn = true;
    apiDown = false;
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is behind the Access check like everything else', async () => {
    const res = await call('/.cloudfact/state', { headers: { 'cf-access-jwt-assertion': '' } });
    expect(res.status).toBe(403);
  });

  it('refuses a request that did not come from this page', async () => {
    expect((await flip('site', false, { 'x-cloudfact': '' })).status).toBe(403);
    expect((await flip('site', false, { origin: 'https://evil.example' })).status).toBe(403);
    expect(subdomain).toEqual({});
  });

  it('reads every switch live: Workers from their tags, tunnels from their host', async () => {
    tags.site.push('cloudfact:off');
    const res = await call('/.cloudfact/state');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ deploys: { site: { on: false }, tun: { on: true } } });
    expect(tunnelCalls[0]).toMatchObject({ url: 'https://tun.trycloudflare.com/.cloudfact/power', auth: 'Bearer control-key' });
  });

  it('turns a Worker off and back on: address first, then the tag', async () => {
    const off = await flip('site', false);
    expect(await off.json()).toEqual({ name: 'site', on: false });
    expect(subdomain.site).toEqual({ enabled: false, previews_enabled: false });
    expect(tags.site).toEqual(['cloudfact', 'cloudfact:vis:private', 'cloudfact:off']);
    await flip('site', true);
    expect(subdomain.site).toEqual({ enabled: true, previews_enabled: false });
    expect(tags.site).toEqual(['cloudfact', 'cloudfact:vis:private']);
  });

  it('turns a tunnel off through its host, with the control key', async () => {
    expect(await (await flip('tun', false)).json()).toEqual({ name: 'tun', on: false });
    expect(tunnelCalls.at(-1)).toMatchObject({ auth: 'Bearer control-key', body: { on: false } });
  });

  it('switches nothing that is not on its list: not the catalog itself, not a stranger', async () => {
    for (const name of ['cloudfacts', 'other', '__proto__', 'constructor']) {
      const res = await flip(name, false);
      expect(res.status).toBe(404);
    }
    expect(subdomain).toEqual({});
  });

  it('says what went wrong when the account refuses', async () => {
    apiDown = true;
    const res = await flip('site', false);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { message: string }).message).toContain('Authentication error');
  });

  it('refuses a malformed request', async () => {
    const res = await call('/.cloudfact/power', { method: 'POST', headers: { origin: ORIGIN }, body: { name: 'site', on: 'no' } });
    expect(res.status).toBe(400);
  });

  it('a tunnel that cannot be reached shows up as such, not as on', async () => {
    const e = {
      ...env,
      CLOUDFACT_CONTROL_TARGETS: JSON.stringify({ workers: [], tunnels: { tun: { url: 'https://tun.trycloudflare.com', key: 'wrong' } } }),
    };
    expect(await (await call('/.cloudfact/state', {}, e)).json()).toEqual({ deploys: { tun: { error: 'unreachable' } } });
  });

  it('without the switch, /.cloudfact/ answers nothing and the page is served as before', async () => {
    const plain = { ...env, CLOUDFACT_CONTROL: undefined, CLOUDFACT_API_TOKEN: undefined };
    expect((await call('/.cloudfact/state', {}, plain)).status).toBe(404);
    expect(await (await call('/', {}, plain)).text()).toBe('catalog page');
  });
});
