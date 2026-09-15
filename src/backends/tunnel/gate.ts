/**
 * Private-mode gate shared by the static server and the reverse proxy.
 * Without the cookie every route returns the gate page, which exchanges `#key=` for an HttpOnly cookie
 * via POST /api/session. The key never leaves the URL fragment, so it is not sent to servers or logs.
 * Keys can expire and be rotated at runtime (the gate re-reads them through `getKey`), and the session
 * endpoint is rate-limited per client IP with failures logged.
 */
import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const COOKIE_NAME = 'cloudfact_access';
export const RATE_LIMIT = { attempts: 10, windowMs: 60_000 };

export interface KeyInfo {
  key: string | null;
  /** ISO date; after it the key (and every cookie carrying it) stops working. */
  expiresAt?: string | null;
}

export interface GateOptions {
  getKey: () => KeyInfo;
  cookieName?: string;
  log?: (message: string) => void;
  now?: () => number;
}

export interface Gate {
  /** True when the gate fully handled the request (session endpoint, gate page, 429); caller must stop. */
  handle(req: IncomingMessage, res: ServerResponse): boolean;
  /** True when the request carries a valid, unexpired key cookie (used for WebSocket upgrades). */
  authorized(req: IncomingMessage): boolean;
  enabled(): boolean;
}

const GATE_HTML = `<!doctype html><html lang="en"><meta charset="utf-8"><title>cloudfact</title>
<style>body{font:16px system-ui;margin:3rem;color:#333}</style><body><p id="m">Signing in…</p>
<script>(async()=>{const el=document.getElementById('m');const m=location.hash.match(/key=([^&]+)/);
if(!m){el.textContent='Private page: open it through the full link (with #key=…).';return}
const r=await fetch('/api/session',{method:'POST',headers:{Authorization:'Bearer '+decodeURIComponent(m[1])}});
if(r.ok){history.replaceState(null,'',location.pathname+location.search);location.reload();return}
let msg='Invalid key.';try{const j=await r.json();if(j.error==='expired')msg='This link has expired. Ask for a new one.';if(r.status===429)msg='Too many attempts. Try again in a minute.'}catch{}
el.textContent=msg})()</script></body></html>`;

export function timingEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Visitor IP as seen by Cloudflare (the socket peer is always the local cloudflared). */
export function clientIp(req: IncomingMessage): string {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf) return cf;
  return req.socket.remoteAddress ?? 'unknown';
}

function cookieValue(req: IncomingMessage, cookieName: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === cookieName) return v.join('=');
  }
  return null;
}

function reply(res: ServerResponse, code: number, body: string, headers: Record<string, string>): void {
  const buf = Buffer.from(body);
  res.writeHead(code, { 'Content-Length': buf.length, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', ...headers });
  res.end(buf);
}

export function createGate(opts: GateOptions): Gate {
  const cookieName = opts.cookieName ?? COOKIE_NAME;
  const log = opts.log ?? (() => {});
  const now = opts.now ?? Date.now;
  const failures = new Map<string, { count: number; windowStart: number }>();

  const current = (): { key: string | null; expired: boolean } => {
    const info = opts.getKey();
    const expired = Boolean(info.expiresAt && Date.parse(info.expiresAt) <= now());
    return { key: info.key, expired };
  };

  const limited = (ip: string): boolean => {
    const entry = failures.get(ip);
    if (!entry) return false;
    if (now() - entry.windowStart > RATE_LIMIT.windowMs) {
      failures.delete(ip);
      return false;
    }
    return entry.count >= RATE_LIMIT.attempts;
  };
  const recordFailure = (ip: string): void => {
    const entry = failures.get(ip);
    if (!entry || now() - entry.windowStart > RATE_LIMIT.windowMs) failures.set(ip, { count: 1, windowStart: now() });
    else entry.count += 1;
    if (failures.size > 10_000) failures.clear(); // memory guard; a flood just resets counters
  };

  const authorized = (req: IncomingMessage): boolean => {
    const { key, expired } = current();
    if (!key) return true;
    if (expired) return false;
    const value = cookieValue(req, cookieName);
    return value !== null && timingEqual(value, key);
  };

  const handle = (req: IncomingMessage, res: ServerResponse): boolean => {
    const { key, expired } = current();
    if (!key) return false;
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/session' && req.method === 'POST') {
      const ip = clientIp(req);
      if (limited(ip)) {
        log(`gate: rate limit hit from ${ip}`);
        reply(res, 429, '{"error":"rate_limited"}', {
          'Content-Type': 'application/json',
          'Retry-After': String(RATE_LIMIT.windowMs / 1000),
        });
        return true;
      }
      const auth = req.headers.authorization ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (expired) {
        recordFailure(ip);
        log(`gate: expired key presented from ${ip}`);
        reply(res, 401, '{"error":"expired"}', { 'Content-Type': 'application/json' });
      } else if (timingEqual(token, key)) {
        failures.delete(ip);
        log(`gate: session opened for ${ip}`);
        reply(res, 204, '', { 'Set-Cookie': `${cookieName}=${key}; Path=/; HttpOnly; Secure; SameSite=Lax` });
      } else {
        recordFailure(ip);
        log(`gate: invalid key from ${ip}`);
        reply(res, 401, '{"error":"invalid"}', { 'Content-Type': 'application/json' });
      }
      return true;
    }
    if (authorized(req)) return false;
    reply(res, 200, GATE_HTML, { 'Content-Type': 'text/html; charset=utf-8' });
    return true;
  };

  return { handle, authorized, enabled: () => Boolean(current().key) };
}

/** Convenience for a fixed key (tests, simple embedding). */
export function staticGate(key: string | null | undefined, cookieName?: string): Gate {
  return createGate({ getKey: () => ({ key: key ?? null }), cookieName });
}
