/**
 * Account-wide catalog: every cloudfact deploy that lives in the Cloudflare account, not just the ones
 * this machine remembers. Cloudflare Workers carry script tags, so cloudfact marks what it creates with
 * `cloudfact` plus `cloudfact:project:<project>`; listing the account's scripts is then enough to rebuild
 * the whole picture from any machine, even after a reinstall.
 *
 * Quick tunnels have no account-side resource: they exist only while the machine that started them runs,
 * so they can only ever come from local state (`local: true`, `inAccount: false`).
 */
import { readConfig, type Config } from '../config.js';
import { credentials, oauthToken } from './wrangler.js';
import { listDeploys } from './state.js';
import type { CatalogEntry, CatalogResult, DeployKind, DeployState, Visibility } from '../types.js';

const API = 'https://api.cloudflare.com/client/v4';
export const TAG = 'cloudfact';
export const PROJECT_TAG = 'cloudfact:project:';
const VIS_TAG = 'cloudfact:vis:';
const KIND_TAG = 'cloudfact:kind:';

export function projectTag(project: string): string {
  return PROJECT_TAG + slugProject(project);
}

/** Project names travel inside a tag, so keep them short and unambiguous. Accents fold to ASCII. */
export function slugProject(input: string): string {
  return (
    input
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'default'
  );
}

/**
 * Everything the catalog shows comes back in the scripts listing, so it travels in the tags: what the
 * deploy is (static files vs an app served through a proxy) and who can open it (open to anyone, a
 * key-gated link, or Cloudflare Access sign-in).
 */
export function tagsFor(opts: { project?: string | null; visibility?: Visibility | null; kind?: DeployKind | null } = {}): string[] {
  const tags = [TAG];
  if (opts.project) tags.push(projectTag(opts.project));
  if (opts.visibility) tags.push(VIS_TAG + opts.visibility);
  if (opts.kind) tags.push(KIND_TAG + opts.kind);
  return tags;
}

const tagValue = (tags: string[] | undefined, prefix: string): string | null =>
  (tags ?? []).find((t) => t.startsWith(prefix))?.slice(prefix.length) || null;

export function projectFromTags(tags: string[] | undefined): string | null {
  const t = (tags ?? []).find((x) => x.startsWith(PROJECT_TAG));
  return t ? t.slice(PROJECT_TAG.length) || null : null;
}

/**
 * Bearer token for the REST API. The API token is preferred; the browser login (wrangler OAuth) also
 * yields a usable token, with narrower scopes — enough to list and tag scripts.
 */
export function bearer(cfg: Config = readConfig()): { token: string; accountId: string | null } | null {
  const creds = credentials(cfg);
  if (creds?.token) return { token: creds.token, accountId: creds.accountId };
  const oauth = oauthToken();
  if (oauth) return { token: oauth, accountId: creds?.accountId ?? cfg.cloudflareAccountId ?? null };
  return null;
}

interface Envelope<T> {
  success: boolean;
  result: T;
  errors?: { code: number; message: string }[];
}

async function api<T>(token: string, method: string, path: string, body?: unknown, fetchImpl: typeof fetch = fetch): Promise<T> {
  const res = await fetchImpl(API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let env: Envelope<T> | undefined;
  try {
    env = (await res.json()) as Envelope<T>;
  } catch {
    /* no body */
  }
  if (!res.ok || env?.success === false) {
    const msg = env?.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${res.status}`;
    throw new Error(`Cloudflare API ${method} ${path} failed — ${msg}`);
  }
  return env!.result;
}

/** Marks a worker as cloudfact's, with its project, visibility and kind. Idempotent; a deploy resets tags. */
export async function tagWorker(
  name: string,
  opts: { project?: string | null; visibility?: Visibility | null; kind?: DeployKind | null } = {},
  fetchImpl?: typeof fetch,
): Promise<void> {
  const b = bearer();
  if (!b?.accountId) return; // best effort: tagging must never fail a deploy
  await api(b.token, 'PUT', `/accounts/${b.accountId}/workers/scripts/${encodeURIComponent(name)}/tags`, tagsFor(opts), fetchImpl);
}

/** What a local record says, for tunnels and as a fallback when an old deploy has no tags yet. */
export function visibilityOf(s: DeployState): Visibility {
  if (s.access) return 'access';
  return s.key ? 'private' : 'public';
}
export function kindOf(s: DeployState): DeployKind {
  return s.mode === 'proxy' ? 'app' : 'static';
}

interface ScriptRow {
  id: string;
  tags?: string[];
  created_on?: string;
  modified_on?: string;
  has_assets?: boolean;
}
interface AccessAppRow {
  id: string;
  name?: string;
  domain?: string;
  aud?: string;
}

/**
 * The account's cloudfact deploys, grouped by project, merged with what this machine knows.
 * Three API calls: scripts, the workers.dev subdomain and (best effort) the Access applications.
 */
export async function catalog(opts: { project?: string; fetchImpl?: typeof fetch } = {}): Promise<CatalogResult> {
  const cfg = readConfig();
  const b = bearer(cfg);
  if (!b) throw new Error('not signed in to Cloudflare: run `cloudfact login --device` or `cloudfact login --token <token>`');
  if (!b.accountId) throw new Error('Cloudflare account id unknown; run `cloudfact login` again (it discovers the account)');
  const f = opts.fetchImpl;
  const scripts = await api<ScriptRow[]>(b.token, 'GET', `/accounts/${b.accountId}/workers/scripts`, undefined, f);
  let subdomain: string | null = null;
  try {
    subdomain =
      (await api<{ subdomain?: string }>(b.token, 'GET', `/accounts/${b.accountId}/workers/subdomain`, undefined, f)).subdomain ?? null;
  } catch {
    /* no subdomain yet */
  }
  let apps: AccessAppRow[] = [];
  try {
    apps = await api<AccessAppRow[]>(b.token, 'GET', `/accounts/${b.accountId}/access/apps?per_page=100`, undefined, f);
  } catch {
    /* the token may not carry Access scopes: the catalog still works without sign-in details */
  }

  const local = new Map(listDeploys().map((s) => [s.name, s]));
  // a deploy can be tunnel-backed here and still own a Worker in the account (an Access proxy in front
  // of the tunnel), so membership is decided by the account's script names, not by the tag alone
  const accountNames = new Set(scripts.map((s) => s.id));
  const entries: CatalogEntry[] = [];
  for (const s of scripts) {
    if (!(s.tags ?? []).includes(TAG)) continue;
    const url = subdomain ? `https://${s.id}.${subdomain}.workers.dev` : null;
    const state = local.get(s.id);
    const app = url ? apps.find((a) => a.domain === new URL(url).host) : undefined;
    const visibility = (tagValue(s.tags, VIS_TAG) as Visibility | null) ?? (state ? visibilityOf(state) : app ? 'access' : 'public');
    entries.push({
      name: s.id,
      project: projectFromTags(s.tags) ?? state?.project ?? null,
      url,
      inAccount: true,
      local: Boolean(state),
      access: app ? { emails: state?.access?.emails ?? [], appId: app.id } : null,
      visibility,
      kind: (tagValue(s.tags, KIND_TAG) as DeployKind | null) ?? (state ? kindOf(state) : s.has_assets ? 'static' : 'app'),
      hasAssets: Boolean(s.has_assets),
      createdAt: s.created_on ?? null,
      modifiedAt: s.modified_on ?? null,
      backend: state?.backend ?? 'workers',
      status: state?.status ?? 'deployed',
    });
  }
  // tunnels live only on this machine; show them so the catalog is the whole picture, flagged as such
  for (const s of local.values()) {
    if (entries.some((e) => e.name === s.name)) continue;
    if (s.backend !== 'tunnel') continue;
    entries.push({
      name: s.name,
      project: s.project ?? null,
      url: s.url ?? null,
      inAccount: accountNames.has(s.name),
      local: true,
      access: s.access ? { emails: s.access.emails, appId: s.access.appId } : null,
      visibility: visibilityOf(s),
      kind: kindOf(s),
      hasAssets: s.mode !== 'proxy',
      createdAt: s.startedAt ?? null,
      modifiedAt: s.urlAt ?? s.startedAt ?? null,
      backend: 'tunnel',
      status: s.status,
    });
  }

  const wanted = opts.project ? slugProject(opts.project) : null;
  const kept = wanted ? entries.filter((e) => (e.project ?? '') === wanted) : entries;
  kept.sort((a, b2) => (b2.modifiedAt ?? '').localeCompare(a.modifiedAt ?? '') || a.name.localeCompare(b2.name));
  const names = [...new Set(kept.map((e) => e.project ?? ''))].sort();
  return {
    accountId: b.accountId,
    accountName: cfg.cloudflareAccountName ?? null,
    subdomain,
    projects: names.map((p) => ({ project: p || null, deploys: kept.filter((e) => (e.project ?? '') === p) })),
  };
}

/** Email of whoever is signed in, used to put Access in front of the catalog page without asking. */
export async function accountEmail(fetchImpl?: typeof fetch): Promise<string | null> {
  const b = bearer();
  if (!b) return null;
  try {
    return (await api<{ email?: string }>(b.token, 'GET', '/user', undefined, fetchImpl)).email ?? null;
  } catch {
    return null;
  }
}

/** Files an existing deploy under a project (or clears it with null), without redeploying. */
export async function setProject(name: string, project: string | null, fetchImpl?: typeof fetch): Promise<CatalogEntry> {
  const b = bearer();
  if (!b?.accountId) throw new Error('not signed in to Cloudflare: run `cloudfact login --token <token>`');
  const current = (await catalog({ fetchImpl })).projects.flatMap((p) => p.deploys).find((d) => d.name === name);
  if (!current) throw new Error(`deploy "${name}" is not in the account catalog`);
  await api(
    b.token,
    'PUT',
    `/accounts/${b.accountId}/workers/scripts/${encodeURIComponent(name)}/tags`,
    tagsFor({ project, visibility: current.visibility, kind: current.kind }),
    fetchImpl,
  );
  const found = (await catalog({ fetchImpl })).projects.flatMap((p) => p.deploys).find((d) => d.name === name);
  if (!found) throw new Error(`deploy "${name}" is not in the account catalog`);
  return found;
}
