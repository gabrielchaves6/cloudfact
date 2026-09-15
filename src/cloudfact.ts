/** cloudfact public API: what the MCP server and the CLI expose. */
import fs from 'node:fs';
import path from 'node:path';
import { HOME, VERSION, readConfig } from './config.js';
import { deployTunnel, newKey, stopTunnel } from './backends/tunnel/index.js';
import { deployAccessProxy, rotateWorkersKey } from './backends/workers/index.js';
import { expiryFrom } from './services/duration.js';
import { deleteWorker, deployWorkers } from './backends/workers/index.js';
import { cloudflaredVersion, findCloudflared } from './services/cloudflared.js';
import { effectiveState, isLive, listDeploys, readState, removeDeployDir, slug, summarize, writeState } from './services/state.js';
import { credentials } from './services/wrangler.js';
import { spawnSync } from 'node:child_process';

const hasSsh = (): boolean => spawnSync('sh', ['-c', 'command -v ssh'], { encoding: 'utf8' }).status === 0;
import type { Backend, DeployMode, DeployOptions, DeployResult, DeploySummary, ExposeOptions } from './types.js';

export { listDeploys, readLogs, summarize } from './services/state.js';
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
  if (backend === 'workers') {
    return deployWorkers({
      ...common,
      key: priv ? newKey() : null,
      keyExpiresAt: priv ? expiryFrom(opts.expires) : null,
      access: opts.access ?? null,
    });
  }
  return deployTunnel({
    ...common,
    keyExpiresAt: priv ? expiryFrom(opts.expires) : null,
    restart: Boolean(opts.restart),
    timeoutMs: opts.timeoutMs ?? 45_000,
  });
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
  const result = await deployTunnel({
    name,
    mode: 'proxy',
    root: null,
    file: null,
    targetPort: opts.port,
    ssh,
    private: priv,
    keyExpiresAt: priv ? (access ? null : expiryFrom(opts.expires)) : null,
    restart: Boolean(opts.restart),
    timeoutMs: opts.timeoutMs ?? 45_000,
  });
  if (!access) return result;
  if (!result.url) throw new Error(`the tunnel for "${name}" came up without a URL`);
  const proxy = await deployAccessProxy({ name, origin: result.url, originKey: readState(name)?.key ?? null, emails: access });
  const next = { ...readState(name)!, url: proxy.url, tunnelUrl: result.url, privateUrl: null, access: proxy.access };
  writeState(name, next);
  return { ...summarize(next), reused: result.reused };
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

export async function stop(name: string): Promise<{ name: string; stopped: boolean; note?: string }> {
  const s = readState(name);
  if (!s) throw new Error(`deploy "${name}" does not exist`);
  if (s.backend === 'workers')
    return { name, stopped: false, note: 'Workers deploys have no local process; `remove` deletes the worker on Cloudflare.' };
  await stopTunnel(name);
  return { name, stopped: true };
}

export async function stopAll(): Promise<{ name: string; stopped: boolean }[]> {
  const out = [];
  for (const s of listDeploys()) if (s.backend === 'tunnel' && s.status !== 'stopped') out.push(await stop(s.name));
  return out;
}

export async function remove(name: string): Promise<{ name: string; removed: true; remote?: string }> {
  const s = readState(name);
  if (!s) throw new Error(`deploy "${name}" does not exist`);
  let remote: string | undefined;
  if (s.backend === 'tunnel') await stopTunnel(name);
  if (s.backend === 'workers' && s.status === 'deployed') remote = await deleteWorker(name);
  removeDeployDir(name);
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
