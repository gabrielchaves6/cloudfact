import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGate, RATE_LIMIT } from '../src/backends/tunnel/gate.js';
import { createStaticHandler } from '../src/backends/tunnel/static-server.js';
import { expiryFrom, parseDuration } from '../src/services/duration.js';
import { tmpDir, writeSite } from './helpers.js';
import fs from 'node:fs';

describe('duration', () => {
  it('parses units', () => {
    expect(parseDuration('90s')).toBe(90_000);
    expect(parseDuration('30m')).toBe(1_800_000);
    expect(parseDuration('24h')).toBe(86_400_000);
    expect(parseDuration('7d')).toBe(7 * 86_400_000);
    expect(() => parseDuration('soon')).toThrow();
    expect(expiryFrom(undefined)).toBeNull();
  });
});

describe('gate: rotation, expiry, rate limit', () => {
  let root: string;
  let base: string;
  let server: http.Server;
  let clock = 1_000_000;
  const keyState = { key: 'a'.repeat(43) as string | null, expiresAt: null as string | null };
  const logs: string[] = [];

  beforeAll(async () => {
    root = tmpDir();
    writeSite(root);
    const gate = createGate({ getKey: () => keyState, log: (m) => logs.push(m), now: () => clock });
    server = http.createServer(createStaticHandler({ mode: 'dir', root, gate }));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const session = (key: string, ip = '203.0.113.1') =>
    fetch(`${base}/api/session`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'cf-connecting-ip': ip } });

  it('rotation invalidates the old key and its cookies immediately', async () => {
    const old = keyState.key!;
    expect((await session(old)).status).toBe(204);
    expect((await fetch(`${base}/`, { headers: { cookie: `cloudfact_access=${old}` } })).status).toBe(200);
    keyState.key = 'b'.repeat(43);
    expect((await session(old)).status).toBe(401);
    const withOldCookie = await fetch(`${base}/`, { headers: { cookie: `cloudfact_access=${old}` } });
    expect(await withOldCookie.text()).toContain('/api/session'); // gate page, not the site
    expect((await session(keyState.key)).status).toBe(204);
  });

  it('expired key is refused with a distinct error', async () => {
    keyState.expiresAt = new Date(clock - 1).toISOString();
    const r = await session(keyState.key!, '203.0.113.2');
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: 'expired' });
    const cookie = await fetch(`${base}/`, { headers: { cookie: `cloudfact_access=${keyState.key}` } });
    expect(await cookie.text()).toContain('/api/session');
    keyState.expiresAt = null;
  });

  it('rate-limits the session endpoint per IP and logs it', async () => {
    const ip = '203.0.113.9';
    for (let i = 0; i < RATE_LIMIT.attempts; i += 1) expect((await session('wrong', ip)).status).toBe(401);
    const blocked = await session(keyState.key!, ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('60');
    expect(logs.some((l) => l.includes('rate limit') && l.includes(ip))).toBe(true);
    expect((await session(keyState.key!, '203.0.113.10')).status).toBe(204); // other IPs unaffected
    clock += RATE_LIMIT.windowMs + 1;
    expect((await session(keyState.key!, ip)).status).toBe(204); // window elapsed
  });
});
