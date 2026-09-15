import { createRequire as __cloudfactRequire } from 'node:module'; const require = __cloudfactRequire(import.meta.url);

// src/backends/tunnel/host.ts
import fs7 from "fs";
import http2 from "http";
import path6 from "path";
import { spawn } from "child_process";

// src/config.ts
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
var here = path.dirname(fileURLToPath(import.meta.url));
var HOME = process.env.CLOUDFACT_HOME ?? path.join(os.homedir(), ".cloudfact");
var DEPLOYS_DIR = path.join(HOME, "deploys");
var BIN_DIR = path.join(HOME, "bin");
var CONFIG_FILE = path.join(HOME, "config.json");
var WRANGLER_CONFIG = path.join(
  process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"),
  ".wrangler",
  "config",
  "default.toml"
);
var HOST_SCRIPT = process.env.CLOUDFACT_HOST_SCRIPT ?? path.join(here, "host.js");
function readVersion() {
  for (const candidate of [path.join(here, "..", "package.json"), path.join(here, "..", "..", "package.json")]) {
    try {
      return JSON.parse(fs.readFileSync(candidate, "utf8")).version;
    } catch {
    }
  }
  return "0.0.0";
}
var VERSION = readVersion();
function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

// src/logger.ts
var log = {
  info(message) {
    if (!process.env.CLOUDFACT_QUIET) process.stderr.write(`${message}
`);
  },
  ts(...parts) {
    process.stderr.write(`${(/* @__PURE__ */ new Date()).toISOString()} ${parts.map(String).join(" ")}
`);
  }
};

// src/services/cloudflared.ts
import fs2 from "fs";
import os2 from "os";
import path2 from "path";
import { spawnSync } from "child_process";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { createGunzip } from "zlib";
function findCloudflared(cfg = readConfig()) {
  const candidates = [
    cfg.cloudflaredPath,
    process.env.CLOUDFLARED,
    path2.join(BIN_DIR, "cloudflared"),
    "cloudflared",
    path2.join(os2.homedir(), ".local/bin/cloudflared"),
    "/usr/local/bin/cloudflared",
    "/usr/bin/cloudflared"
  ].filter((c) => Boolean(c));
  for (const c of candidates) {
    if (c.includes("/")) {
      if (fs2.existsSync(c)) return c;
      continue;
    }
    const r = spawnSync("sh", ["-c", `command -v ${c}`], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return null;
}

// src/services/state.ts
import fs3 from "fs";
import path3 from "path";
function deployDir(name2) {
  return path3.join(DEPLOYS_DIR, name2);
}
function readState(name2) {
  try {
    return JSON.parse(fs3.readFileSync(path3.join(deployDir(name2), "state.json"), "utf8"));
  } catch {
    return null;
  }
}
function writeState(name2, state) {
  const dir2 = deployDir(name2);
  fs3.mkdirSync(dir2, { recursive: true, mode: 448 });
  const tmp = path3.join(dir2, `.state.${process.pid}.tmp`);
  fs3.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", { mode: 384 });
  fs3.renameSync(tmp, path3.join(dir2, "state.json"));
}
function patchState(name2, patch) {
  const current = readState(name2);
  if (!current) throw new Error(`deploy "${name2}" does not exist`);
  const next = { ...current, ...patch };
  writeState(name2, next);
  return next;
}

// src/backends/workers/index.ts
import fs5 from "fs";
import path4 from "path";

// src/services/wrangler.ts
import fs4 from "fs";
import { spawnSync as spawnSync2 } from "child_process";
var stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
function credentials(cfg = readConfig()) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? cfg.cloudflareAccountId ?? null;
  const token = process.env.CLOUDFLARE_API_TOKEN ?? cfg.cloudflareApiToken;
  if (token) return { source: "token", token, accountId };
  try {
    if (/oauth_token\s*=\s*"[^"]+"/.test(fs4.readFileSync(WRANGLER_CONFIG, "utf8"))) {
      return { source: "wrangler", token: null, accountId };
    }
  } catch {
  }
  return null;
}
function wranglerCommand(cfg = readConfig()) {
  return cfg.wranglerCommand ? cfg.wranglerCommand.split(" ") : ["npx", "--yes", "wrangler@4"];
}
function wranglerEnv(creds) {
  const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
  if (creds?.token) env.CLOUDFLARE_API_TOKEN = creds.token;
  if (creds?.accountId) env.CLOUDFLARE_ACCOUNT_ID = creds.accountId;
  return env;
}
function runWrangler(args, opts = {}) {
  const cfg = opts.cfg ?? readConfig();
  const [cmd, ...base] = wranglerCommand(cfg);
  const r = spawnSync2(cmd, [...base, ...args], {
    encoding: "utf8",
    env: wranglerEnv(opts.creds ?? credentials(cfg)),
    cwd: opts.cwd,
    input: opts.input,
    maxBuffer: 16 * 1024 * 1024
  });
  const text = stripAnsi((r.stdout ?? "") + (r.stderr ?? ""));
  if (opts.logFile) fs4.appendFileSync(opts.logFile, `
$ wrangler ${args.join(" ")}
${text}`);
  return { status: r.status, text };
}

// src/backends/tunnel/gate.ts
import crypto from "crypto";
var COOKIE_NAME = "cloudfact_access";
var RATE_LIMIT = { attempts: 10, windowMs: 6e4 };
var GATE_HTML = `<!doctype html><html lang="en"><meta charset="utf-8"><title>cloudfact</title>
<style>body{font:16px system-ui;margin:3rem;color:#333}</style><body><p id="m">Signing in\u2026</p>
<script>(async()=>{const el=document.getElementById('m');const m=location.hash.match(/key=([^&]+)/);
if(!m){el.textContent='Private page: open it through the full link (with #key=\u2026).';return}
const r=await fetch('/api/session',{method:'POST',headers:{Authorization:'Bearer '+decodeURIComponent(m[1])}});
if(r.ok){history.replaceState(null,'',location.pathname+location.search);location.reload();return}
let msg='Invalid key.';try{const j=await r.json();if(j.error==='expired')msg='This link has expired. Ask for a new one.';if(r.status===429)msg='Too many attempts. Try again in a minute.'}catch{}
el.textContent=msg})()</script></body></html>`;
function timingEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function clientIp(req) {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf) return cf;
  return req.socket.remoteAddress ?? "unknown";
}
function cookieValue(req, cookieName) {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === cookieName) return v.join("=");
  }
  return null;
}
function reply(res, code, body, headers) {
  const buf = Buffer.from(body);
  res.writeHead(code, { "Content-Length": buf.length, "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", ...headers });
  res.end(buf);
}
function createGate(opts) {
  const cookieName = opts.cookieName ?? COOKIE_NAME;
  const log2 = opts.log ?? (() => {
  });
  const now = opts.now ?? Date.now;
  const failures = /* @__PURE__ */ new Map();
  const current = () => {
    const info = opts.getKey();
    const expired = Boolean(info.expiresAt && Date.parse(info.expiresAt) <= now());
    return { key: info.key, expired };
  };
  const limited = (ip) => {
    const entry = failures.get(ip);
    if (!entry) return false;
    if (now() - entry.windowStart > RATE_LIMIT.windowMs) {
      failures.delete(ip);
      return false;
    }
    return entry.count >= RATE_LIMIT.attempts;
  };
  const recordFailure = (ip) => {
    const entry = failures.get(ip);
    if (!entry || now() - entry.windowStart > RATE_LIMIT.windowMs) failures.set(ip, { count: 1, windowStart: now() });
    else entry.count += 1;
    if (failures.size > 1e4) failures.clear();
  };
  const authorized = (req) => {
    const { key, expired } = current();
    if (!key) return true;
    if (expired) return false;
    const value = cookieValue(req, cookieName);
    return value !== null && timingEqual(value, key);
  };
  const handle = (req, res) => {
    const { key, expired } = current();
    if (!key) return false;
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/api/session" && req.method === "POST") {
      const ip = clientIp(req);
      if (limited(ip)) {
        log2(`gate: rate limit hit from ${ip}`);
        reply(res, 429, '{"error":"rate_limited"}', {
          "Content-Type": "application/json",
          "Retry-After": String(RATE_LIMIT.windowMs / 1e3)
        });
        return true;
      }
      const auth = req.headers.authorization ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (expired) {
        recordFailure(ip);
        log2(`gate: expired key presented from ${ip}`);
        reply(res, 401, '{"error":"expired"}', { "Content-Type": "application/json" });
      } else if (timingEqual(token, key)) {
        failures.delete(ip);
        log2(`gate: session opened for ${ip}`);
        reply(res, 204, "", { "Set-Cookie": `${cookieName}=${key}; Path=/; HttpOnly; Secure; SameSite=Lax` });
      } else {
        recordFailure(ip);
        log2(`gate: invalid key from ${ip}`);
        reply(res, 401, '{"error":"invalid"}', { "Content-Type": "application/json" });
      }
      return true;
    }
    if (authorized(req)) return false;
    reply(res, 200, GATE_HTML, { "Content-Type": "text/html; charset=utf-8" });
    return true;
  };
  return { handle, authorized, enabled: () => Boolean(current().key) };
}
function staticGate(key, cookieName) {
  return createGate({ getKey: () => ({ key: key ?? null }), cookieName });
}

// src/backends/workers/access-js.ts
var ACCESS_JS = `const enc = new TextEncoder();
const reply = (status, body, headers) =>
  new Response(body, { status, headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', ...headers } });

// --- Cloudflare Access JWT verification (RS256 against the team's JWKS, cached in the isolate) ---
let certsCache = { team: null, keys: null, at: 0 };
async function accessKeys(team, force) {
  if (!force && certsCache.team === team && certsCache.keys && Date.now() - certsCache.at < 600000) return certsCache.keys;
  const res = await fetch('https://' + team + '/cdn-cgi/access/certs');
  if (!res.ok) throw new Error('access certs: HTTP ' + res.status);
  const data = await res.json();
  const keys = [];
  for (const jwk of data.keys || []) {
    if (jwk.kty !== 'RSA') continue;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    keys.push({ kid: jwk.kid, key });
  }
  certsCache = { team, keys, at: Date.now() };
  return keys;
}
function b64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4;
  if (pad) s += '='.repeat(4 - pad);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function accessToken(request) {
  const header = request.headers.get('cf-access-jwt-assertion');
  if (header) return header;
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === 'CF_Authorization') return v.join('=');
  }
  return null;
}
async function verifyAccess(request, team, aud) {
  const token = accessToken(request);
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  let header, payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64url(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64url(parts[1])));
  } catch {
    return false;
  }
  if (!header || header.alg !== 'RS256' || !payload) return false;
  let keys = await accessKeys(team, false);
  let entry = keys.find((k) => k.kid === header.kid);
  if (!entry) {
    keys = await accessKeys(team, true); // key rotation: refresh once
    entry = keys.find((k) => k.kid === header.kid);
  }
  if (!entry) return false;
  const ok = await crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, entry.key, b64url(parts[2]), enc.encode(parts[0] + '.' + parts[1]));
  if (!ok) return false;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) return false;
  if (typeof payload.nbf === 'number' && payload.nbf > now + 60) return false;
  if (payload.iss !== 'https://' + team) return false;
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  return auds.includes(aud);
}
`;

// src/backends/workers/gate-worker.ts
var WORKER_SOURCE = `// generated by cloudfact \u2014 gate worker
const COOKIE = 'cloudfact_access';
const GATE_HTML = ${JSON.stringify(GATE_HTML)};
${ACCESS_JS}
function timingEqual(a, b) {
  const x = enc.encode(a), y = enc.encode(b);
  if (x.byteLength !== y.byteLength) return false;
  return crypto.subtle.timingSafeEqual(x, y);
}
function cookieValue(request) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    if (env.CLOUDFACT_ACCESS === '1') {
      if (!env.CLOUDFACT_ACCESS_AUD || !env.CLOUDFACT_ACCESS_TEAM) return reply(503, 'cloudfact: Cloudflare Access not configured for this site yet', { 'content-type': 'text/plain' });
      let ok = false;
      try {
        ok = await verifyAccess(request, env.CLOUDFACT_ACCESS_TEAM, env.CLOUDFACT_ACCESS_AUD);
      } catch {
        ok = false;
      }
      if (!ok) return reply(403, 'cloudfact: this site is protected by Cloudflare Access and the request carried no valid Access token for it. Sign in at https://' + new URL(request.url).host + '/ (if you just signed in, the Access application may still be propagating; retry in a minute).', { 'content-type': 'text/plain' });
      const res = await env.ASSETS.fetch(request);
      const out = new Response(res.body, res);
      out.headers.set('cache-control', 'private, no-cache');
      out.headers.set('x-robots-tag', 'noindex, nofollow');
      return out;
    }
    const key = env.CLOUDFACT_KEY;
    if (!key) return reply(503, 'cloudfact: key not configured', { 'content-type': 'text/plain' });
    const expired = env.CLOUDFACT_KEY_EXPIRES ? Date.parse(env.CLOUDFACT_KEY_EXPIRES) <= Date.now() : false;
    const url = new URL(request.url);
    if (url.pathname === '/api/session' && request.method === 'POST') {
      const ip = request.headers.get('cf-connecting-ip') || 'unknown';
      if (env.SESSION_LIMIT) {
        try {
          const { success } = await env.SESSION_LIMIT.limit({ key: ip });
          if (!success) return reply(429, '{"error":"rate_limited"}', { 'content-type': 'application/json', 'retry-after': '60' });
        } catch {}
      }
      const auth = request.headers.get('authorization') || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (expired) return reply(401, '{"error":"expired"}', { 'content-type': 'application/json' });
      if (!timingEqual(token, key)) return reply(401, '{"error":"invalid"}', { 'content-type': 'application/json' });
      return reply(204, null, { 'set-cookie': COOKIE + '=' + key + '; Path=/; HttpOnly; Secure; SameSite=Lax' });
    }
    const value = cookieValue(request);
    const ok = !expired && value !== null && timingEqual(value, key);
    if (!ok) return reply(200, GATE_HTML, { 'content-type': 'text/html; charset=utf-8' });
    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    out.headers.set('cache-control', 'private, no-cache');
    out.headers.set('x-robots-tag', 'noindex, nofollow');
    return out;
  },
};
`;

// src/backends/workers/proxy-worker.ts
var PROXY_WORKER_SOURCE = `// generated by cloudfact \u2014 access proxy worker
${ACCESS_JS}
const ORIGIN_COOKIE = 'cloudfact_access';
const HOP_BY_HOP = ['connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'proxy-authorization', 'proxy-authenticate'];

export default {
  async fetch(request, env) {
    if (env.CLOUDFACT_ACCESS !== '1' || !env.CLOUDFACT_ACCESS_AUD || !env.CLOUDFACT_ACCESS_TEAM) {
      return reply(503, 'cloudfact: Cloudflare Access is not configured for this app yet', { 'content-type': 'text/plain' });
    }
    let ok = false;
    try {
      ok = await verifyAccess(request, env.CLOUDFACT_ACCESS_TEAM, env.CLOUDFACT_ACCESS_AUD);
    } catch {
      ok = false;
    }
    if (!ok) {
      return reply(
        403,
        'cloudfact: this app is protected by Cloudflare Access and the request carried no valid Access token for it. Sign in at https://' +
          new URL(request.url).host +
          '/ (if you just signed in, the Access application may still be propagating; retry in a minute).',
        { 'content-type': 'text/plain' },
      );
    }
    if (!env.CLOUDFACT_ORIGIN) {
      return reply(503, 'cloudfact: the machine serving this app has no tunnel right now; it should reconnect on its own', {
        'content-type': 'text/plain',
      });
    }
    const url = new URL(request.url);
    const target = new URL(url.pathname + url.search, env.CLOUDFACT_ORIGIN);
    const headers = new Headers(request.headers);
    for (const h of HOP_BY_HOP) headers.delete(h);
    headers.delete('cf-access-jwt-assertion');
    headers.delete('cookie');
    if (env.CLOUDFACT_ORIGIN_KEY) headers.set('cookie', ORIGIN_COOKIE + '=' + env.CLOUDFACT_ORIGIN_KEY);
    headers.set('x-forwarded-host', url.host);
    headers.set('x-forwarded-proto', 'https');
    const init = { method: request.method, headers, redirect: 'manual' };
    if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body;
    let res;
    try {
      res = await fetch(target.toString(), init);
    } catch (e) {
      return reply(502, 'cloudfact: the machine serving this app did not answer (' + e + ')', { 'content-type': 'text/plain' });
    }
    if (res.webSocket) return new Response(null, { status: 101, webSocket: res.webSocket });
    const out = new Response(res.body, res);
    out.headers.set('cache-control', 'private, no-cache');
    out.headers.set('x-robots-tag', 'noindex, nofollow');
    return out;
  },
};
`;

// src/services/access.ts
function accessVars(app) {
  return ["--var", "CLOUDFACT_ACCESS:1", "--var", `CLOUDFACT_ACCESS_AUD:${app.aud}`, "--var", `CLOUDFACT_ACCESS_TEAM:${app.teamDomain}`];
}

// src/backends/workers/index.ts
function refreshAccessProxyOrigin(name2, origin) {
  const dir2 = deployDir(name2);
  const config = path4.join(dir2, "worker", "wrangler.jsonc");
  const s = readState(name2);
  if (!fs5.existsSync(config) || !s?.access) return;
  const r = runWrangler(["deploy", "--config", config, ...accessVars(s.access), "--var", `CLOUDFACT_ORIGIN:${origin}`], {
    cwd: path4.join(dir2, "worker"),
    logFile: path4.join(dir2, "wrangler.log")
  });
  if (r.status !== 0) throw new Error(`wrangler deploy failed:
${r.text.slice(-800)}`);
}

// src/backends/tunnel/proxy.ts
import http from "http";
import net from "net";
var HOP_BY_HOP = /* @__PURE__ */ new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);
function createProxy(opts) {
  const host = opts.targetHost ?? "127.0.0.1";
  const port = opts.targetPort;
  const gate2 = opts.gate ?? staticGate(opts.key);
  const handler = (req, res) => {
    if (gate2.handle(req, res)) return;
    const headers = {};
    for (const [k, v] of Object.entries(req.headers))
      if (!HOP_BY_HOP.has(k) && !k.startsWith("x-forwarded-") && k !== "x-real-ip") headers[k] = v;
    const ip = clientIp(req);
    headers["x-forwarded-proto"] = "https";
    headers["x-forwarded-host"] = req.headers.host;
    headers["x-forwarded-for"] = ip;
    headers["x-real-ip"] = ip;
    const upstream = http.request({ host, port, method: req.method, path: req.url, headers }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      res.end(`cloudfact: upstream ${host}:${port} is not reachable`);
    });
    req.pipe(upstream);
  };
  const upgrade = (req, socket, head) => {
    if (!gate2.authorized(req)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    const target = net.connect(port, host, () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      target.write(lines.join("\r\n") + "\r\n\r\n");
      if (head.length) target.write(head);
      socket.pipe(target).pipe(socket);
    });
    const drop = () => {
      socket.destroy();
      target.destroy();
    };
    target.on("error", drop);
    socket.on("error", drop);
  };
  return { handler, upgrade };
}

// src/backends/tunnel/static-server.ts
import fs6 from "fs";
import path5 from "path";
var MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".vtt": "text/vtt; charset=utf-8",
  ".zip": "application/zip"
};
var BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-cache"
};
function send(res, code, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(code, { ...BASE_HEADERS, "Content-Length": buf.length, ...headers });
  res.end(buf);
}
var escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function listing(urlPath, absDir) {
  const entries = fs6.readdirSync(absDir, { withFileTypes: true }).filter((e) => !e.name.startsWith(".")).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  const rows = entries.map((e) => {
    const suffix = e.isDirectory() ? "/" : "";
    return `<li><a href="${escapeHtml(encodeURIComponent(e.name))}${suffix}">${escapeHtml(e.name + suffix)}</a></li>`;
  }).join("");
  const up = urlPath !== "/" ? '<li><a href="../">../</a></li>' : "";
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escapeHtml(urlPath)}</title>
<style>body{font:15px system-ui;margin:2rem;color:#222}li{margin:.25rem 0}</style>
<body><h1>${escapeHtml(urlPath)}</h1><ul>${up}${rows}</ul></body></html>`;
}
function safeResolve(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const parts = decoded.split("/").filter(Boolean);
  if (parts.some((p) => p === ".." || p.startsWith("."))) return null;
  const abs = path5.resolve(root, ...parts);
  if (abs !== root && !abs.startsWith(root + path5.sep)) return null;
  return abs;
}
function createStaticHandler(opts) {
  const root = opts.root ? path5.resolve(opts.root) : null;
  const file = opts.file ? path5.resolve(opts.file) : null;
  const gate2 = opts.gate ?? staticGate(opts.key, opts.cookieName);
  return (req, res) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://localhost");
    if (gate2.handle(req, res)) return;
    if (method !== "GET" && method !== "HEAD") return send(res, 405, "method not allowed");
    let abs;
    if (opts.mode === "file") {
      const allowed = /* @__PURE__ */ new Set(["/", "/index.html", `/${path5.basename(file ?? "")}`]);
      if (!allowed.has(url.pathname)) return send(res, 404, "not found");
      abs = file;
    } else {
      abs = root ? safeResolve(root, url.pathname) : null;
    }
    if (!abs) return send(res, 404, "not found");
    let stat;
    try {
      stat = fs6.statSync(abs);
    } catch {
      return send(res, 404, "not found");
    }
    if (stat.isDirectory()) {
      if (!url.pathname.endsWith("/")) return send(res, 301, "", { Location: `${url.pathname}/${url.search}` });
      const index = path5.join(abs, "index.html");
      if (fs6.existsSync(index)) {
        abs = index;
        stat = fs6.statSync(index);
      } else {
        return send(res, 200, listing(url.pathname, abs), { "Content-Type": "text/html; charset=utf-8" });
      }
    }
    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, { ...BASE_HEADERS, ETag: etag });
      return res.end();
    }
    res.writeHead(200, {
      ...BASE_HEADERS,
      "Content-Type": MIME[path5.extname(abs).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": stat.size,
      ETag: etag,
      "Last-Modified": stat.mtime.toUTCString()
    });
    if (method === "HEAD") return res.end();
    fs6.createReadStream(abs).on("error", () => res.destroy()).pipe(res);
  };
}

// src/backends/tunnel/host.ts
var TUNNEL_URL = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/;
var name = process.argv[2];
if (!name) {
  log.ts("usage: host.js <name>");
  process.exit(2);
}
var loaded = readState(name);
if (!loaded) {
  log.ts("no state.json for", name);
  process.exit(2);
}
var initial = loaded;
var dir = deployDir(name);
var stopping = false;
var tunnel = null;
var ssh = null;
var restarts = 0;
var sshRestarts = 0;
var keyCache = { at: 0, key: null, expiresAt: null };
var gate = createGate({
  getKey: () => {
    if (Date.now() - keyCache.at > 1e3) {
      const s = readState(name);
      keyCache = { at: Date.now(), key: s?.key ?? null, expiresAt: s?.keyExpiresAt ?? null };
    }
    return keyCache;
  },
  log: (m) => log.ts(m)
});
async function main() {
  let server;
  if (initial.mode === "proxy") {
    let targetPort = initial.targetPort;
    if (initial.ssh) {
      targetPort = await freePort();
      patchState(name, { forwardPort: targetPort });
      startSshForward(targetPort);
    }
    const proxy = createProxy({ targetPort, gate });
    server = http2.createServer(proxy.handler);
    server.on("upgrade", proxy.upgrade);
  } else {
    server = http2.createServer(createStaticHandler({ mode: initial.mode, root: initial.root, file: initial.file, gate }));
  }
  server.keepAliveTimeout = 65e3;
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    patchState(name, { hostPid: process.pid, port, status: "starting", local: `http://127.0.0.1:${port}` });
    log.ts("local server on port", port);
    startTunnel(port);
  });
  process.on("SIGTERM", () => shutdown(server));
  process.on("SIGINT", () => shutdown(server));
}
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = http2.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
    probe.on("error", reject);
  });
}
function startSshForward(localPort) {
  if (stopping || !initial.ssh) return;
  const { destination, port, identity, strictHostKey } = initial.ssh;
  const args = [
    "-N",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
    "-o",
    "BatchMode=yes",
    "-o",
    `StrictHostKeyChecking=${strictHostKey ? "yes" : "accept-new"}`,
    "-L",
    `127.0.0.1:${localPort}:127.0.0.1:${initial.targetPort}`
  ];
  if (port) args.push("-p", String(port));
  if (identity) args.push("-i", identity);
  args.push(destination);
  const logFd = fs7.openSync(path6.join(dir, "ssh.log"), "a");
  ssh = spawn("ssh", args, { stdio: ["ignore", logFd, logFd], windowsHide: true });
  fs7.closeSync(logFd);
  patchState(name, { sshPid: ssh.pid ?? null });
  log.ts(`ssh forward 127.0.0.1:${localPort} \u2192 ${destination}:${initial.targetPort}`);
  ssh.on("exit", (code, signal) => {
    ssh = null;
    if (stopping) return;
    sshRestarts += 1;
    const delay = Math.min(3e4, 2e3 * sshRestarts);
    log.ts(`ssh exited (code=${code} sig=${signal}); reconnecting in ${delay / 1e3}s`);
    patchState(name, { sshPid: null, error: `ssh forward down (exit ${code}); reconnecting` });
    setTimeout(() => startSshForward(localPort), delay);
  });
}
function startTunnel(port) {
  if (stopping) return;
  const bin = findCloudflared(readConfig());
  if (!bin) {
    patchState(name, { status: "error", error: "cloudflared not found" });
    return;
  }
  const logFd = fs7.openSync(path6.join(dir, "tunnel.log"), "a");
  tunnel = spawn(bin, ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate", "--protocol", "http2"], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  const proxiedDeploy = Boolean(readState(name)?.access);
  patchState(name, {
    tunnelPid: tunnel.pid ?? null,
    ...proxiedDeploy ? { tunnelUrl: null } : { url: null, privateUrl: null },
    status: "starting"
  });
  let found = false;
  const scan = (chunk) => {
    fs7.writeSync(logFd, chunk);
    if (found) return;
    const match = chunk.toString().match(TUNNEL_URL);
    if (!match) return;
    found = true;
    const url = match[0];
    const st = readState(name);
    const proxied = Boolean(st?.access);
    patchState(name, {
      tunnelUrl: url,
      url: proxied ? st?.url ?? null : url,
      privateUrl: proxied ? null : st?.key ? `${url}/#key=${st.key}` : null,
      status: "running",
      error: null,
      urlAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    log.ts("tunnel ready:", url);
    if (proxied) {
      try {
        refreshAccessProxyOrigin(name, url);
        log.ts("access proxy origin updated to", url);
      } catch (e) {
        log.ts("could not update the access proxy origin:", String(e));
        patchState(name, { error: `access proxy origin not updated: ${String(e)}` });
      }
    }
  };
  tunnel.stdout?.on("data", scan);
  tunnel.stderr?.on("data", scan);
  tunnel.on("exit", (code, signal) => {
    fs7.closeSync(logFd);
    tunnel = null;
    if (stopping) return;
    restarts += 1;
    const delay = Math.min(3e4, 2e3 * restarts);
    log.ts(`cloudflared exited (code=${code} sig=${signal}); restarting in ${delay / 1e3}s`);
    patchState(name, {
      status: "reconnecting",
      ...proxiedDeploy ? { tunnelUrl: null } : { url: null, privateUrl: null },
      tunnelPid: null,
      restarts
    });
    setTimeout(() => startTunnel(port), delay);
  });
}
function shutdown(server) {
  if (stopping) return;
  stopping = true;
  log.ts("shutting down");
  patchState(name, {
    status: "stopped",
    url: null,
    privateUrl: null,
    hostPid: null,
    tunnelPid: null,
    sshPid: null,
    stoppedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  tunnel?.kill("SIGTERM");
  ssh?.kill("SIGTERM");
  server.close();
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on("uncaughtException", (err) => {
  log.ts("error", err);
  patchState(name, { status: "error", error: String(err) });
});
void main();
