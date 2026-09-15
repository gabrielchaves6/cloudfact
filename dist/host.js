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

// src/backends/tunnel/proxy.ts
import http from "http";
import net from "net";

// src/backends/tunnel/gate.ts
import crypto from "crypto";
var COOKIE_NAME = "cloudfact_access";
var GATE_HTML = `<!doctype html><html lang="en"><meta charset="utf-8"><title>cloudfact</title>
<style>body{font:16px system-ui;margin:3rem;color:#333}</style><body><p id="m">Signing in\u2026</p>
<script>(async()=>{const el=document.getElementById('m');const m=location.hash.match(/key=([^&]+)/);
if(!m){el.textContent='Private page: open it through the full link (with #key=\u2026).';return}
const r=await fetch('/api/session',{method:'POST',headers:{Authorization:'Bearer '+decodeURIComponent(m[1])}});
if(r.ok){history.replaceState(null,'',location.pathname+location.search);location.reload()}
else el.textContent='Invalid key.'})()</script></body></html>`;
function timingEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function hasAccessCookie(req, key, cookieName = COOKIE_NAME) {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === cookieName) return timingEqual(v.join("="), key);
  }
  return false;
}
function reply(res, code, body, headers) {
  const buf = Buffer.from(body);
  res.writeHead(code, { "Content-Length": buf.length, "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", ...headers });
  res.end(buf);
}
function gateRequest(req, res, key, cookieName = COOKIE_NAME) {
  if (!key) return false;
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/api/session" && req.method === "POST") {
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (timingEqual(token, key)) {
      reply(res, 204, "", { "Set-Cookie": `${cookieName}=${key}; Path=/; HttpOnly; Secure; SameSite=Lax` });
    } else {
      reply(res, 401, '{"error":"invalid key"}', { "Content-Type": "application/json" });
    }
    return true;
  }
  if (hasAccessCookie(req, key, cookieName)) return false;
  reply(res, 200, GATE_HTML, { "Content-Type": "text/html; charset=utf-8" });
  return true;
}

// src/backends/tunnel/proxy.ts
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
  const handler = (req, res) => {
    if (gateRequest(req, res, opts.key)) return;
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP_BY_HOP.has(k)) headers[k] = v;
    headers["x-forwarded-proto"] = "https";
    headers["x-forwarded-host"] = req.headers.host;
    headers["x-forwarded-for"] = req.socket.remoteAddress ?? "";
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
    if (opts.key && !hasAccessCookie(req, opts.key)) {
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
  const cookieName = opts.cookieName ?? COOKIE_NAME;
  return (req, res) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://localhost");
    if (gateRequest(req, res, opts.key, cookieName)) return;
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
async function main() {
  let server;
  if (initial.mode === "proxy") {
    let targetPort = initial.targetPort;
    if (initial.ssh) {
      targetPort = await freePort();
      patchState(name, { forwardPort: targetPort });
      startSshForward(targetPort);
    }
    const proxy = createProxy({ targetPort, key: initial.key });
    server = http2.createServer(proxy.handler);
    server.on("upgrade", proxy.upgrade);
  } else {
    server = http2.createServer(createStaticHandler({ mode: initial.mode, root: initial.root, file: initial.file, key: initial.key }));
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
  const { destination, port, identity } = initial.ssh;
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
    "StrictHostKeyChecking=accept-new",
    "-L",
    `127.0.0.1:${localPort}:127.0.0.1:${initial.targetPort}`
  ];
  if (port) args.push("-p", String(port));
  if (identity) args.push("-i", identity);
  args.push(destination);
  const logFd = fs5.openSync(path5.join(dir, "ssh.log"), "a");
  ssh = spawn("ssh", args, { stdio: ["ignore", logFd, logFd] });
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
    stdio: ["ignore", "pipe", "pipe"]
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
