/** cloudfact public API: what the MCP server and the CLI expose. */
import fs from 'node:fs';
import path from 'node:path';
import { BIN_SCRIPT, BRAND_DIR, HOME, VERSION, readConfig, writeConfig } from './config.js';
import { deployTunnel, newKey, stopTunnel } from './backends/tunnel/index.js';
import { POWER_PATH } from './backends/tunnel/power.js';
import { deployAccessProxy, putSecret, rotateWorkersKey } from './backends/workers/index.js';
import { expiryFrom } from './services/duration.js';
import { accountEmail, bearer, catalog as readCatalog, publishedCatalogName, switchWorker, tagWorker } from './services/catalog.js';
import { galleryHtml } from './services/gallery.js';
import { snapshots } from './services/snapshot.js';
import { deleteWorker, deployWorkers } from './backends/workers/index.js';
import { cloudflaredVersion, findCloudflared } from './services/cloudflared.js';
import {
  deployDir,
  effectiveState,
  isLive,
  listDeploys,
  patchState,
  readState,
  removeDeployDir,
  slug,
  summarize,
  writeState,
} from './services/state.js';
import { credentials } from './services/wrangler.js';
import { spawn, spawnSync } from 'node:child_process';

const hasSsh = (): boolean => spawnSync('sh', ['-c', 'command -v ssh'], { encoding: 'utf8' }).status === 0;
import type {
  Backend,
  CatalogResult,
  ControlTargets,
  DeployMode,
  DeployOptions,
  DeployResult,
  DeployState,
  DeploySummary,
  ExposeOptions,
  PowerResult,
} from './types.js';

export { listDeploys, readLogs, summarize } from './services/state.js';
export { catalog, setProject } from './services/catalog.js';
export { setupCodex } from './services/codex.js';
export { loginWithDevice, loginWithToken, logout } from './services/auth.js';
export { installCloudflared } from './services/cloudflared.js';
export { VERSION } from './config.js';
export type * from './types.js';

interface Target {
  mode: DeployMode;
  root: string | null;
  file: string | null;
  defaultName: string;
}

function resolveTarget(target?: string): Target {
  const abs = path.resolve(target ?? '.');
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw new Error(`path does not exist: ${abs}`);
  }
  if (stat.isDirectory()) return { mode: 'dir', root: abs, file: null, defaultName: path.basename(abs) };
  return { mode: 'file', root: null, file: abs, defaultName: path.basename(abs, path.extname(abs)) };
}

export function resolveBackend(choice: DeployOptions['backend']): Backend {
  const c = choice ?? 'auto';
  if (c === 'pages') return 'workers'; // legacy alias
  if (c === 'auto') return credentials() ? 'workers' : 'tunnel';
  if (c === 'tunnel' || c === 'workers') return c;
  throw new Error(`unknown backend: ${String(c)}`);
}

export async function deploy(opts: DeployOptions = {}): Promise<DeployResult> {
  const t = resolveTarget(opts.path);
  const name = slug(opts.name ?? t.defaultName);
  const priv = opts.private === true || !opts.public;
  const backend = resolveBackend(opts.backend);
  const common = { name, mode: t.mode, root: t.root, file: t.file, private: priv };
  if (opts.access?.length && backend !== 'workers') {
    throw new Error(
      '--access (Cloudflare Access sign-in) works on the workers backend; sign in with `cloudfact login --token` and use --backend workers',
    );
  }
  const result =
    backend === 'workers'
      ? await deployWorkers({
          ...common,
          key: priv ? newKey() : null,
          keyExpiresAt: priv ? expiryFrom(opts.expires) : null,
          access: opts.access ?? null,
          project: opts.project ?? null,
        })
      : await deployTunnel({
          ...common,
          keyExpiresAt: priv ? expiryFrom(opts.expires) : null,
          project: opts.project ?? null,
          restart: Boolean(opts.restart),
          timeoutMs: opts.timeoutMs ?? 45_000,
        });
  await refreshCatalogPage(name);
  return result;
}

/** Publish an app that already listens on a port, here or on a machine reachable over SSH. Tunnel backend only. Private by default. */
export async function expose(opts: ExposeOptions): Promise<DeployResult> {
  if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) throw new Error(`invalid port: ${String(opts.port)}`);
  const ssh = opts.ssh?.destination
    ? { destination: opts.ssh.destination, port: opts.ssh.port, identity: opts.ssh.identity, strictHostKey: opts.ssh.strictHostKey }
    : null;
  const access = opts.access?.length ? opts.access : null;
  // With Access the tunnel keeps its key gate and only the Worker holds the key, so the
  // trycloudflare hostname is useless on its own; identity is what lets a person in.
  const priv = access ? true : !opts.public;
  const name = slug(opts.name ?? (ssh ? `${ssh.destination.split('@').pop()}-${opts.port}` : `port-${opts.port}`));
  const exposed = await deployTunnel({
    name,
    mode: 'proxy',
    root: null,
    file: null,
    targetPort: opts.port,
    ssh,
    private: priv,
    keyExpiresAt: priv ? (access ? null : expiryFrom(opts.expires)) : null,
    project: opts.project ?? null,
    restart: Boolean(opts.restart),
    timeoutMs: opts.timeoutMs ?? 45_000,
  });
  if (!access) {
    await refreshCatalogPage(name);
    return exposed;
  }
  // the tunnel's own hostname: on a deploy that was already live, `url` is the Worker's, and pointing the Worker at itself loops
  const origin = readState(name)?.tunnelUrl ?? exposed.url;
  if (!origin) throw new Error(`the tunnel for "${name}" came up without a URL`);
  const proxy = await deployAccessProxy({ name, origin, originKey: readState(name)?.key ?? null, emails: access });
  const next = { ...readState(name)!, url: proxy.url, tunnelUrl: origin, privateUrl: null, access: proxy.access };
  writeState(name, next);
  await refreshCatalogPage(name);
  return { ...summarize(next), reused: exposed.reused };
}

/**
 * Fills in what only this machine knows: the link that already carries the private key, and the app's own
 * login. A page open to anyone must never carry either; a page behind sign-in may, and that is the point
 * of it — one place that opens everything you host without asking for a second secret.
 */
export function withLocalSecrets(c: CatalogResult, states: Map<string, DeployState>, gated: boolean): CatalogResult {
  for (const group of c.projects)
    for (const d of group.deploys) {
      const st = gated ? states.get(d.name) : undefined;
      d.openUrl = st ? (st.privateUrl ?? d.url) : null;
      d.creds = st?.creds ?? null;
    }
  return c;
}

/**
 * Marks what the catalog page may turn off and on, and returns the list its Worker receives: the Workers
 * in the account (never the page itself), and the tunnels this machine serves through a host that has
 * the switch. A page found on this machine without a record of it is left alone.
 */
export function withControl(c: CatalogResult, states: Map<string, DeployState>, self: string): ControlTargets {
  const targets: ControlTargets = { workers: [], tunnels: {} };
  for (const d of c.projects.flatMap((p) => p.deploys)) {
    if (d.name === self || d.untracked) continue;
    const s = states.get(d.name);
    if (d.inAccount) {
      targets.workers.push(d.name);
      d.switchable = true;
    } else if (s?.backend === 'tunnel' && s.controlKey && isLive(s) && s.url) {
      targets.tunnels[d.name] = { url: s.url, key: s.controlKey };
      d.switchable = true;
    }
  }
  return targets;
}

/**
 * Records how to get into the app behind a deploy (its own login, not cloudfact's). Stored with the
 * deploy on this machine and surfaced only on a catalog page that is itself behind sign-in.
 */
export function setCredentials(
  name: string,
  creds: { user?: string | null; password?: string | null; note?: string | null } | null,
): DeploySummary {
  const s = readState(name);
  if (!s) throw new Error(`deploy "${name}" does not exist`);
  const next = { ...s, creds: creds && (creds.user || creds.password || creds.note) ? creds : null };
  writeState(name, next);
  return summarize(next);
}

/**
 * One-off nudge: once someone has a handful of deploys and no catalog page yet, it is worth telling them
 * the page exists. Returns the line to print exactly once, then never again.
 */
export function catalogHint(): string | null {
  const cfg = readConfig();
  if (cfg.catalogHintShown || cfg.catalogDeploy) return null;
  if (listDeploys().length < 3) return null;
  writeConfig({ ...cfg, catalogHintShown: true });
  return 'tip: `cloudfact catalog --publish` turns everything you host here into one page, behind a sign-in.';
}

/**
 * Keeps a published catalog page current: it is a snapshot, so a new deploy would leave it stale.
 * Runs detached so the deploy that triggered it returns immediately, and does nothing when no catalog
 * page exists. `CLOUDFACT_NO_CATALOG_REFRESH` stops the refresh from refreshing itself.
 */
export async function refreshCatalogPage(justDeployed: string): Promise<boolean> {
  if (process.env.CLOUDFACT_NO_CATALOG_REFRESH === '1') return false;
  let name: string | null;
  try {
    name = await publishedCatalogName();
  } catch {
    return false;
  }
  if (!name || name === justDeployed) return false;
  try {
    const child = spawn(process.execPath, [BIN_SCRIPT, 'catalog', '--publish', '--name', name, '--json'], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, CLOUDFACT_NO_CATALOG_REFRESH: '1' },
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * Publishes the catalog itself: a page with one card per cloudfact in the account, grouped by project,
 * showing whether each is public, key-gated or behind sign-in, and static or a server app.
 *
 * The page is an index of everything you host, so it asks for identity by default: without an explicit
 * list, Cloudflare Access is put in front of it for the email that owns the account. It falls back to a
 * private key link only when that email cannot be determined, and `public: true` still opts out.
 */
export async function publishCatalog(
  opts: { name?: string; project?: string; access?: string[]; public?: boolean; title?: string } = {},
): Promise<DeployResult> {
  const c = await readCatalog();
  const access = opts.access ?? (opts.public ? undefined : ((await accountEmail()) ?? undefined));
  const states = new Map(listDeploys().map((s) => [s.name, s]));
  const name = slug(opts.name ?? readConfig().catalogDeploy ?? 'cloudfacts');
  withLocalSecrets(c, states, Boolean(access));
  // behind sign-in, the page is also where things get turned off: its Worker needs the API token for that
  const token = credentials()?.token;
  const control = access && token ? { accountId: c.accountId, token, targets: withControl(c, states, name) } : null;
  const shots = await snapshots(
    c.projects.flatMap((p) => p.deploys).map((d) => ({ name: d.name, url: d.url, visibility: d.visibility })),
    states,
  );
  const dir = path.join(HOME, 'catalog');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // the page carries its own typography and mark: nothing is fetched from anywhere else at view time
  for (const file of fs.existsSync(BRAND_DIR) ? fs.readdirSync(BRAND_DIR) : [])
    fs.copyFileSync(path.join(BRAND_DIR, file), path.join(dir, file));
  fs.writeFileSync(path.join(dir, 'index.html'), galleryHtml(c, { title: opts.title, snapshots: shots, control: Boolean(control) }));
  const priv = !opts.public;
  const result = await deployWorkers({
    name,
    mode: 'dir',
    root: dir,
    file: null,
    private: priv,
    key: priv ? newKey() : null,
    keyExpiresAt: null,
    access: access ? [access].flat() : null,
    project: opts.project ?? 'cloudfact',
    control,
  });
  writeConfig({ ...readConfig(), catalogDeploy: result.name });
  // marks the page so any machine can find it later and keep it current
  await tagWorker(result.name, {
    project: opts.project ?? 'cloudfact',
    visibility: result.access ? 'access' : result.privateUrl ? 'private' : 'public',
    kind: 'static',
    catalog: true,
  }).catch(() => {});
  return result;
}

/**
 * Issues a new private key (and optional expiry) for a live tunnel deploy without restarting it: the old
 * link and every session cookie stop working immediately. On a public deploy this turns it private.
 */
export async function rotate(name: string, opts: { expires?: string } = {}): Promise<DeployResult> {
  const s = effectiveState(name);
  if (!s) throw new Error(`deploy "${name}" does not exist`);
  const key = newKey();
  const keyExpiresAt = expiryFrom(opts.expires);
  if (s.backend === 'workers') {
    if (s.status !== 'deployed' || !s.url) throw new Error(`deploy "${name}" is not deployed`);
    rotateWorkersKey(name, key, keyExpiresAt);
  } else if (!isLive(s) || !s.url) {
    throw new Error(`deploy "${name}" is not running`);
  }
  const next = { ...s, key, keyExpiresAt, privateUrl: `${s.url}/#key=${key}` };
  writeState(name, next);
  return { ...summarize(next), reused: false };
}

/**
 * Gives the sign-in pages of the deploys behind Access their own email: the Resend API key becomes each
 * Worker's RESEND_API_KEY secret, and the page then mails the code itself (from CloudFact
 * <onboarding@resend.dev>) and checks it in its own Durable Object, instead of going through Access. The
 * key comes from the caller (stdin, in the CLI) and is not stored on this machine; the secret outlives
 * redeploys. Without names, every deploy behind Access.
 */
export function setMailKey(key: string, names: string[] = []): { set: string[]; failed: { name: string; error: string }[] } {
  if (!/^re_\S{10,}$/.test(key)) throw new Error('that does not look like a Resend API key (re_…)');
  const targets = names.length
    ? names
    : listDeploys()
        .filter((s) => s.access)
        .map((s) => s.name);
  if (!targets.length) throw new Error('no deploy behind Access here (deploy or expose with --access first)');
  const out = { set: [] as string[], failed: [] as { name: string; error: string }[] };
  for (const name of targets) {
    if (!readState(name)?.access) {
      out.failed.push({ name, error: 'not behind Access' });
      continue;
    }
    const dir = deployDir(name);
    const workerDir = path.join(dir, 'worker');
    const r = putSecret(name, 'RESEND_API_KEY', key, {
      cwd: fs.existsSync(workerDir) ? workerDir : dir,
      logFile: path.join(dir, 'wrangler.log'),
    });
    if (r.status === 0) out.set.push(name);
    else out.failed.push({ name, error: `wrangler secret put failed: ${r.text.slice(-300)}` });
  }
  return out;
}

export async function stop(name: string): Promise<{ name: string; stopped: boolean; note?: string }> {
  const s = readState(name);
  if (!s) throw new Error(`deploy "${name}" does not exist`);
  if (s.backend === 'workers')
    return { name, stopped: false, note: 'Workers deploys have no local process; `remove` deletes the worker on Cloudflare.' };
  await stopTunnel(name);
  await refreshCatalogPage(name);
  return { name, stopped: true };
}

export async function stopAll(): Promise<{ name: string; stopped: boolean }[]> {
  const out = [];
  for (const s of listDeploys()) if (s.backend === 'tunnel' && s.status !== 'stopped') out.push(await stop(s.name));
  return out;
}

/**
 * Turns a cloudfact off, or back on. Off only means that its link answers nothing: the files, the address,
 * the key and the sign-in all stay, so turning it on brings the very same link back. A Worker loses its
 * workers.dev address while off; a tunnel keeps its hostname and answers with a "this page is off" page.
 * Deploying it again also turns it back on.
 */
export async function power(name: string, on: boolean): Promise<PowerResult> {
  const s = effectiveState(name);
  if (!s && !bearer()) throw new Error(`deploy "${name}" does not exist`);
  let result: PowerResult = { name, on };
  // a tunnel behind an Access proxy is reached through its Worker, so that is the switch to flip
  if (s?.backend === 'tunnel' && !s.access) result = await powerTunnel(s, on);
  else await switchWorker(name, on, { known: Boolean(s) });
  await refreshCatalogPage(name);
  return result;
}

async function powerTunnel(s: DeployState, on: boolean): Promise<PowerResult> {
  const { name, mode } = s;
  if (!isLive(s)) {
    patchState(name, { off: !on });
    return {
      name,
      on,
      note: on ? `not running: start it again with \`cloudfact ${mode === 'proxy' ? 'expose' : 'deploy'}\`` : 'not running',
    };
  }
  if (!s.controlKey)
    throw new Error(
      `"${name}" was started by an older cloudfact, which has no off switch: \`cloudfact stop ${name}\` ends it, and deploying it again with --restart gives it one (and a new link)`,
    );
  // the host flips it itself: immediate, and open WebSockets close with it
  const local = s.local ?? (s.port ? `http://127.0.0.1:${s.port}` : null);
  if (local) {
    try {
      const res = await fetch(`${local}${POWER_PATH}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${s.controlKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ on }),
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) return { name, on: ((await res.json()) as { on: boolean }).on };
    } catch {
      /* not answering here: the state file below is what it re-reads every second anyway */
    }
  }
  patchState(name, { off: !on });
  return { name, on };
}

export async function remove(name: string): Promise<{ name: string; removed: true; remote?: string }> {
  const s = readState(name);
  if (!s) throw new Error(`deploy "${name}" does not exist`);
  let remote: string | undefined;
  if (s.backend === 'tunnel') await stopTunnel(name);
  if (s.backend === 'workers' && s.status === 'deployed') remote = await deleteWorker(name);
  removeDeployDir(name);
  await refreshCatalogPage(name);
  return { name, removed: true, remote };
}

export interface StatusResult extends DeploySummary {
  reachable?: boolean;
  httpStatus?: number;
  checkError?: string;
}

export async function status(name: string, opts: { check?: boolean } = {}): Promise<StatusResult> {
  const s = effectiveState(name);
  if (!s) throw new Error(`deploy "${name}" does not exist`);
  const out: StatusResult = summarize(s);
  if ((opts.check ?? true) && s.url) {
    try {
      const res = await fetch(s.url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(8000) });
      out.reachable = res.status < 500;
      out.httpStatus = res.status;
    } catch (e) {
      out.reachable = false;
      out.checkError = (e as Error & { cause?: Error }).cause?.message ?? (e as Error).message;
    }
  }
  return out;
}

export interface DoctorReport {
  version: string;
  node: string;
  home: string;
  cloudflared: { path: string; version: string | null } | { missing: true; hint: string };
  cloudflare:
    | { loggedIn: true; source: 'token' | 'wrangler'; accountId: string | null; accountName: string | null }
    | { loggedIn: false; hint: string };
  defaultBackend: Backend;
  /** ssh client available (needed for expose --ssh) */
  ssh: boolean;
  deploys: { name: string; backend: Backend; status: string; url: string | null }[];
}

export async function doctor(): Promise<DoctorReport> {
  const cfg = readConfig();
  const bin = findCloudflared(cfg);
  const creds = credentials(cfg);
  return {
    version: VERSION,
    node: process.version,
    home: HOME,
    cloudflared: bin
      ? { path: bin, version: cloudflaredVersion(bin) }
      : { missing: true, hint: 'downloaded automatically on the first deploy (or run `cloudfact setup`)' },
    cloudflare: creds
      ? { loggedIn: true, source: creds.source, accountId: creds.accountId, accountName: cfg.cloudflareAccountName ?? null }
      : { loggedIn: false, hint: 'run `cloudfact login --device` (browser) or `cloudfact login --token <token>`' },
    defaultBackend: creds ? 'workers' : 'tunnel',
    ssh: hasSsh(),
    deploys: listDeploys().map((s) => ({ name: s.name, backend: s.backend, status: s.status, url: s.url ?? null })),
  };
}
