/** API pública do cloudfact: o que o MCP e o CLI expõem. */
import fs from 'node:fs';
import path from 'node:path';
import { HOME, VERSION, readConfig } from './config.js';
import { deployTunnel, stopTunnel } from './backends/tunnel/index.js';
import { deleteWorker, deployWorkers } from './backends/workers/index.js';
import { cloudflaredVersion, findCloudflared } from './services/cloudflared.js';
import { effectiveState, listDeploys, readState, removeDeployDir, slug, summarize } from './services/state.js';
import { credentials } from './services/wrangler.js';
import type { Backend, DeployMode, DeployOptions, DeployResult, DeploySummary } from './types.js';

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
    throw new Error(`caminho não existe: ${abs}`);
  }
  if (stat.isDirectory()) return { mode: 'dir', root: abs, file: null, defaultName: path.basename(abs) };
  return { mode: 'file', root: null, file: abs, defaultName: path.basename(abs, path.extname(abs)) };
}

export function resolveBackend(choice: DeployOptions['backend']): Backend {
  const c = choice ?? 'auto';
  if (c === 'pages') return 'workers'; // alias antigo
  if (c === 'auto') return credentials() ? 'workers' : 'tunnel';
  if (c === 'tunnel' || c === 'workers') return c;
  throw new Error(`backend desconhecido: ${String(c)}`);
}

export async function deploy(opts: DeployOptions = {}): Promise<DeployResult> {
  const t = resolveTarget(opts.path);
  const name = slug(opts.name ?? t.defaultName);
  const backend = opts.private ? 'tunnel' : resolveBackend(opts.backend);
  const common = { name, mode: t.mode, root: t.root, file: t.file, private: Boolean(opts.private) };
  if (backend === 'workers') return deployWorkers(common);
  return deployTunnel({ ...common, restart: Boolean(opts.restart), timeoutMs: opts.timeoutMs ?? 45_000 });
}

export async function stop(name: string): Promise<{ name: string; stopped: boolean; note?: string }> {
  const s = readState(name);
  if (!s) throw new Error(`deploy "${name}" não existe`);
  if (s.backend === 'workers')
    return { name, stopped: false, note: 'Workers não tem processo local; `remove` apaga o worker na Cloudflare.' };
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
  if (!s) throw new Error(`deploy "${name}" não existe`);
  let remote: string | undefined;
  if (s.backend === 'tunnel') await stopTunnel(name);
  if (s.backend === 'workers' && s.status === 'deployed') remote = deleteWorker(name);
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
  if (!s) throw new Error(`deploy "${name}" não existe`);
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
      : { missing: true, hint: 'será baixado automaticamente no primeiro deploy (ou rode `cloudfact setup`)' },
    cloudflare: creds
      ? { loggedIn: true, source: creds.source, accountId: creds.accountId, accountName: cfg.cloudflareAccountName ?? null }
      : { loggedIn: false, hint: 'rode `cloudfact login --device` (navegador) ou `cloudfact login --token <token>`' },
    defaultBackend: creds ? 'workers' : 'tunnel',
    deploys: listDeploys().map((s) => ({ name: s.name, backend: s.backend, status: s.status, url: s.url ?? null })),
  };
}
