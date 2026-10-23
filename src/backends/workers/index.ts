/** "workers" backend: Cloudflare Workers with static assets (the successor of Pages). Fixed *.workers.dev URL. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readConfig } from '../../config.js';
import { deployDir, readState, summarize, writeState } from '../../services/state.js';
import { credentials, runWrangler } from '../../services/wrangler.js';
import { WORKER_SOURCE, wranglerConfig } from './gate-worker.js';
import { PROXY_WORKER_SOURCE, proxyWranglerConfig } from './proxy-worker.js';
import { accessContext, accessVars, deleteAccessApp, upsertAccessApp, workersSubdomain, type AccessApp } from '../../services/access.js';
import { tagWorker } from '../../services/catalog.js';
import type { ControlTargets, DeployMode, DeployResult } from '../../types.js';

export interface WorkersTarget {
  name: string;
  mode: DeployMode;
  root: string | null;
  file: string | null;
  private: boolean;
  key?: string | null;
  keyExpiresAt?: string | null;
  /** Emails allowed through Cloudflare Access; when set, identity replaces the key gate. */
  access?: string[] | null;
  /** Project this deploy belongs to in the account catalog. */
  project?: string | null;
  /**
   * The catalog page's on/off switch (Access mode only): the Worker receives the API token and the list
   * of deploys it may switch, as secrets. Without it, a switch left by an earlier publish is removed.
   */
  control?: { accountId: string; token: string; targets: ControlTargets } | null;
}

/** Secrets that make up the switch; dropped again when a catalog is republished without it. */
const CONTROL_SECRETS = ['CLOUDFACT_API_TOKEN', 'CLOUDFACT_CONTROL_TARGETS'];

/**
 * The key behind the site's own sign-in cookie: made once per deploy and kept in its state, so a redeploy
 * (the catalog republishes itself on every deploy) does not sign anyone out. A new key signs everyone out.
 */
function sessionSecret(name: string): string {
  const s = readState(name);
  if (s?.sessionSecret) return s.sessionSecret;
  const secret = crypto.randomBytes(32).toString('base64url');
  if (s) writeState(name, { ...s, sessionSecret: secret });
  return secret;
}

/** `wrangler deploy` with secrets shipped in the same version; on disk only for the length of the deploy. */
function deployWithSecrets(args: string[], values: Record<string, string>, opts: Parameters<typeof runWrangler>[1] & { cwd: string }) {
  const file = path.join(opts.cwd, '.deploy-secrets.json');
  fs.writeFileSync(file, JSON.stringify(values), { mode: 0o600 });
  try {
    return runWrangler([...args, '--secrets-file', file], opts);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/** Copies `src` into `dst` skipping dotfiles, node_modules and symlinks. Returns the file count. */
export function stageDir(src: string, dst: string): number {
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });
  let count = 0;
  const walk = (from: string, to: string) => {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
      const a = path.join(from, entry.name);
      const b = path.join(to, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(b);
        walk(a, b);
      } else if (entry.isFile()) {
        fs.copyFileSync(a, b);
        count += 1;
      }
    }
  };
  walk(src, dst);
  return count;
}

export async function deployWorkers(t: WorkersTarget): Promise<DeployResult> {
  const cfg = readConfig();
  const creds = credentials(cfg);
  if (!creds) {
    throw new Error(
      'the "workers" backend requires a Cloudflare sign-in: `cloudfact login --device` (browser) or `cloudfact login --token <token>`. Or use --backend tunnel.',
    );
  }

  const dir = deployDir(t.name);
  const site = path.join(dir, 'site');
  const cwd = path.join(dir, 'empty'); // neutral cwd: wrangler must not auto-detect any project
  fs.mkdirSync(cwd, { recursive: true, mode: 0o700 });
  let files: number;
  if (t.mode === 'file') {
    fs.rmSync(site, { recursive: true, force: true });
    fs.mkdirSync(site, { recursive: true });
    fs.copyFileSync(t.file!, path.join(site, 'index.html'));
    files = 1;
  } else {
    files = stageDir(t.root!, site);
    if (!files) throw new Error(`no publishable files in ${t.root}`);
  }

  const prev = readState(t.name);
  writeState(t.name, {
    ...prev,
    name: t.name,
    backend: 'workers',
    mode: t.mode,
    root: t.root,
    file: t.file,
    status: 'deploying',
    startedAt: prev?.startedAt ?? new Date().toISOString(),
    files,
  });
  const compatibilityDate = new Date().toISOString().slice(0, 10);
  const logFile = path.join(dir, 'wrangler.log');
  let r;
  let access = null;
  const accessCtx = t.access?.length ? accessContext(cfg) : null; // validates the token before touching anything
  // the switch only ever sits behind Access sign-in, never behind a key link or on an open page
  const control = accessCtx ? (t.control ?? null) : null;
  /** The gate Worker in Access mode: its sign-in key, and the switch's secrets when it has one, ship with this very version. */
  const deployAccessWorker = (app: AccessApp) => {
    const workerDir = path.join(dir, 'worker');
    const args = ['deploy', '--config', path.join(workerDir, 'wrangler.jsonc'), ...accessVars(app)];
    const values: Record<string, string> = { CLOUDFACT_SESSION_SECRET: sessionSecret(t.name) };
    if (control) {
      values.CLOUDFACT_API_TOKEN = control.token;
      values.CLOUDFACT_CONTROL_TARGETS = JSON.stringify(control.targets);
      args.push('--var', 'CLOUDFACT_CONTROL:1', '--var', `CLOUDFACT_ACCOUNT_ID:${control.accountId}`);
    }
    return deployWithSecrets(args, values, { cfg, creds, cwd: workerDir, logFile });
  };
  if (accessCtx) {
    // The Access app (and its AUD) must exist before the Worker goes live: the gate Worker verifies the
    // Access JWT against that AUD. The hostname is predictable from the account's workers.dev subdomain.
    const domain = `${t.name}.${await workersSubdomain(accessCtx)}.workers.dev`;
    access = await upsertAccessApp(accessCtx, { name: t.name, domain, emails: t.access! });
    const workerDir = path.join(dir, 'worker');
    fs.mkdirSync(workerDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(workerDir, 'index.js'), WORKER_SOURCE);
    fs.writeFileSync(path.join(workerDir, 'wrangler.jsonc'), wranglerConfig(t.name, compatibilityDate));
    r = deployAccessWorker(access);
  } else if (t.private) {
    // gate worker in front of the assets (run_worker_first); key delivered as a secret after the deploy
    const workerDir = path.join(dir, 'worker');
    fs.mkdirSync(workerDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(workerDir, 'index.js'), WORKER_SOURCE);
    fs.writeFileSync(path.join(workerDir, 'wrangler.jsonc'), wranglerConfig(t.name, compatibilityDate));
    const vars = t.keyExpiresAt ? ['--var', `CLOUDFACT_KEY_EXPIRES:${t.keyExpiresAt}`] : [];
    r = runWrangler(['deploy', '--config', path.join(workerDir, 'wrangler.jsonc'), ...vars], { cfg, creds, cwd: workerDir, logFile });
    if (r.status === 0) {
      const s = putSecret(t.name, 'CLOUDFACT_KEY', t.key!, { cwd: workerDir, logFile });
      if (s.status !== 0) r = { status: s.status, text: `${r.text}\n${s.text}` };
    }
  } else {
    r = runWrangler(['deploy', '--name', t.name, '--assets', site, '--compatibility-date', compatibilityDate], {
      cfg,
      creds,
      cwd,
      logFile,
    });
  }
  if (r.status !== 0) {
    writeState(t.name, { ...readState(t.name)!, status: 'error', error: r.text.slice(-1500) });
    throw new Error(`wrangler deploy failed:\n${r.text.slice(-1500)}`);
  }
  const url = (r.text.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/g) ?? []).find((u) => u.includes(`//${t.name}.`)) ?? null;
  if (accessCtx && access && url && new URL(url).host !== access.domain) {
    // the subdomain changed under us: protect the real hostname and point the Worker at the new AUD
    access = await upsertAccessApp(accessCtx, { name: t.name, domain: new URL(url).host, emails: t.access! });
    const again = deployAccessWorker(access);
    if (again.status !== 0) {
      writeState(t.name, { ...readState(t.name)!, status: 'error', error: again.text.slice(-1500) });
      throw new Error(`wrangler deploy failed:\n${again.text.slice(-1500)}`);
    }
  }
  // republished without the switch: the API token must not stay behind in the Worker. When that fails,
  // the state keeps saying so, and the next publish tries again.
  let controlLeft = Boolean(control);
  if (!control && prev?.control) {
    const nulls = Object.fromEntries(CONTROL_SECRETS.map((k) => [k, null]));
    controlLeft =
      runWrangler(['secret', 'bulk', '--name', t.name], { cfg, creds, cwd, logFile, input: JSON.stringify(nulls) }).status !== 0;
  }
  // the account catalog is rebuilt from script tags, and a deploy resets them
  try {
    await tagWorker(t.name, {
      project: t.project ?? null,
      visibility: accessCtx ? 'access' : t.private ? 'private' : 'public',
      kind: t.mode === 'proxy' ? 'app' : 'static',
    });
  } catch {
    /* best effort: a deploy must not fail because tagging did */
  }
  const versionId = r.text.match(/Version ID:\s*([0-9a-f-]+)/)?.[1] ?? null;
  const state = {
    ...readState(t.name)!,
    status: 'deployed' as const,
    url,
    key: t.private && !accessCtx ? t.key : null,
    keyExpiresAt: t.private && !accessCtx ? (t.keyExpiresAt ?? null) : null,
    privateUrl: t.private && !accessCtx && url ? `${url}/#key=${t.key}` : null,
    access,
    project: t.project ?? null,
    versionId,
    deployedAt: new Date().toISOString(),
    control: controlLeft,
    error: null,
  };
  writeState(t.name, state);
  return { ...summarize(state), reused: false };
}

/** Uploads a Worker secret non-interactively (value on stdin). */
export function putSecret(name: string, secretName: string, value: string, opts: { cwd: string; logFile?: string }) {
  return runWrangler(['secret', 'put', secretName, '--name', name], { cwd: opts.cwd, logFile: opts.logFile, input: value });
}

/** Rotates the key of a private Workers deploy: new secret, no redeploy. */
export function rotateWorkersKey(name: string, key: string, keyExpiresAt: string | null): void {
  const dir = deployDir(name);
  const workerDir = path.join(dir, 'worker');
  if (!fs.existsSync(path.join(workerDir, 'wrangler.jsonc')))
    throw new Error('this Workers deploy is public; redeploy it without --public to make it private');
  const s = putSecret(name, 'CLOUDFACT_KEY', key, { cwd: workerDir, logFile: path.join(dir, 'wrangler.log') });
  if (s.status !== 0) throw new Error(`wrangler secret put failed:\n${s.text.slice(-800)}`);
  if (keyExpiresAt !== undefined) {
    // expiry is a plain var: needs a redeploy of the same worker to change
    const vars = keyExpiresAt ? ['--var', `CLOUDFACT_KEY_EXPIRES:${keyExpiresAt}`] : [];
    const r = runWrangler(['deploy', '--config', path.join(workerDir, 'wrangler.jsonc'), ...vars], {
      cwd: workerDir,
      logFile: path.join(dir, 'wrangler.log'),
    });
    if (r.status !== 0) throw new Error(`wrangler deploy failed:\n${r.text.slice(-800)}`);
  }
}

/** Deletes the worker (and its Access app, if any) on Cloudflare. Returns a one-line outcome. */
export async function deleteWorker(name: string): Promise<string> {
  const notes: string[] = [];
  const s = readState(name);
  if (s?.access?.appId) {
    try {
      await deleteAccessApp(accessContext(), s.access.appId);
      notes.push('access app deleted');
    } catch (e) {
      notes.push(`failed to delete access app: ${(e as Error).message}`);
    }
  }
  const r = runWrangler(['delete', '--name', name, '--force'], { cwd: path.join(deployDir(name), 'empty') });
  notes.unshift(r.status === 0 ? 'worker deleted' : `failed to delete worker: ${r.text.slice(-400)}`);
  return notes.join('; ');
}

export interface AccessProxyTarget {
  /** Deploy name; also the Worker name and the workers.dev hostname label. */
  name: string;
  /** Tunnel URL the Worker forwards to, e.g. https://xyz.trycloudflare.com */
  origin: string;
  /** Key of the tunnel's own gate, sent as a cookie so the origin accepts the forwarded request. */
  originKey: string | null;
  emails: string[];
}

/**
 * Puts a Cloudflare Access-gated Worker in front of a tunnel origin: `expose --access`.
 * The app keeps serving from this machine; the Worker only adds identity and a fixed URL.
 */
export async function deployAccessProxy(t: AccessProxyTarget): Promise<{ url: string; access: AccessApp }> {
  const cfg = readConfig();
  const creds = credentials(cfg);
  if (!creds) throw new Error('--access needs a Cloudflare sign-in: `cloudfact login --token <token>`');
  const ctx = accessContext(cfg);
  const dir = deployDir(t.name);
  const workerDir = path.join(dir, 'worker');
  fs.mkdirSync(workerDir, { recursive: true, mode: 0o700 });
  const compatibilityDate = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(workerDir, 'index.js'), PROXY_WORKER_SOURCE);
  fs.writeFileSync(path.join(workerDir, 'wrangler.jsonc'), proxyWranglerConfig(t.name, compatibilityDate));
  const logFile = path.join(dir, 'wrangler.log');
  const config = path.join(workerDir, 'wrangler.jsonc');
  const secrets: Record<string, string> = { CLOUDFACT_SESSION_SECRET: sessionSecret(t.name) };
  if (t.originKey) secrets.CLOUDFACT_ORIGIN_KEY = t.originKey;
  const deployOnce = (a: AccessApp) =>
    deployWithSecrets(['deploy', '--config', config, ...accessVars(a), '--var', `CLOUDFACT_ORIGIN:${t.origin}`], secrets, {
      cfg,
      creds,
      cwd: workerDir,
      logFile,
    });
  // The Access app (and its AUD) must exist before the Worker goes live: the Worker verifies against it.
  let access = await upsertAccessApp(ctx, {
    name: t.name,
    domain: `${t.name}.${await workersSubdomain(ctx)}.workers.dev`,
    emails: t.emails,
  });
  let r = deployOnce(access);
  if (r.status !== 0) throw new Error(`wrangler deploy failed:\n${r.text.slice(-1500)}`);
  const url = (r.text.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/g) ?? []).find((u) => u.includes(`//${t.name}.`));
  if (!url) throw new Error(`could not read the Worker URL from wrangler output:\n${r.text.slice(-800)}`);
  if (new URL(url).host !== access.domain) {
    // the subdomain changed under us: protect the real hostname and point the Worker at the new AUD
    access = await upsertAccessApp(ctx, { name: t.name, domain: new URL(url).host, emails: t.emails });
    r = deployOnce(access);
    if (r.status !== 0) throw new Error(`wrangler deploy failed:\n${r.text.slice(-1500)}`);
  }
  return { url, access };
}

/** Points a live Access proxy at a new tunnel URL: cloudflared gets a new hostname on every restart. */
export function refreshAccessProxyOrigin(name: string, origin: string): void {
  const dir = deployDir(name);
  const config = path.join(dir, 'worker', 'wrangler.jsonc');
  const s = readState(name);
  if (!fs.existsSync(config) || !s?.access) return;
  const r = runWrangler(['deploy', '--config', config, ...accessVars(s.access), '--var', `CLOUDFACT_ORIGIN:${origin}`], {
    cwd: path.join(dir, 'worker'),
    logFile: path.join(dir, 'wrangler.log'),
  });
  if (r.status !== 0) throw new Error(`wrangler deploy failed:\n${r.text.slice(-800)}`);
}
