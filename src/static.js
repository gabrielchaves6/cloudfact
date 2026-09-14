// Servidor estático mínimo e seguro: só serve o que está dentro de `root`
// (ou um único arquivo em modo `file`). Sem dotfiles, sem path traversal.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.avif': 'image/avif',
  '.pdf': 'application/pdf', '.wasm': 'application/wasm',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.vtt': 'text/vtt; charset=utf-8', '.zip': 'application/zip',
};

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-cache',
};

const GATE = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>cloudfact</title>
<style>body{font:16px system-ui;margin:3rem;color:#333}</style><body><p id="m">Autenticando…</p>
<script>(async()=>{const el=document.getElementById('m');const m=location.hash.match(/key=([^&]+)/);
if(!m){el.textContent='Página privada: abra pelo link completo (com #key=…).';return}
const r=await fetch('/api/session',{method:'POST',headers:{Authorization:'Bearer '+decodeURIComponent(m[1])}});
if(r.ok){history.replaceState(null,'',location.pathname+location.search);location.reload()}
else el.textContent='Chave inválida.'})()</script></body></html>`;

function send(res, code, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body ?? '');
  res.writeHead(code, { ...BASE_HEADERS, 'Content-Length': buf.length, ...headers });
  res.end(buf);
}

function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function listing(urlPath, absDir) {
  const entries = fs.readdirSync(absDir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.'))
    .sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
  const rows = entries.map((e) => {
    const name = e.name + (e.isDirectory() ? '/' : '');
    return `<li><a href="${escapeHtml(encodeURIComponent(e.name))}${e.isDirectory() ? '/' : ''}">${escapeHtml(name)}</a></li>`;
  }).join('');
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${escapeHtml(urlPath)}</title>
<style>body{font:15px system-ui;margin:2rem;color:#222}li{margin:.25rem 0}</style>
<body><h1>${escapeHtml(urlPath)}</h1><ul>${urlPath !== '/' ? '<li><a href="../">../</a></li>' : ''}${rows}</ul></body></html>`;
}

function safeResolve(root, urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const parts = decoded.split('/').filter(Boolean);
  if (parts.some((p) => p === '..' || p.startsWith('.'))) return null;
  const abs = path.resolve(root, ...parts);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

function authorized(req, cookieName, key) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === cookieName) {
      const val = Buffer.from(v.join('='));
      const exp = Buffer.from(key);
      return val.length === exp.length && crypto.timingSafeEqual(val, exp);
    }
  }
  return false;
}

/** @param {{mode:'dir'|'file', root?:string, file?:string, key?:string, cookieName?:string}} opts */
export function createHandler(opts) {
  const root = opts.root ? path.resolve(opts.root) : null;
  const file = opts.file ? path.resolve(opts.file) : null;
  const cookieName = opts.cookieName || 'cloudfact_access';

  return function handle(req, res) {
    const method = req.method;
    const url = new URL(req.url, 'http://x');

    if (opts.key) {
      if (url.pathname === '/api/session' && method === 'POST') {
        const auth = req.headers.authorization || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
        const a = Buffer.from(token), b = Buffer.from(opts.key);
        if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
          return send(res, 204, '', { 'Set-Cookie': `${cookieName}=${opts.key}; Path=/; HttpOnly; Secure; SameSite=Lax` });
        }
        return send(res, 401, '{"error":"invalid key"}', { 'Content-Type': 'application/json' });
      }
      if (!authorized(req, cookieName, opts.key)) {
        return send(res, 200, GATE, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      }
    }

    if (method !== 'GET' && method !== 'HEAD') return send(res, 405, 'method not allowed');

    let abs;
    if (opts.mode === 'file') {
      if (url.pathname !== '/' && url.pathname !== '/index.html' && url.pathname !== '/' + path.basename(file)) return send(res, 404, 'not found');
      abs = file;
    } else {
      abs = safeResolve(root, url.pathname);
      if (!abs) return send(res, 404, 'not found');
    }

    let st;
    try { st = fs.statSync(abs); } catch { return send(res, 404, 'not found'); }
    if (st.isDirectory()) {
      if (!url.pathname.endsWith('/')) return send(res, 301, '', { Location: url.pathname + '/' + url.search });
      const idx = path.join(abs, 'index.html');
      if (fs.existsSync(idx)) { abs = idx; st = fs.statSync(idx); }
      else return send(res, 200, listing(url.pathname, abs), { 'Content-Type': 'text/html; charset=utf-8' });
    }

    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ...BASE_HEADERS, ETag: etag }); return res.end(); }
    const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { ...BASE_HEADERS, 'Content-Type': type, 'Content-Length': st.size, ETag: etag, 'Last-Modified': st.mtime.toUTCString() });
    if (method === 'HEAD') return res.end();
    fs.createReadStream(abs).on('error', () => res.destroy()).pipe(res);
  };
}
