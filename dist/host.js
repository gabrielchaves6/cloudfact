import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};

// src/lib.js
import fs2 from "node:fs";
import path2 from "node:path";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
function readConfig() {
  try {
    return JSON.parse(fs2.readFileSync(CONFIG, "utf8"));
  } catch {
    return {};
  }
}
function findCloudflared(cfg = readConfig()) {
  const candidates = [
    cfg.cloudflaredPath,
    process.env.CLOUDFLARED,
    path2.join(HOME, "bin", "cloudflared"),
    "cloudflared",
    path2.join(os.homedir(), ".local/bin/cloudflared"),
    "/usr/local/bin/cloudflared",
    "/usr/bin/cloudflared"
  ].filter(Boolean);
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
function deployDir(name2) {
  return path2.join(DEPLOYS, name2);
}
function readState(name2) {
  try {
    return JSON.parse(fs2.readFileSync(path2.join(deployDir(name2), "state.json"), "utf8"));
  } catch {
    return null;
  }
}
function writeState(name2, state2) {
  const d = deployDir(name2);
  fs2.mkdirSync(d, { recursive: true, mode: 448 });
  const tmp = path2.join(d, `.state.${process.pid}.tmp`);
  fs2.writeFileSync(tmp, JSON.stringify(state2, null, 2) + "\n", { mode: 384 });
  fs2.renameSync(tmp, path2.join(d, "state.json"));
}
var __dirname, HOME, DEPLOYS, CONFIG, HOST_SCRIPT, VERSION, WRANGLER_CONFIG;
var init_lib = __esm({
  "src/lib.js"() {
    __dirname = path2.dirname(fileURLToPath(import.meta.url));
    HOME = process.env.CLOUDFACT_HOME || path2.join(os.homedir(), ".cloudfact");
    DEPLOYS = path2.join(HOME, "deploys");
    CONFIG = path2.join(HOME, "config.json");
    HOST_SCRIPT = path2.join(__dirname, "host.js");
    VERSION = JSON.parse(fs2.readFileSync(path2.join(__dirname, "..", "package.json"), "utf8")).version;
    WRANGLER_CONFIG = path2.join(process.env.XDG_CONFIG_HOME || path2.join(os.homedir(), ".config"), ".wrangler", "config", "default.toml");
  }
});

// src/host.js
import http from "node:http";
import fs3 from "node:fs";
import path3 from "node:path";
import { spawn as spawn2 } from "node:child_process";

// src/static.js
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
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
  ".ico": "image/x-icon",
  ".avif": "image/avif",
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
var GATE = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>cloudfact</title>
<style>body{font:16px system-ui;margin:3rem;color:#333}</style><body><p id="m">Autenticando\u2026</p>
<script>(async()=>{const el=document.getElementById('m');const m=location.hash.match(/key=([^&]+)/);
if(!m){el.textContent='P\xE1gina privada: abra pelo link completo (com #key=\u2026).';return}
const r=await fetch('/api/session',{method:'POST',headers:{Authorization:'Bearer '+decodeURIComponent(m[1])}});
if(r.ok){history.replaceState(null,'',location.pathname+location.search);location.reload()}
else el.textContent='Chave inv\xE1lida.'})()</script></body></html>`;
function send(res, code, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body ?? "");
  res.writeHead(code, { ...BASE_HEADERS, "Content-Length": buf.length, ...headers });
  res.end(buf);
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function listing(urlPath, absDir) {
  const entries = fs.readdirSync(absDir, { withFileTypes: true }).filter((e) => !e.name.startsWith(".")).sort((a, b) => b.isDirectory() - a.isDirectory() || a.name.localeCompare(b.name));
  const rows = entries.map((e) => {
    const name2 = e.name + (e.isDirectory() ? "/" : "");
    return `<li><a href="${escapeHtml(encodeURIComponent(e.name))}${e.isDirectory() ? "/" : ""}">${escapeHtml(name2)}</a></li>`;
  }).join("");
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${escapeHtml(urlPath)}</title>
<style>body{font:15px system-ui;margin:2rem;color:#222}li{margin:.25rem 0}</style>
<body><h1>${escapeHtml(urlPath)}</h1><ul>${urlPath !== "/" ? '<li><a href="../">../</a></li>' : ""}${rows}</ul></body></html>`;
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
  const abs = path.resolve(root, ...parts);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}
function authorized(req, cookieName, key) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === cookieName) {
      const val = Buffer.from(v.join("="));
      const exp = Buffer.from(key);
      return val.length === exp.length && crypto.timingSafeEqual(val, exp);
    }
  }
  return false;
}
function createHandler(opts) {
  const root = opts.root ? path.resolve(opts.root) : null;
  const file = opts.file ? path.resolve(opts.file) : null;
  const cookieName = opts.cookieName || "cloudfact_access";
  return function handle(req, res) {
    const method = req.method;
    const url = new URL(req.url, "http://x");
    if (opts.key) {
      if (url.pathname === "/api/session" && method === "POST") {
        const auth = req.headers.authorization || "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        const a = Buffer.from(token), b = Buffer.from(opts.key);
        if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
          return send(res, 204, "", { "Set-Cookie": `${cookieName}=${opts.key}; Path=/; HttpOnly; Secure; SameSite=Lax` });
        }
        return send(res, 401, '{"error":"invalid key"}', { "Content-Type": "application/json" });
      }
      if (!authorized(req, cookieName, opts.key)) {
        return send(res, 200, GATE, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      }
    }
    if (method !== "GET" && method !== "HEAD") return send(res, 405, "method not allowed");
    let abs;
    if (opts.mode === "file") {
      if (url.pathname !== "/" && url.pathname !== "/index.html" && url.pathname !== "/" + path.basename(file)) return send(res, 404, "not found");
      abs = file;
    } else {
      abs = safeResolve(root, url.pathname);
      if (!abs) return send(res, 404, "not found");
    }
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      return send(res, 404, "not found");
    }
    if (st.isDirectory()) {
      if (!url.pathname.endsWith("/")) return send(res, 301, "", { Location: url.pathname + "/" + url.search });
      const idx = path.join(abs, "index.html");
      if (fs.existsSync(idx)) {
        abs = idx;
        st = fs.statSync(idx);
      } else return send(res, 200, listing(url.pathname, abs), { "Content-Type": "text/html; charset=utf-8" });
    }
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, { ...BASE_HEADERS, ETag: etag });
      return res.end();
    }
    const type = MIME[path.extname(abs).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { ...BASE_HEADERS, "Content-Type": type, "Content-Length": st.size, ETag: etag, "Last-Modified": st.mtime.toUTCString() });
    if (method === "HEAD") return res.end();
    fs.createReadStream(abs).on("error", () => res.destroy()).pipe(res);
  };
}

// src/host.js
init_lib();
var name = process.argv[2];
if (!name) {
  console.error("uso: host.js <nome>");
  process.exit(2);
}
var dir = deployDir(name);
var state = readState(name);
if (!state) {
  console.error("sem state.json");
  process.exit(2);
}
var log = (...a) => console.error((/* @__PURE__ */ new Date()).toISOString(), ...a);
var patch = (p) => {
  state = { ...readState(name), ...p };
  writeState(name, state);
};
var TUNNEL_RE = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/g;
var stopping = false;
var tunnel = null;
var restarts = 0;
var handler = createHandler({ mode: state.mode, root: state.root, file: state.file, key: state.key });
var server = http.createServer(handler);
server.keepAliveTimeout = 65e3;
server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  patch({ hostPid: process.pid, port, status: "starting", local: `http://127.0.0.1:${port}` });
  log("servidor local na porta", port);
  startTunnel(port);
});
function startTunnel(port) {
  if (stopping) return;
  const bin = findCloudflared(readConfig());
  if (!bin) {
    patch({ status: "error", error: "cloudflared n\xE3o encontrado" });
    return;
  }
  const out = fs3.openSync(path3.join(dir, "tunnel.log"), "a");
  tunnel = spawn2(bin, ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate", "--protocol", "http2"], { stdio: ["ignore", "pipe", "pipe"] });
  patch({ tunnelPid: tunnel.pid, url: null, status: "starting" });
  let found = false;
  const scan = (chunk) => {
    fs3.writeSync(out, chunk);
    if (found) return;
    const m = String(chunk).match(TUNNEL_RE);
    if (m) {
      found = true;
      const url = m[0];
      const key = state.key;
      patch({ url, privateUrl: key ? `${url}/#key=${key}` : null, status: "running", error: null, urlAt: (/* @__PURE__ */ new Date()).toISOString() });
      log("t\xFAnel pronto:", url);
    }
  };
  tunnel.stdout.on("data", scan);
  tunnel.stderr.on("data", scan);
  tunnel.on("exit", (code, sig) => {
    fs3.closeSync(out);
    tunnel = null;
    if (stopping) return;
    restarts += 1;
    const delay = Math.min(3e4, 2e3 * restarts);
    log(`cloudflared saiu (code=${code} sig=${sig}); religando em ${delay / 1e3}s`);
    patch({ status: "reconnecting", url: null, privateUrl: null, tunnelPid: null, restarts });
    setTimeout(() => startTunnel(port), delay);
  });
}
function shutdown() {
  if (stopping) return;
  stopping = true;
  log("encerrando");
  patch({ status: "stopped", url: null, privateUrl: null, hostPid: null, tunnelPid: null, stoppedAt: (/* @__PURE__ */ new Date()).toISOString() });
  if (tunnel) {
    try {
      tunnel.kill("SIGTERM");
    } catch {
    }
  }
  server.close();
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("uncaughtException", (e) => {
  log("erro", e);
  patch({ status: "error", error: String(e) });
});
