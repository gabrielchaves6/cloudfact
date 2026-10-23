/**
 * cloudfact's own sign-in cookie, for the Workers that sit behind Cloudflare Access (asset gate and app proxy).
 *
 * Access stays the only way in, but it guards one path only, /.cloudfact/login: a visitor without a session
 * gets a sign-in page with a "Remember me" box, the button goes through Access (email code, or nothing when
 * the Access session is still alive), and the Worker turns the verified Access token into its own cookie,
 * HMAC-signed with the CLOUDFACT_SESSION_SECRET secret:
 *   - remembered: a persistent cookie for 400 days (the most a browser keeps one), pushed forward once a day
 *     while in use, so a remembered browser stays signed in;
 *   - not remembered: a browser-session cookie, valid for a day at most.
 * The cookie names the email; it stops working when that email leaves CLOUDFACT_ACCESS_EMAILS, when the
 * secret changes, or on /.cloudfact/logout. Embedded after ACCESS_JS (uses enc, reply, b64url, verifyAccess).
 */
import { MARK, PAGE_HEAD } from '../tunnel/gate.js';

/** Sign-in page; {{…}} slots are filled per request (language from Accept-Language). No script. */
const LOGIN_HTML = `${PAGE_HEAD.replace('lang="en"', 'lang="{{lang}}"')}<style>
form{margin:1.4rem auto 0;max-width:17rem;text-align:left}
label{display:flex;gap:.6rem;align-items:center;font-size:15px;color:#d6d6d1;cursor:pointer;padding:.4rem 0}
input[type=checkbox]{width:18px;height:18px;margin:0;accent-color:#f4f4f1}
button{margin-top:1rem;width:100%;padding:.75rem 1rem;border:0;border-radius:10px;background:#f4f4f1;color:#0d0d0d;
font:inherit;font-weight:500;cursor:pointer}button:focus-visible{outline:2px solid #f4f4f1;outline-offset:3px}
</style><body><div class="box"><img src="${MARK}" alt=""><h1>{{site}}</h1>
<form method="get" action="/.cloudfact/login"><input type="hidden" name="next" value="{{next}}">
<label><input type="checkbox" name="remember" value="1" checked>{{remember}}</label>
<button type="submit">{{signin}}</button></form></div></body></html>`;

export const SESSION_JS = `
// --- cloudfact's own sign-in cookie ("Remember me"), minted once Access has vouched for the visitor ---
const SESSION_COOKIE = 'cloudfact_session';
const LOGIN_PATH = '/.cloudfact/login';
const LOGOUT_PATH = '/.cloudfact/logout';
const REMEMBER_FOR = 400 * 86400; // the longest a browser keeps a cookie
const SESSION_FOR = 86400; // not remembered: until the browser closes, and a day at most
const RENEW_AFTER = 86400; // a remembered sign-in is pushed forward at most once a day
const LOGIN_HTML = ${JSON.stringify(LOGIN_HTML)};
const LOGIN_TEXT = {
  en: { signin: 'Sign in', remember: 'Remember me' },
  pt: { signin: 'Entrar', remember: 'Lembrar meu login' },
};
function cookieNamed(request, name) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}
function toB64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
}
let sessionKeyCache = { secret: null, key: null };
async function sessionKey(secret) {
  if (sessionKeyCache.secret !== secret)
    sessionKeyCache = { secret, key: await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']) };
  return sessionKeyCache.key;
}
function allowedEmails(env) {
  return (env.CLOUDFACT_ACCESS_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}
async function sessionCookie(env, email, remember) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { e: email, a: env.CLOUDFACT_ACCESS_AUD, r: remember ? 1 : 0, iat: now, exp: now + (remember ? REMEMBER_FOR : SESSION_FOR) };
  const body = toB64url(enc.encode(JSON.stringify(claims)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await sessionKey(env.CLOUDFACT_SESSION_SECRET), enc.encode(body)));
  return SESSION_COOKIE + '=' + body + '.' + toB64url(sig) + '; Path=/; HttpOnly; Secure; SameSite=Lax' + (remember ? '; Max-Age=' + REMEMBER_FOR : '');
}
async function readSession(request, env) {
  const raw = cookieNamed(request, SESSION_COOKIE);
  if (!raw || !env.CLOUDFACT_SESSION_SECRET) return null;
  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  let claims;
  try {
    if (!(await crypto.subtle.verify('HMAC', await sessionKey(env.CLOUDFACT_SESSION_SECRET), b64url(parts[1]), enc.encode(parts[0])))) return null;
    claims = JSON.parse(new TextDecoder().decode(b64url(parts[0])));
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (!claims || typeof claims.exp !== 'number' || claims.exp <= now || claims.a !== env.CLOUDFACT_ACCESS_AUD) return null;
  if (typeof claims.e !== 'string' || !allowedEmails(env).includes(claims.e.toLowerCase())) return null;
  return claims;
}
/** Where to go after signing in: a path on this site, never another host and never back to the login. */
function safeNext(value) {
  if (!value || value[0] !== '/' || value[1] === '/' || /[\\\\\\u0000-\\u001f]/.test(value) || value.startsWith('/.cloudfact/')) return '/';
  return value;
}
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function loginPage(request, url) {
  const lang = /^pt\\b/i.test(request.headers.get('accept-language') || '') ? 'pt' : 'en';
  const t = LOGIN_TEXT[lang];
  const slots = { lang, site: escapeHtml(url.host.split('.')[0]), next: escapeHtml(safeNext(url.pathname + url.search)), remember: t.remember, signin: t.signin };
  return LOGIN_HTML.replace(/\\{\\{(\\w+)\\}\\}/g, (_, k) => slots[k]);
}
/**
 * Access mode, before anything else: { response } answers instead of the site; { renew } lets the request
 * through, with a fresh cookie to send back (or null).
 */
async function signIn(request, env, url) {
  if (url.pathname === LOGIN_PATH) {
    // Cloudflare Access guards this one path: a request only gets here signed in, with its token
    let claims = false;
    try {
      claims = await verifyAccess(request, env.CLOUDFACT_ACCESS_TEAM, env.CLOUDFACT_ACCESS_AUD);
    } catch {
      claims = false;
    }
    const email = claims && typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
    if (!email || !allowedEmails(env).includes(email))
      return { response: reply(403, 'cloudfact: Cloudflare Access did not vouch for an allowed email on this request.', { 'content-type': 'text/plain' }) };
    if (!env.CLOUDFACT_SESSION_SECRET) return { response: reply(503, 'cloudfact: sign-in is not configured for this site yet', { 'content-type': 'text/plain' }) };
    const remember = url.searchParams.get('remember') === '1';
    return { response: reply(303, null, { location: safeNext(url.searchParams.get('next')), 'set-cookie': await sessionCookie(env, email, remember) }) };
  }
  if (url.pathname === LOGOUT_PATH)
    return { response: reply(303, null, { location: '/cdn-cgi/access/logout', 'set-cookie': SESSION_COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' }) };
  const session = await readSession(request, env);
  if (session) {
    const stale = session.r === 1 && Math.floor(Date.now() / 1000) - session.iat > RENEW_AFTER;
    return { renew: stale ? await sessionCookie(env, session.e, true) : null };
  }
  if (request.method === 'GET' && (request.headers.get('accept') || '').includes('text/html'))
    return { response: reply(200, loginPage(request, url), { 'content-type': 'text/html; charset=utf-8' }) };
  return { response: reply(401, 'cloudfact: not signed in. Open https://' + url.host + '/ to sign in.', { 'content-type': 'text/plain' }) };
}
`;
