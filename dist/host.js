import { createRequire as __cloudfactRequire } from 'node:module'; const require = __cloudfactRequire(import.meta.url);

// src/backends/tunnel/host.ts
import fs5 from "fs";
import http2 from "http";
import path5 from "path";
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
var BRAND_DIR = process.env.CLOUDFACT_BRAND_DIR ?? path.join(here, "brand");
var SERVER_SCRIPT = process.env.CLOUDFACT_SERVER_SCRIPT ?? path.join(here, "server.js");
var SKILL_DIR = process.env.CLOUDFACT_SKILL_DIR ?? [path.join(here, "..", "skills", "cloudfact"), path.join(here, "skills", "cloudfact")].find((p) => fs.existsSync(p)) ?? path.join(here, "..", "skills", "cloudfact");
var BIN_SCRIPT = process.env.CLOUDFACT_BIN_SCRIPT ?? path.join(here, "bin.js");
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

// src/backends/tunnel/gate.ts
import crypto from "crypto";
var COOKIE_NAME = "cloudfact_access";
var RATE_LIMIT = { attempts: 10, windowMs: 6e4 };
var FAVICON = "data:image/png;base64,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";
var MARK = "data:image/png;base64,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";
var GATE_HTML = `<!doctype html><html lang="en"><meta charset="utf-8"><title>CloudFacts</title>
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<link rel="icon" href="${FAVICON}" sizes="any">
<style>:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d0d0d;
color:#f4f4f1;font:16px/1.55 'CloudFacts Sans',ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.box{max-width:26rem;padding:2rem;text-align:center}img{width:44px;height:44px}
h1{font-size:19px;font-weight:500;margin:.9rem 0 .35rem;letter-spacing:-.005em}
p{margin:0;color:#8e8e89;font-size:14.5px}</style>
<body><div class="box"><img src="${MARK}" alt=""><h1>CloudFacts</h1><p id="m">Signing in\u2026</p></div>
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
import fs4 from "fs";
import path4 from "path";
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
  const entries = fs4.readdirSync(absDir, { withFileTypes: true }).filter((e) => !e.name.startsWith(".")).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
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
  const abs = path4.resolve(root, ...parts);
  if (abs !== root && !abs.startsWith(root + path4.sep)) return null;
  return abs;
}
function createStaticHandler(opts) {
  const root = opts.root ? path4.resolve(opts.root) : null;
  const file = opts.file ? path4.resolve(opts.file) : null;
  const gate2 = opts.gate ?? staticGate(opts.key, opts.cookieName);
  return (req, res) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://localhost");
    if (gate2.handle(req, res)) return;
    if (method !== "GET" && method !== "HEAD") return send(res, 405, "method not allowed");
    let abs;
    if (opts.mode === "file") {
      const allowed = /* @__PURE__ */ new Set(["/", "/index.html", `/${path4.basename(file ?? "")}`]);
      if (!allowed.has(url.pathname)) return send(res, 404, "not found");
      abs = file;
    } else {
      abs = root ? safeResolve(root, url.pathname) : null;
    }
    if (!abs) return send(res, 404, "not found");
    let stat;
    try {
      stat = fs4.statSync(abs);
    } catch {
      return send(res, 404, "not found");
    }
    if (stat.isDirectory()) {
      if (!url.pathname.endsWith("/")) return send(res, 301, "", { Location: `${url.pathname}/${url.search}` });
      const index = path4.join(abs, "index.html");
      if (fs4.existsSync(index)) {
        abs = index;
        stat = fs4.statSync(index);
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
      "Content-Type": MIME[path4.extname(abs).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": stat.size,
      ETag: etag,
      "Last-Modified": stat.mtime.toUTCString()
    });
    if (method === "HEAD") return res.end();
    fs4.createReadStream(abs).on("error", () => res.destroy()).pipe(res);
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
  const logFd = fs5.openSync(path5.join(dir, "ssh.log"), "a");
  ssh = spawn("ssh", args, { stdio: ["ignore", logFd, logFd], windowsHide: true });
  fs5.closeSync(logFd);
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
  const logFd = fs5.openSync(path5.join(dir, "tunnel.log"), "a");
  tunnel = spawn(bin, ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate", "--protocol", "http2"], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  patchState(name, { tunnelPid: tunnel.pid ?? null, url: null, privateUrl: null, status: "starting" });
  let found = false;
  const scan = (chunk) => {
    fs5.writeSync(logFd, chunk);
    if (found) return;
    const match = chunk.toString().match(TUNNEL_URL);
    if (!match) return;
    found = true;
    const url = match[0];
    const key = readState(name)?.key;
    patchState(name, {
      url,
      privateUrl: key ? `${url}/#key=${key}` : null,
      status: "running",
      error: null,
      urlAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    log.ts("tunnel ready:", url);
  };
  tunnel.stdout?.on("data", scan);
  tunnel.stderr?.on("data", scan);
  tunnel.on("exit", (code, signal) => {
    fs5.closeSync(logFd);
    tunnel = null;
    if (stopping) return;
    restarts += 1;
    const delay = Math.min(3e4, 2e3 * restarts);
    log.ts(`cloudflared exited (code=${code} sig=${signal}); restarting in ${delay / 1e3}s`);
    patchState(name, { status: "reconnecting", url: null, privateUrl: null, tunnelPid: null, restarts });
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
