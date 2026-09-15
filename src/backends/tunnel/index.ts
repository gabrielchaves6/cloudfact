import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { HOME, HOST_SCRIPT, readConfig } from '../../config.js';
import { log } from '../../logger.js';
import { findCloudflared, installCloudflared } from '../../services/cloudflared.js';
import { alive, deployDir, effectiveState, isLive, readLogs, readState, summarize, writeState } from '../../services/state.js';
import type { DeployMode, DeployResult, DeployState, SshTarget } from '../../types.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface TunnelTarget {
  name: string;
  mode: DeployMode;
  root: string | null;
  file: string | null;
  /** proxy mode: port of the app (local, or on the SSH host) */
  targetPort?: number | null;
  ssh?: SshTarget | null;
  private: boolean;
  restart: boolean;
  timeoutMs: number;
}

const sameSsh = (a?: SshTarget | null, b?: SshTarget | null) =>
  (a?.destination ?? null) === (b?.destination ?? null) &&
  (a?.port ?? null) === (b?.port ?? null) &&
  (a?.identity ?? null) === (b?.identity ?? null);

export async function deployTunnel(t: TunnelTarget): Promise<DeployResult> {
  const existing = effectiveState(t.name);
  if (existing?.backend === 'tunnel' && isLive(existing)) {
    const sameTarget =
      existing.mode === t.mode &&
      existing.root === t.root &&
      existing.file === t.file &&
      (existing.targetPort ?? null) === (t.targetPort ?? null) &&
      sameSsh(existing.ssh, t.ssh) &&
      Boolean(existing.key) === t.private;
    if (sameTarget && !t.restart) return { ...summarize(await waitForUrl(t.name, t.timeoutMs)), reused: true };
    await stopTunnel(t.name);
  }
  if (!findCloudflared(readConfig())) await installCloudflared(log.info);

  const state: DeployState = {
    name: t.name,
    backend: 'tunnel',
    mode: t.mode,
    root: t.root,
    file: t.file,
    targetPort: t.targetPort ?? null,
    ssh: t.ssh ?? null,
    key: t.private ? crypto.randomBytes(32).toString('base64url') : null,
    status: 'starting',
    url: null,
    privateUrl: null,
    hostPid: null,
    tunnelPid: null,
    port: null,
    startedAt: new Date().toISOString(),
    restarts: 0,
  };
  writeState(t.name, state);
  const logFd = fs.openSync(path.join(deployDir(t.name), 'host.log'), 'a');
  const child = spawn(process.execPath, [HOST_SCRIPT, t.name], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, CLOUDFACT_HOME: HOME },
  });
  child.unref();
  fs.closeSync(logFd);
  writeState(t.name, { ...state, hostPid: child.pid ?? null });
  return { ...summarize(await waitForUrl(t.name, t.timeoutMs)), reused: false };
}

async function waitForUrl(name: string, timeoutMs: number): Promise<DeployState> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = effectiveState(name);
    if (s?.status === 'running' && s.url) return s;
    if (s?.status === 'error' || s?.status === 'dead') {
      throw new Error(
        `deploy "${name}" failed (${s.status}${s.error ? `: ${s.error}` : ''}). Logs:\n${JSON.stringify(readLogs(name, 15), null, 2)}`,
      );
    }
    await sleep(400);
  }
  throw new Error(`timed out waiting for the tunnel URL of "${name}". Logs:\n${JSON.stringify(readLogs(name, 15), null, 2)}`);
}

export async function stopTunnel(name: string): Promise<void> {
  const s = readState(name);
  if (!s) return;
  const pids = [s.hostPid, s.tunnelPid, s.sshPid];
  for (const pid of pids) if (alive(pid)) process.kill(pid!, 'SIGTERM');
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && pids.some(alive)) await sleep(150);
  for (const pid of pids) if (alive(pid)) process.kill(pid!, 'SIGKILL');
  writeState(name, {
    ...(readState(name) ?? s),
    status: 'stopped',
    url: null,
    privateUrl: null,
    hostPid: null,
    tunnelPid: null,
    sshPid: null,
    stoppedAt: new Date().toISOString(),
  });
}
