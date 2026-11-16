import fs from 'node:fs';
import path from 'node:path';
import { DEPLOYS_DIR } from '../config.js';
import type { DeployState, DeploySummary } from '../types.js';

const LIVE = new Set(['running', 'starting', 'reconnecting']);

export function slug(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'site'
  );
}

/** Bytes of the regular files under `p` (or of `p` itself), skipping symlinks. null when it does not exist. */
export function pathBytes(p: string | null | undefined): number | null {
  if (!p) return null;
  let st: fs.Stats;
  try {
    st = fs.lstatSync(p);
  } catch {
    return null;
  }
  if (st.isFile()) return st.size;
  if (!st.isDirectory()) return null;
  let total = 0;
  for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    total += pathBytes(path.join(p, entry.name)) ?? 0;
  }
  return total;
}

export function deployDir(name: string): string {
  return path.join(DEPLOYS_DIR, name);
}

export function readState(name: string): DeployState | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(deployDir(name), 'state.json'), 'utf8')) as DeployState;
  } catch {
    return null;
  }
}

/** Atomic write (tmp + rename) so the host process and the CLI never clobber each other. */
export function writeState(name: string, state: DeployState): void {
  const dir = deployDir(name);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.state.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, path.join(dir, 'state.json'));
}

export function patchState(name: string, patch: Partial<DeployState>): DeployState {
  const current = readState(name);
  if (!current) throw new Error(`deploy "${name}" does not exist`);
  const next = { ...current, ...patch };
  writeState(name, next);
  return next;
}

export function alive(pid: number | null | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Effective state: reports "dead" when the tunnel host died without updating the file. */
export function effectiveState(name: string): DeployState | null {
  const s = readState(name);
  if (!s) return null;
  const justStarted = s.status === 'starting' && Date.now() - Date.parse(s.startedAt) < 10_000;
  if (s.backend === 'tunnel' && LIVE.has(s.status) && !alive(s.hostPid) && !justStarted) {
    return { ...s, status: 'dead', url: null, privateUrl: null };
  }
  return s;
}

export function isLive(state: DeployState | null): state is DeployState {
  return Boolean(state && LIVE.has(state.status));
}

export function listDeploys(opts: { includeInternal?: boolean } = {}): DeployState[] {
  if (!fs.existsSync(DEPLOYS_DIR)) return [];
  return fs
    .readdirSync(DEPLOYS_DIR)
    .map(effectiveState)
    .filter((s): s is DeployState => s !== null && (!s.internal || opts.includeInternal === true))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function summarize(state: DeployState): DeploySummary {
  const { key: _key, controlKey: _controlKey, sessionSecret: _sessionSecret, ...rest } = state;
  return rest;
}

export function readLogs(name: string, lines = 40): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of ['host.log', 'tunnel.log', 'wrangler.log']) {
    const p = path.join(deployDir(name), file);
    if (fs.existsSync(p)) out[file] = fs.readFileSync(p, 'utf8').trim().split('\n').slice(-lines).join('\n');
  }
  return out;
}

export function removeDeployDir(name: string): void {
  fs.rmSync(deployDir(name), { recursive: true, force: true });
}
