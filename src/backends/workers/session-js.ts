/**
 * cloudfact's own sign-in, for the Workers that sit behind Cloudflare Access (asset gate and app proxy).
 *
 * Cloudflare Access still sends and checks the email code, but its screens never show: the Worker serves
 * its own two pages (email, then code, with a "Remember me" box) and drives Access's one-time PIN forms
 * behind them, server side:
 *   POST /.cloudfact/email → POST https://<team>/cdn-cgi/access/verify-code/<host>?kid=<aud> {email}
 *                            Access mails the code (allowed emails only) and answers with a nonce;
 *   POST /.cloudfact/code  → POST https://<team>/cdn-cgi/access/callback {code, nonce}
 *                            a wrong code sends back to Access's login page; a right one to
 *                            https://<host>/cdn-cgi/access/authorized?token=<Access JWT>.
 * The Worker verifies that JWT itself (team keys, audience, email on CLOUDFACT_ACCESS_EMAILS) and turns it
 * into its own HttpOnly cookie, HMAC-signed with the CLOUDFACT_SESSION_SECRET secret:
 *   - remembered: a persistent cookie for 400 days (the most a browser keeps one), pushed forward once a day
 *     while in use, so a remembered browser stays signed in;
 *   - not remembered: a browser-session cookie, valid for a day at most.
 * Those Access forms are not a documented API. Whenever they answer something unexpected, the visitor is
 * handed to the official way in instead: /.cloudfact/login, the one path Access guards, where a verified
 * Access token is turned into the same cookie.
 * The cookie names the email; it stops working when that email leaves CLOUDFACT_ACCESS_EMAILS, when the
 * secret changes, or on /.cloudfact/logout. Embedded after ACCESS_JS (uses enc, reply, b64url, verifyToken).
 */
import { MARK, PAGE_HEAD } from '../tunnel/gate.js';

/** Shell of the sign-in pages; {{lang}}, {{site}} and {{body}} are filled per request. No script. */
const PAGE_HTML = `${PAGE_HEAD.replace('lang="en"', 'lang="{{lang}}"')}<style>
form{margin:1.4rem auto 0;width:17rem;max-width:100%;text-align:left}
.field{display:block;font-size:13px;color:#8e8e89;margin:0 0 .35rem}
input[type=email],input[inputmode=numeric]{box-sizing:border-box;width:100%;padding:.7rem .8rem;border:1px solid #2c2c2a;
border-radius:10px;background:#161615;color:#f4f4f1;font:inherit;outline:none}
input[inputmode=numeric]{font-size:22px;letter-spacing:.35em;text-align:center}
input[type=email]:focus,input[inputmode=numeric]:focus{border-color:#8e8e89}
.check{display:flex;gap:.6rem;align-items:center;font-size:15px;color:#d6d6d1;cursor:pointer;padding:.7rem 0 0}
input[type=checkbox]{width:18px;height:18px;margin:0;accent-color:#f4f4f1}
button{margin-top:1rem;width:100%;padding:.75rem 1rem;border:0;border-radius:10px;background:#f4f4f1;color:#0d0d0d;
font:inherit;font-weight:500;cursor:pointer}button:focus-visible{outline:2px solid #f4f4f1;outline-offset:3px}
.state{margin:.2rem 0 0;font-size:14.5px;color:#8e8e89}.bad{color:#ff8a80}
.alt{display:block;margin-top:1rem;text-align:center;font-size:14px;color:#8e8e89}
</style><body><div class="box"><img src="${MARK}" alt=""><h1>{{site}}</h1>{{body}}</div></body></html>`;

export const SESSION_JS = `
// --- cloudfact's own sign-in: its pages in front, Access's one-time PIN behind, then its own cookie ---
const SESSION_COOKIE = 'cloudfact_session';
const LOGIN_PATH = '/.cloudfact/login'; // the one path Access guards: the official way in, and the fallback
const EMAIL_PATH = '/.cloudfact/email';
const CODE_PATH = '/.cloudfact/code';
const LOGOUT_PATH = '/.cloudfact/logout';
const REMEMBER_FOR = 400 * 86400; // the longest a browser keeps a cookie
const SESSION_FOR = 86400; // not remembered: until the browser closes, and a day at most
const RENEW_AFTER = 86400; // a remembered sign-in is pushed forward at most once a day
const REQUEST_RETRY_MS = 1500;
const PAGE_HTML = ${JSON.stringify(PAGE_HTML)};
const TEXT = {
  en: { email: 'Email', remember: 'Remember me', send: 'Send code', code: 'Code', signin: 'Sign in', wrong: 'Wrong code',
    other: 'Use another email', failed: 'Could not ask Cloudflare for a code', official: 'Sign in through Cloudflare', busy: 'Too many attempts. Wait a minute.' },
  pt: { email: 'E-mail', remember: 'Lembrar meu login', send: 'Enviar código', code: 'Código', signin: 'Entrar', wrong: 'Código incorreto',
    other: 'Trocar e-mail', failed: 'Não deu para pedir o código ao Cloudflare', official: 'Entrar pelo Cloudflare', busy: 'Muitas tentativas. Espere um minuto.' },
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
/** Where to go after signing in: a path on this site, never another host and never back into sign-in. */
function safeNext(value) {
  if (!value || value[0] !== '/' || value[1] === '/' || /[\\\\\\u0000-\\u001f]/.test(value) || value.startsWith('/.cloudfact/')) return '/';
  return value;
}
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function langOf(request) {
  return /^pt\\b/i.test(request.headers.get('accept-language') || '') ? 'pt' : 'en';
}
/** The official way in, through Access's own page: the fallback whenever its forms answer the unexpected. */
function officialUrl(next, remember) {
  return LOGIN_PATH + '?' + new URLSearchParams({ remember: remember ? '1' : '', next }).toString();
}
function page(request, url, status, body) {
  // functions, not strings, as replacements: a "$&" in an email must stay text
  const html = PAGE_HTML.replace('{{lang}}', () => langOf(request))
    .replace('{{site}}', () => escapeHtml(url.host.split('.')[0]))
    .replace('{{body}}', () => body);
  return reply(status, html, { 'content-type': 'text/html; charset=utf-8' });
}
function emailPage(request, url, opts) {
  const t = TEXT[langOf(request)];
  const state = opts.failed
    ? '<p class="state bad">' + t.failed + '</p><a class="alt" href="' + escapeHtml(officialUrl(opts.next, opts.remember)) + '">' + t.official + '</a>'
    : opts.busy ? '<p class="state bad">' + t.busy + '</p>' : '';
  return page(request, url, opts.status || 200,
    '<form method="post" action="' + EMAIL_PATH + '"><input type="hidden" name="next" value="' + escapeHtml(opts.next) + '">' +
    '<label class="field" for="email">' + t.email + '</label>' +
    '<input id="email" type="email" name="email" required autofocus autocomplete="email" spellcheck="false" autocapitalize="none" value="' + escapeHtml(opts.email || '') + '">' +
    '<label class="check"><input type="checkbox" name="remember" value="1"' + (opts.remember === false ? '' : ' checked') + '>' + t.remember + '</label>' +
    '<button type="submit">' + t.send + '</button></form>' + state);
}
function codePage(request, url, opts) {
  const t = TEXT[langOf(request)];
  const state = opts.wrong ? '<p class="state bad">' + t.wrong + '</p>' : opts.busy ? '<p class="state bad">' + t.busy + '</p>' : '';
  return page(request, url, opts.status || 200,
    '<p class="state">' + escapeHtml(opts.email) + '</p>' +
    '<form method="post" action="' + CODE_PATH + '">' +
    '<input type="hidden" name="nonce" value="' + escapeHtml(opts.nonce) + '"><input type="hidden" name="next" value="' + escapeHtml(opts.next) + '">' +
    '<input type="hidden" name="email" value="' + escapeHtml(opts.email) + '"><input type="hidden" name="remember" value="' + (opts.remember ? '1' : '') + '">' +
    '<label class="field" for="code">' + t.code + '</label>' +
    '<input id="code" type="text" name="code" required autofocus inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="000000">' +
    '<button type="submit">' + t.signin + '</button></form>' + state +
    '<a class="alt" href="' + escapeHtml(opts.next) + '">' + t.other + '</a>');
}
/** Per-IP limit on the sign-in forms, when the Worker has the rate-limit binding. */
async function limited(env, request, what) {
  if (!env.SESSION_LIMIT) return false;
  try {
    const { success } = await env.SESSION_LIMIT.limit({ key: what + ':' + (request.headers.get('cf-connecting-ip') || 'unknown') });
    return !success;
  } catch {
    return false;
  }
}
const form = (fields) => ({ method: 'POST', body: new URLSearchParams(fields).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
/**
 * Asks Access to mail a code to \`email\`. Returns the nonce that goes with it, or null. Access turns away
 * bursts of requests from Workers for about a minute, so a refusal gets one more try a moment later.
 */
async function requestCode(env, url, email, next, remember) {
  const team = 'https://' + env.CLOUDFACT_ACCESS_TEAM;
  const target = team + '/cdn-cgi/access/verify-code/' + url.host + '?' + new URLSearchParams({ kid: env.CLOUDFACT_ACCESS_AUD, redirect_url: officialUrl(next, remember) });
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, REQUEST_RETRY_MS));
    const res = await fetch(target, form({ email, client_id: '', connector_id: '', connector_type: '', redirect_url: '' }));
    const location = res.headers.get('location');
    if (res.status < 300 || res.status > 399 || !location) continue;
    const nonce = new URL(location, team).searchParams.get('nonce');
    if (nonce && /^[A-Za-z0-9_-]{8,256}$/.test(nonce)) return nonce;
  }
  return null;
}
/** Hands the code to Access. { wrong } for a code it refused; { to } where it sends a code it took; null otherwise. */
async function checkCode(env, code, nonce) {
  const team = 'https://' + env.CLOUDFACT_ACCESS_TEAM;
  const res = await fetch(team + '/cdn-cgi/access/callback', form({ code, nonce }));
  const location = res.headers.get('location');
  if (res.status < 300 || res.status > 399 || !location) return null;
  const to = new URL(location, team);
  if (to.host === env.CLOUDFACT_ACCESS_TEAM && to.pathname.startsWith('/cdn-cgi/access/login/')) return { wrong: true };
  return { to };
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
  if (url.pathname === EMAIL_PATH || url.pathname === CODE_PATH) {
    if (request.method !== 'POST') return { response: reply(303, null, { location: '/' }) };
    const origin = request.headers.get('origin');
    if (origin && origin !== 'https://' + url.host) return { response: reply(403, 'cloudfact: sign-in forms only take posts from this site', { 'content-type': 'text/plain' }) };
    if (!env.CLOUDFACT_SESSION_SECRET) return { response: reply(503, 'cloudfact: sign-in is not configured for this site yet', { 'content-type': 'text/plain' }) };
    let fields;
    try {
      fields = new URLSearchParams(await request.text());
    } catch {
      fields = new URLSearchParams();
    }
    const next = safeNext(fields.get('next'));
    const remember = fields.get('remember') === '1';
    const email = (fields.get('email') || '').trim().toLowerCase().slice(0, 254);
    if (url.pathname === EMAIL_PATH) {
      if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) return { response: emailPage(request, url, { next, remember, email, status: 400 }) };
      if (await limited(env, request, 'email')) return { response: emailPage(request, url, { next, remember, email, busy: true, status: 429 }) };
      let nonce = null;
      try {
        nonce = await requestCode(env, url, email, next, remember);
      } catch {
        nonce = null;
      }
      if (!nonce) return { response: emailPage(request, url, { next, remember, email, failed: true, status: 502 }) };
      return { response: codePage(request, url, { next, remember, email, nonce }) };
    }
    const nonce = fields.get('nonce') || '';
    const code = (fields.get('code') || '').replace(/\\s+/g, '');
    if (!/^[A-Za-z0-9_-]{8,256}$/.test(nonce)) return { response: emailPage(request, url, { next, remember, email, status: 400 }) };
    if (await limited(env, request, 'code')) return { response: codePage(request, url, { next, remember, email, nonce, busy: true, status: 429 }) };
    if (!/^[0-9]{6}$/.test(code)) return { response: codePage(request, url, { next, remember, email, nonce, wrong: true, status: 401 }) };
    let answer = null;
    try {
      answer = await checkCode(env, code, nonce);
    } catch {
      answer = null;
    }
    if (!answer) return { response: emailPage(request, url, { next, remember, email, failed: true, status: 502 }) };
    if (answer.wrong) return { response: codePage(request, url, { next, remember, email, nonce, wrong: true, status: 401 }) };
    // Access took the code: its token for this app rides in the redirect to /cdn-cgi/access/authorized
    const token = answer.to.host === url.host && answer.to.pathname === '/cdn-cgi/access/authorized' ? answer.to.searchParams.get('token') : null;
    let claims = false;
    try {
      claims = token ? await verifyToken(token, env.CLOUDFACT_ACCESS_TEAM, env.CLOUDFACT_ACCESS_AUD) : false;
    } catch {
      claims = false;
    }
    const who = claims && typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
    if (who && allowedEmails(env).includes(who))
      return { response: reply(303, null, { location: next, 'set-cookie': await sessionCookie(env, who, remember) }) };
    // not the shape expected: let the browser finish the official way (it ends at LOGIN_PATH, which signs in)
    return { response: reply(303, null, { location: answer.to.toString() }) };
  }
  const session = await readSession(request, env);
  if (session) {
    const stale = session.r === 1 && Math.floor(Date.now() / 1000) - session.iat > RENEW_AFTER;
    return { renew: stale ? await sessionCookie(env, session.e, true) : null };
  }
  if (request.method === 'GET' && (request.headers.get('accept') || '').includes('text/html'))
    return { response: emailPage(request, url, { next: safeNext(url.pathname + url.search) }) };
  return { response: reply(401, 'cloudfact: not signed in. Open https://' + url.host + '/ to sign in.', { 'content-type': 'text/plain' }) };
}
`;
