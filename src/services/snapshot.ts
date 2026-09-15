/**
 * Thumbnails for the catalog page. A live frame only works for a site that is open to everyone, so the
 * preview is captured when the catalog is published, from whatever this machine can already read:
 * the published folder on disk, the app's own port, or the URL itself (with the private key when there
 * is one). Local stylesheets are inlined so the thumbnail looks like the real page even when the site
 * behind it demands a sign-in. Nothing is executed: the frame renders the snapshot with scripts off.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { DeployState } from '../types.js';

/** Per-thumbnail cap. Enough for a page of text and its styles, small enough to keep the catalog light. */
const MAX_HTML = 60_000;
const MAX_CSS = 20_000;
const FETCH_TIMEOUT = 4_000;

type Resolver = (rel: string) => Promise<string | null>;

const isRelative = (href: string) => !/^(https?:)?\/\//.test(href) && !href.startsWith('data:') && !href.startsWith('#');

async function get(url: string, headers: Record<string, string> = {}): Promise<string | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT), redirect: 'follow' });
    if (!res.ok) return null;
    if (!(res.headers.get('content-type') ?? '').includes('html') && !url.endsWith('.css')) return null;
    return (await res.text()).slice(0, MAX_HTML);
  } catch {
    return null;
  }
}

function fromDisk(root: string, file: string | null): { html: string; resolve: Resolver } | null {
  const entry = file ?? path.join(root, 'index.html');
  try {
    const html = fs.readFileSync(entry, 'utf8').slice(0, MAX_HTML);
    const base = file ? path.dirname(file) : root;
    return {
      html,
      resolve: async (rel) => {
        const target = path.resolve(base, rel);
        if (!target.startsWith(path.resolve(base))) return null; // never read outside the published folder
        try {
          return fs.readFileSync(target, 'utf8').slice(0, MAX_CSS);
        } catch {
          return null;
        }
      },
    };
  } catch {
    return null;
  }
}

function fromOrigin(origin: string, headers: Record<string, string> = {}): { fetchRoot: () => Promise<string | null>; resolve: Resolver } {
  return {
    fetchRoot: () => get(origin, headers),
    resolve: (rel) => get(new URL(rel, origin + '/').toString(), headers),
  };
}

/** `<link rel=stylesheet>` → `<style>`, so the thumbnail keeps its looks without fetching anything. */
async function inlineStyles(html: string, resolve: Resolver): Promise<string> {
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].filter((m) => /rel\s*=\s*["']?stylesheet/i.test(m[0])).slice(0, 4);
  let out = html;
  for (const m of links) {
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1];
    if (!href || !isRelative(href)) continue;
    const css = await resolve(href);
    if (css) out = out.replace(m[0], `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`);
  }
  return out;
}

/** A thumbnail must never reach the network: nested frames could challenge the visitor for credentials. */
const stripActive = (html: string) =>
  html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<iframe\b[^>]*\/?>/gi, '')
    .replace(/<(object|embed|frame)\b[^>]*>/gi, '');

/**
 * Best-effort thumbnail for one deploy. Returns the HTML to drop into a sandboxed frame, or null when
 * this machine cannot see the content (a deploy made somewhere else, or an app that is not running).
 */
export async function snapshot(state: DeployState | undefined, entry: { url: string | null; visibility: string }): Promise<string | null> {
  let html: string | null = null;
  let resolve: Resolver = async () => null;

  const disk = state?.root || state?.file ? fromDisk(state.root ?? path.dirname(state.file!), state.file ?? null) : null;
  if (disk) {
    html = disk.html;
    resolve = disk.resolve;
  }
  if (!html) {
    // an app published with `expose` answers on this machine, before any gate
    const port = state?.forwardPort ?? state?.targetPort ?? null;
    if (port) {
      const o = fromOrigin(`http://127.0.0.1:${port}`);
      html = await o.fetchRoot();
      resolve = o.resolve;
    }
  }
  if (!html && entry.url) {
    const headers: Record<string, string> = state?.key ? { cookie: `cloudfact_access=${state.key}` } : {};
    if (entry.visibility !== 'access') {
      const o = fromOrigin(entry.url, headers);
      html = await o.fetchRoot();
      resolve = o.resolve;
    }
  }
  if (!html) return null;
  const styled = await inlineStyles(stripActive(html), resolve);
  return styled.length > MAX_HTML ? styled.slice(0, MAX_HTML) : styled;
}

/** Thumbnails for a whole catalog, keyed by deploy name. Failures are simply absent. */
export async function snapshots(
  entries: { name: string; url: string | null; visibility: string }[],
  states: Map<string, DeployState>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    entries.map(async (e) => {
      const html = await snapshot(states.get(e.name), e);
      if (html) out[e.name] = html;
    }),
  );
  return out;
}
