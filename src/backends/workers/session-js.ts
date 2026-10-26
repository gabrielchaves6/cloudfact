/**
 * cloudfact's own sign-in, for the Workers that sit behind Cloudflare Access (asset gate and app proxy).
 *
 * One page, in the CloudFacts look, the same flow as the private Stash's entry: the email ("Get a code",
 * plus a "Remember me" box), then the 6-digit code from the email; the request stays in the browser for the
 * code's lifetime, because a phone often reloads the page on the way to the inbox and back. Two ways to get
 * the code behind it, through the same JSON routes (POST /.cloudfact/code, then POST /.cloudfact/enter):
 *
 *   - email (RESEND_API_KEY secret and LOGIN Durable Object binding present): the Worker mails the code
 *     itself through Resend, from "CloudFact <onboarding@resend.dev>" (CLOUDFACT_MAIL_FROM overrides), and
 *     checks it against the LOGIN Durable Object, with the Stash's rules (see login-store-js.ts). Only
 *     addresses on CLOUDFACT_ACCESS_EMAILS get a code; any other gets the same answer and an unguessable
 *     code, so the page never tells which address has access. Cloudflare Access is not involved.
 *   - Access (no Resend key yet): Cloudflare Access mails and checks the code. The Worker fills in Access's
 *     one-time PIN forms behind the page (/cdn-cgi/access/verify-code, then /cdn-cgi/access/callback) and
 *     verifies the Access JWT a right code yields. Those forms are not a documented API, so anything
 *     unexpected hands the visitor to /.cloudfact/login, the one path Access guards, Cloudflare's own page.
 *
 * Either way a right code becomes the Worker's own HttpOnly cookie, HMAC-signed with CLOUDFACT_SESSION_SECRET:
 *   - remembered: a persistent cookie for 400 days (the most a browser keeps one), pushed forward once a day
 *     while in use, so a remembered browser stays signed in;
 *   - not remembered: a browser-session cookie, valid for a day at most.
 * The cookie names the email; it stops working when that email leaves CLOUDFACT_ACCESS_EMAILS, when the
 * secret changes, or on /.cloudfact/logout. Embedded after ACCESS_JS (uses enc, reply, b64url, verifyToken).
 */
import { MARK, PAGE_HEAD } from '../tunnel/gate.js';

/** The page's script, as in the Stash's login/entrar.js: the steps, the request kept on this device, errors. */
const PAGE_JS = String.raw`(() => {
  const PENDING = "cloudfact.loginRequest";
  const $ = (selector) => document.querySelector(selector);
  const box = $("#lock"), say = box.dataset;
  const next = location.pathname + location.search;
  const pending = {
    read() { try { const p = JSON.parse(localStorage.getItem(PENDING) || "null"); return p && p.request && p.until > Date.now() ? p : null; } catch { return null; } },
    save(value) { try { localStorage.setItem(PENDING, JSON.stringify(Object.assign({}, value, { until: Date.now() + 3600000 }))); } catch {} },
    clear() { try { localStorage.removeItem(PENDING); } catch {} },
  };
  async function post(route, payload) {
    let response;
    try {
      response = await fetch("/.cloudfact/" + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
                                                        cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(30000) });
    } catch { throw new Error(say.offline); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error || say.failed); error.official = data.official; throw error; }
    return data;
  }
  let asked = pending.read();
  function show(step, message) {
    const code = step === "code";
    $("#title").textContent = code ? say.check : say.site;
    $("#hint").textContent = code ? asked.email : ""; $("#hint").hidden = !code;
    $("#emailForm").hidden = code; $("#codeForm").hidden = !code; $("#back").hidden = !code; $("#official").hidden = true;
    $("#msg").textContent = message || ""; $("#err").textContent = "";
    (code ? $("#code") : $("#email")).focus();
  }
  async function submit(event, work) {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true; $("#err").textContent = ""; $("#official").hidden = true;
    try { await work(); } catch (error) {
      $("#err").textContent = error.message;
      if (error.official) { $("#official").href = error.official; $("#official").hidden = false; }
    }
    button.disabled = false;
  }
  $("#emailForm").addEventListener("submit", (event) => submit(event, async () => {
    const email = $("#email").value.trim(), remember = $("#remember").checked;
    const data = await post("code", { email, remember, next });
    asked = { request: data.request, email, remember };
    pending.save(asked);
    $("#codeForm").reset();
    show("code", data.message);
  }));
  $("#codeForm").addEventListener("submit", (event) => submit(event, async () => {
    $("#msg").textContent = "";
    const data = await post("enter", { request: asked.request, code: $("#code").value, remember: asked.remember, next });
    pending.clear();
    location.replace(data.next);
    await new Promise(() => {}); // keep the button off while the page opens
  }));
  $("#back").addEventListener("click", () => {
    $("#email").value = (asked && asked.email) || "";
    pending.clear(); asked = null;
    show("email");
  });
  if (asked) { $("#email").value = asked.email; $("#remember").checked = asked.remember !== false; show("code"); } else show("email");
})();`;

/** The page; {{…}} slots are filled per request (language from Accept-Language). */
const PAGE_HTML = `${PAGE_HEAD.replace('lang="en"', 'lang="{{lang}}"')}<style>
#lock{width:17rem;max-width:100%}
form{margin:1.2rem auto 0;text-align:left}
label.field{display:block;font-size:13px;color:#8e8e89;margin:0 0 .35rem}
input[type=email],#code{box-sizing:border-box;width:100%;padding:.7rem .8rem;border:1px solid #2c2c2a;
border-radius:10px;background:#161615;color:#f4f4f1;font:inherit;outline:none}
#code{font-size:24px;font-weight:600;letter-spacing:.3em;text-align:center}
input[type=email]:focus,#code:focus{border-color:#8e8e89}
input:-webkit-autofill{-webkit-box-shadow:0 0 0 40px #161615 inset;-webkit-text-fill-color:#f4f4f1;caret-color:#f4f4f1}
.check{display:flex;gap:.6rem;align-items:center;font-size:15px;color:#d6d6d1;cursor:pointer;padding:.7rem 0 0}
input[type=checkbox]{width:18px;height:18px;margin:0;accent-color:#f4f4f1}
button{font:inherit;cursor:pointer;border:0;border-radius:10px}
form button{margin-top:1rem;width:100%;padding:.75rem 1rem;background:#f4f4f1;color:#0d0d0d;font-weight:500}
button:disabled{opacity:.45;cursor:default}button:focus-visible{outline:2px solid #f4f4f1;outline-offset:3px}
#hint{margin:.1rem 0 0;font-size:14.5px;color:#8e8e89;overflow-wrap:anywhere}
#msg,#err{margin:.9rem 0 0;font-size:13.5px;line-height:1.5;overflow-wrap:anywhere}#msg{color:#b9b9b4}#err{color:#ff8a80}
#msg:empty,#err:empty{display:none}
.alt{display:block;margin:1rem auto 0;background:none;padding:.3rem;text-align:center;font-size:14px;color:#8e8e89}
[hidden]{display:none!important}
</style><body><div class="box" id="lock" data-site="{{site}}" data-check="{{check}}" data-offline="{{offline}}" data-failed="{{failed}}">
<img src="${MARK}" alt=""><h1 id="title">{{site}}</h1><p id="hint" hidden></p>
<form id="emailForm" hidden><label class="field" for="email">{{yourEmail}}</label>
<input id="email" type="email" autocomplete="email" required maxlength="254" spellcheck="false" autocapitalize="none" placeholder="{{placeholder}}">
<label class="check"><input id="remember" type="checkbox" checked>{{remember}}</label>
<button type="submit">{{getCode}}</button></form>
<form id="codeForm" hidden><label class="field" for="code">{{emailCode}}</label>
<input id="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]*" maxlength="7" required placeholder="000 000">
<button type="submit">{{signin}}</button></form>
<p id="msg" role="status" aria-live="polite"></p><p id="err" role="alert"></p>
<button type="button" class="alt" id="back" hidden>{{other}}</button><a class="alt" id="official" href="/" hidden>{{official}}</a>
<noscript><p id="err" style="display:block">{{noscript}}</p></noscript>
</div><script>${PAGE_JS}</script></body></html>`;

/** The email with the code, in the CloudFacts look; {{…}} filled per message. */
const MAIL_HTML =
  "<div style=\"font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;max-width:420px;margin:0 auto;" +
  'padding:28px 24px;background:#0d0d0d;color:#f4f4f1;border-radius:14px;text-align:center">' +
  '<div style="font-size:18px;font-weight:600;margin:0 0 4px">CloudFact</div>' +
  '<div style="font-size:14px;color:#8e8e89;margin:0 0 18px">{{intro}}</div>' +
  '<div style="font-size:34px;font-weight:700;letter-spacing:6px;-webkit-user-select:all;user-select:all;margin:0 0 18px">{{code}}</div>' +
  '<div style="font-size:13px;color:#8e8e89">{{valid}}</div></div>';

export const SESSION_JS = String.raw`
// --- cloudfact's own sign-in: its page in front; the code by its own email, or by Access's behind it ---
const SESSION_COOKIE = 'cloudfact_session';
const LOGIN_PATH = '/.cloudfact/login'; // the one path Access guards: the official way in
const ASK_PATH = '/.cloudfact/code';
const ENTER_PATH = '/.cloudfact/enter';
const LOGOUT_PATH = '/.cloudfact/logout';
const REMEMBER_FOR = 400 * 86400; // the longest a browser keeps a cookie
const SESSION_FOR = 86400; // not remembered: until the browser closes, and a day at most
const RENEW_AFTER = 86400; // a remembered sign-in is pushed forward at most once a day
const REQUEST_RETRY_MS = 1500;
const MAIL_RETRY_MS = 3000;
const RESEND = 'https://api.resend.com/emails';
const MAIL_FROM = 'CloudFact <onboarding@resend.dev>'; // Resend's own domain: delivers to the account owner only
const PAGE_HTML = ${JSON.stringify(PAGE_HTML)};
const MAIL_HTML = ${JSON.stringify(MAIL_HTML)};
const TEXT = {
  en: { yourEmail: 'Your email', placeholder: 'you@example.com', remember: 'Remember me', getCode: 'Get a code', check: 'Check your email',
    emailCode: 'Code from the email', signin: 'Sign in', other: 'Use another email', official: 'Sign in through Cloudflare',
    noscript: 'This page needs JavaScript to sign you in.', offline: 'Could not connect. Check the connection and try again.',
    failed: 'Could not finish. Try again.', generic: 'If this email has access, the code arrives in a moment. Check the spam folder too.',
    badEmail: 'Enter a valid email.', busy: 'Too many requests. Try again in a few minutes.', newCode: 'Ask for a new code.',
    sixDigits: 'Type the 6 digits of the code.', expired: 'Code expired. Ask for a new one.', wrong: 'Wrong code.',
    wrongLast: 'Wrong code. Ask for a new one.', refused: 'Request refused.', invalid: 'Invalid request.',
    accessDown: 'Could not ask Cloudflare for a code', notReady: 'Sign-in is not set up for this site yet.',
    subject: 'Your CloudFact code: ', intro: 'Your sign-in code for ', valid: 'Valid for 1 hour.' },
  pt: { yourEmail: 'Seu e-mail', placeholder: 'voce@exemplo.com', remember: 'Lembrar meu login', getCode: 'Receber um código', check: 'Confira seu e-mail',
    emailCode: 'Código do e-mail', signin: 'Entrar', other: 'Usar outro e-mail', official: 'Entrar pelo Cloudflare',
    noscript: 'Esta página precisa de JavaScript para entrar.', offline: 'Não foi possível conectar. Confira a conexão e tente de novo.',
    failed: 'Não foi possível concluir. Tente de novo.', generic: 'Se este e-mail tiver acesso, o código chega em instantes. Confira também o spam.',
    badEmail: 'Informe um e-mail válido.', busy: 'Muitos pedidos. Tente de novo em alguns minutos.', newCode: 'Peça um novo código.',
    sixDigits: 'Digite os 6 números do código.', expired: 'Código vencido. Peça um novo.', wrong: 'Código incorreto.',
    wrongLast: 'Código incorreto. Peça um novo.', refused: 'Pedido recusado.', invalid: 'Pedido inválido.',
    accessDown: 'Não deu para pedir o código ao Cloudflare', notReady: 'A entrada deste site ainda não foi configurada.',
    subject: 'Seu código do CloudFact: ', intro: 'Seu código para entrar em ', valid: 'Vale por 1 hora.' },
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
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
async function sha256(text) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))));
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
  if (typeof value !== 'string' || value.length > 2048 || value[0] !== '/' || value[1] === '/' || /[\\\u0000-\u001f]/.test(value) || value.startsWith('/.cloudfact/')) return '/';
  return value;
}
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function langOf(request) {
  return /^pt\b/i.test(request.headers.get('accept-language') || '') ? 'pt' : 'en';
}
const siteOf = (url) => url.host.split('.')[0];
/** The official way in, through Access's own page. */
function officialUrl(next, remember) {
  return LOGIN_PATH + '?' + new URLSearchParams({ remember: remember ? '1' : '', next }).toString();
}
function loginPage(request, url) {
  const lang = langOf(request);
  const slots = Object.assign({}, TEXT[lang], { lang, site: siteOf(url) });
  const html = PAGE_HTML.replace(/\{\{(\w+)\}\}/g, (_, k) => escapeHtml(slots[k] === undefined ? '' : slots[k]));
  return reply(200, html, { 'content-type': 'text/html; charset=utf-8' });
}
const jsonReply = (status, body, headers) => reply(status, JSON.stringify(body), { 'content-type': 'application/json; charset=utf-8', ...headers });
/** The address as the Stash takes it: trimmed, case-folded, and shaped like an address; otherwise null. */
function emailAddress(value) {
  if (typeof value !== 'string') return null;
  const address = value.trim().toLowerCase();
  if (address.length > 254 || !/^[a-z0-9.!#$%&'*+\/=?^_\x60{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(address)) return null;
  return address;
}
function newRequest() {
  return toB64url(crypto.getRandomValues(new Uint8Array(24))); // 32 characters, as secrets.token_urlsafe(24)
}
function newCode() {
  const buf = new Uint32Array(1);
  let n;
  do {
    crypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= 4294000000); // drop the tail so every code is equally likely
  return String(n % 1000000).padStart(6, '0');
}
const codeHash = (request, code) => sha256(request + ':' + code);
const mailReady = (env) => Boolean(env.RESEND_API_KEY && env.LOGIN);
async function loginStore(env, body) {
  const stub = env.LOGIN.get(env.LOGIN.idFromName('login'));
  const res = await stub.fetch('https://login/', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  return res.json();
}
/** Mails the code through Resend; one more try on a server error, a 429 or no network. Never logs the key or the code. */
async function sendCode(env, lang, site, address, code, request) {
  const t = TEXT[lang];
  const html = MAIL_HTML.replace('{{intro}}', escapeHtml(t.intro + site)).replace('{{code}}', code).replace('{{valid}}', t.valid);
  const payload = { from: env.CLOUDFACT_MAIL_FROM || MAIL_FROM, to: [address], subject: t.subject + code, text: t.subject + code + '\n\n' + t.valid + '\n', html };
  const headers = { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json', 'user-agent': 'CloudFact-Login/1.0', 'idempotency-key': 'cloudfact-login-' + request };
  let status = 'network';
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, MAIL_RETRY_MS));
    try {
      const res = await fetch(RESEND, { method: 'POST', headers, body: JSON.stringify(payload) });
      status = res.status;
      if (res.ok) {
        console.log(JSON.stringify({ mail: 'sent' }));
        return;
      }
      if (status < 500 && status !== 429) break;
    } catch {
      status = 'network';
    }
  }
  console.log(JSON.stringify({ mail: 'failed', status }));
}
const form = (fields) => ({ method: 'POST', body: new URLSearchParams(fields).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
/** Access way: asks Access to mail a code. The nonce that goes with it, or null; one retry, as Access turns away bursts from Workers. */
async function accessAsk(env, url, email, next, remember) {
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
/** Access way: { wrong } for a code it refused; { to } where it sends a code it took; null otherwise. */
async function accessCheck(env, code, nonce) {
  const team = 'https://' + env.CLOUDFACT_ACCESS_TEAM;
  const res = await fetch(team + '/cdn-cgi/access/callback', form({ code, nonce }));
  const location = res.headers.get('location');
  if (res.status < 300 || res.status > 399 || !location) return null;
  const to = new URL(location, team);
  if (to.host === env.CLOUDFACT_ACCESS_TEAM && to.pathname.startsWith('/cdn-cgi/access/login/')) return { wrong: true };
  return { to };
}
/** Per-IP limit on the Access way's routes, when the Worker has the rate-limit binding. */
async function limited(env, request, what) {
  if (!env.SESSION_LIMIT) return false;
  try {
    const { success } = await env.SESSION_LIMIT.limit({ key: what + ':' + (request.headers.get('cf-connecting-ip') || 'unknown') });
    return !success;
  } catch {
    return false;
  }
}
/** POST /.cloudfact/code {email, remember, next} → { ok, request, message } — the same answer for any address. */
async function askCode(request, env, ctx, url, t, lang, payload) {
  const address = emailAddress(payload.email);
  if (!address) return jsonReply(400, { error: t.badEmail });
  const next = safeNext(payload.next);
  const remember = payload.remember !== false;
  if (!mailReady(env)) {
    if (await limited(env, request, 'email')) return jsonReply(429, { error: t.busy });
    let nonce = null;
    try {
      nonce = await accessAsk(env, url, address, next, remember);
    } catch {
      nonce = null;
    }
    if (!nonce) return jsonReply(502, { error: t.accessDown, official: officialUrl(next, remember) });
    return jsonReply(200, { ok: true, request: nonce, message: t.generic });
  }
  const id = newRequest();
  const code = newCode();
  const allowed = allowedEmails(env).includes(address);
  // another address gets an unguessable code, so a wrong guess reads the same for both
  const hash = allowed ? await codeHash(id, code) : hex(crypto.getRandomValues(new Uint8Array(32)));
  const stored = await loginStore(env, { op: 'ask', request: id, hash, addressKey: await sha256(address), address: allowed ? address : null });
  if (stored.error === 'busy') return jsonReply(429, { error: t.busy });
  if (!stored.ok) return jsonReply(500, { error: t.failed });
  if (allowed) {
    const sending = sendCode(env, lang, siteOf(url), address, code, id);
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(sending);
    else await sending;
  }
  return jsonReply(200, { ok: true, request: id, message: t.generic });
}
/** POST /.cloudfact/enter {request, code, remember, next} → { ok, next } plus the session cookie. */
async function enterCode(request, env, url, t, payload) {
  const code = typeof payload.code === 'string' ? payload.code.replace(/\s/g, '') : '';
  const id = typeof payload.request === 'string' ? payload.request : '';
  const next = safeNext(payload.next);
  const remember = payload.remember !== false;
  if (!mailReady(env)) {
    if (!/^[A-Za-z0-9_-]{8,256}$/.test(id)) return jsonReply(400, { error: t.newCode });
    if (!/^\d{6}$/.test(code)) return jsonReply(400, { error: t.sixDigits });
    if (await limited(env, request, 'code')) return jsonReply(429, { error: t.busy });
    let result = null;
    try {
      result = await accessCheck(env, code, id);
    } catch {
      result = null;
    }
    if (!result) return jsonReply(502, { error: t.accessDown, official: officialUrl(next, remember) });
    if (result.wrong) return jsonReply(400, { error: t.wrong });
    // Access took the code: its token for this app rides in the redirect to /cdn-cgi/access/authorized
    const token = result.to.host === url.host && result.to.pathname === '/cdn-cgi/access/authorized' ? result.to.searchParams.get('token') : null;
    let claims = false;
    try {
      claims = token ? await verifyToken(token, env.CLOUDFACT_ACCESS_TEAM, env.CLOUDFACT_ACCESS_AUD) : false;
    } catch {
      claims = false;
    }
    const who = claims && typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
    if (who && allowedEmails(env).includes(who)) return jsonReply(200, { ok: true, next }, { 'set-cookie': await sessionCookie(env, who, remember) });
    return jsonReply(200, { ok: true, next: result.to.toString() }); // not the shape expected: the browser finishes the official way
  }
  if (!/^[A-Za-z0-9_-]{32}$/.test(id)) return jsonReply(400, { error: t.newCode });
  if (!/^\d{6}$/.test(code)) return jsonReply(400, { error: t.sixDigits });
  const result = await loginStore(env, { op: 'enter', request: id, hash: await codeHash(id, code) });
  if (result.error === 'expired') return jsonReply(400, { error: t.expired });
  if (result.error === 'wrong') return jsonReply(400, { error: t.wrong });
  if (result.error === 'wrong-last') return jsonReply(400, { error: t.wrongLast });
  if (!result.ok) return jsonReply(500, { error: t.failed });
  // only an allowed address ever had a code that can be right: the one it was mailed to names the session
  const who = typeof result.address === 'string' ? result.address : '';
  if (!allowedEmails(env).includes(who)) return jsonReply(400, { error: t.expired });
  console.log(JSON.stringify({ login: 'ok' }));
  return jsonReply(200, { ok: true, next }, { 'set-cookie': await sessionCookie(env, who, remember) });
}
/**
 * Access mode, before anything else: { response } answers instead of the site; { renew } lets the request
 * through, with a fresh cookie to send back (or null).
 */
async function signIn(request, env, url, ctx) {
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
    return { response: reply(303, null, { location: '/', 'set-cookie': SESSION_COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' }) };
  if (url.pathname === ASK_PATH || url.pathname === ENTER_PATH) {
    const lang = langOf(request);
    const t = TEXT[lang];
    if (request.method !== 'POST') return { response: jsonReply(405, { error: t.invalid }, { allow: 'POST' }) };
    const origin = request.headers.get('origin');
    if ((origin && origin !== 'https://' + url.host) || !(request.headers.get('content-type') || '').startsWith('application/json'))
      return { response: jsonReply(403, { error: t.refused }) };
    if (!env.CLOUDFACT_SESSION_SECRET) return { response: jsonReply(503, { error: t.notReady }) };
    let payload;
    try {
      const text = await request.text();
      if (!text || text.length > 4096) throw new Error('size');
      payload = JSON.parse(text);
    } catch {
      return { response: jsonReply(400, { error: t.invalid }) };
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { response: jsonReply(400, { error: t.invalid }) };
    try {
      if (url.pathname === ASK_PATH) return { response: await askCode(request, env, ctx, url, t, lang, payload) };
      return { response: await enterCode(request, env, url, t, payload) };
    } catch {
      console.log(JSON.stringify({ error: 'unexpected' })); // never the exception: it may carry the Resend key
      return { response: jsonReply(500, { error: t.failed }) };
    }
  }
  const session = await readSession(request, env);
  if (session) {
    const stale = session.r === 1 && Math.floor(Date.now() / 1000) - session.iat > RENEW_AFTER;
    return { renew: stale ? await sessionCookie(env, session.e, true) : null };
  }
  if (request.method === 'GET' && (request.headers.get('accept') || '').includes('text/html')) return { response: loginPage(request, url) };
  return { response: reply(401, 'cloudfact: not signed in. Open https://' + url.host + '/ to sign in.', { 'content-type': 'text/plain' }) };
}
`;
