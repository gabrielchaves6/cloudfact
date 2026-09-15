/**
 * Servidor estático mínimo e seguro: só serve o que está dentro de `root` (ou um único arquivo
 * em modo `file`). Sem dotfiles, sem path traversal, sem seguir links para fora.
 * Modo privado: sem o cookie, toda rota devolve a página de gate, que troca `#key=` por cookie HttpOnly.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

export interface StaticOptions {
  mode: 'dir' | 'file';
  root?: string | null;
  file?: string | null;
  key?: string | null;
  cookieName?: string;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.vtt': 'text/vtt; charset=utf-8',
  '.zip': 'application/zip',
};

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-cache',
};

const GATE_HTML = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>cloudfact</title>
<style>body{font:16px system-ui;margin:3rem;color:#333}</style><body><p id="m">Autenticando…</p>
<script>(async()=>{const el=document.getElementById('m');const m=location.hash.match(/key=([^&]+)/);
if(!m){el.textContent='Página privada: abra pelo link completo (com #key=…).';return}
const r=await fetch('/api/session',{method:'POST',headers:{Authorization:'Bearer '+decodeURIComponent(m[1])}});
if(r.ok){history.replaceState(null,'',location.pathname+location.search);location.reload()}
else el.textContent='Chave inválida.'})()</script></body></html>`;

function send(res: ServerResponse, code: number, body: string | Buffer, headers: Record<string, string> = {}): void {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(code, { ...BASE_HEADERS, 'Content-Length': buf.length, ...headers });
  res.end(buf);
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

function listing(urlPath: string, absDir: string): string {
  const entries = fs
    .readdirSync(absDir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.'))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  const rows = entries
    .map((e) => {
      const suffix = e.isDirectory() ? '/' : '';
      return `<li><a href="${escapeHtml(encodeURIComponent(e.name))}${suffix}">${escapeHtml(e.name + suffix)}</a></li>`;
    })
    .join('');
  const up = urlPath !== '/' ? '<li><a href="../">../</a></li>' : '';
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${escapeHtml(urlPath)}</title>
<style>body{font:15px system-ui;margin:2rem;color:#222}li{margin:.25rem 0}</style>
<body><h1>${escapeHtml(urlPath)}</h1><ul>${up}${rows}</ul></body></html>`;
}

/** Resolve um caminho de URL dentro de root. null = recusado (traversal, dotfile, inválido). */
export function safeResolve(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const parts = decoded.split('/').filter(Boolean);
  if (parts.some((p) => p === '..' || p.startsWith('.'))) return null;
  const abs = path.resolve(root, ...parts);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

function timingEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function hasCookie(req: IncomingMessage, name: string, key: string): boolean {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return timingEqual(v.join('='), key);
  }
  return false;
}

export function createStaticHandler(opts: StaticOptions): (req: IncomingMessage, res: ServerResponse) => void {
  const root = opts.root ? path.resolve(opts.root) : null;
  const file = opts.file ? path.resolve(opts.file) : null;
  const cookieName = opts.cookieName ?? 'cloudfact_access';
  const key = opts.key ?? null;

  return (req, res) => {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (key) {
      if (url.pathname === '/api/session' && method === 'POST') {
        const auth = req.headers.authorization ?? '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
        if (timingEqual(token, key)) {
          return send(res, 204, '', { 'Set-Cookie': `${cookieName}=${key}; Path=/; HttpOnly; Secure; SameSite=Lax` });
        }
        return send(res, 401, '{"error":"invalid key"}', { 'Content-Type': 'application/json' });
      }
      if (!hasCookie(req, cookieName, key)) {
        return send(res, 200, GATE_HTML, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      }
    }

    if (method !== 'GET' && method !== 'HEAD') return send(res, 405, 'method not allowed');

    let abs: string | null;
    if (opts.mode === 'file') {
      const allowed = new Set(['/', '/index.html', `/${path.basename(file ?? '')}`]);
      if (!allowed.has(url.pathname)) return send(res, 404, 'not found');
      abs = file;
    } else {
      abs = root ? safeResolve(root, url.pathname) : null;
    }
    if (!abs) return send(res, 404, 'not found');

    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      return send(res, 404, 'not found');
    }
    if (stat.isDirectory()) {
      if (!url.pathname.endsWith('/')) return send(res, 301, '', { Location: `${url.pathname}/${url.search}` });
      const index = path.join(abs, 'index.html');
      if (fs.existsSync(index)) {
        abs = index;
        stat = fs.statSync(index);
      } else {
        return send(res, 200, listing(url.pathname, abs), { 'Content-Type': 'text/html; charset=utf-8' });
      }
    }

    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ...BASE_HEADERS, ETag: etag });
      return res.end();
    }
    res.writeHead(200, {
      ...BASE_HEADERS,
      'Content-Type': MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': stat.size,
      ETag: etag,
      'Last-Modified': stat.mtime.toUTCString(),
    });
    if (method === 'HEAD') return res.end();
    fs.createReadStream(abs)
      .on('error', () => res.destroy())
      .pipe(res);
  };
}
