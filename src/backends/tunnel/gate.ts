/**
 * Private-mode gate shared by the static server and the reverse proxy.
 * Without the cookie every route returns the gate page, which exchanges `#key=` for an HttpOnly cookie
 * via POST /api/session. The key never leaves the URL fragment, so it is not sent to servers or logs.
 */
import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const COOKIE_NAME = 'cloudfact_access';

const GATE_HTML = `<!doctype html><html lang="en"><meta charset="utf-8"><title>cloudfact</title>
<style>body{font:16px system-ui;margin:3rem;color:#333}</style><body><p id="m">Signing in…</p>
<script>(async()=>{const el=document.getElementById('m');const m=location.hash.match(/key=([^&]+)/);
if(!m){el.textContent='Private page: open it through the full link (with #key=…).';return}
const r=await fetch('/api/session',{method:'POST',headers:{Authorization:'Bearer '+decodeURIComponent(m[1])}});
if(r.ok){history.replaceState(null,'',location.pathname+location.search);location.reload()}
else el.textContent='Invalid key.'})()</script></body></html>`;

export function timingEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function hasAccessCookie(req: IncomingMessage, key: string, cookieName = COOKIE_NAME): boolean {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === cookieName) return timingEqual(v.join('='), key);
  }
  return false;
}

function reply(res: ServerResponse, code: number, body: string, headers: Record<string, string>): void {
  const buf = Buffer.from(body);
  res.writeHead(code, { 'Content-Length': buf.length, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', ...headers });
  res.end(buf);
}

/**
 * Returns true when the request was fully handled by the gate (session endpoint or gate page)
 * and the caller must not continue. Returns false when the request is authorized.
 */
export function gateRequest(req: IncomingMessage, res: ServerResponse, key: string | null | undefined, cookieName = COOKIE_NAME): boolean {
  if (!key) return false;
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/api/session' && req.method === 'POST') {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (timingEqual(token, key)) {
      reply(res, 204, '', { 'Set-Cookie': `${cookieName}=${key}; Path=/; HttpOnly; Secure; SameSite=Lax` });
    } else {
      reply(res, 401, '{"error":"invalid key"}', { 'Content-Type': 'application/json' });
    }
    return true;
  }
  if (hasAccessCookie(req, key, cookieName)) return false;
  reply(res, 200, GATE_HTML, { 'Content-Type': 'text/html; charset=utf-8' });
  return true;
}
