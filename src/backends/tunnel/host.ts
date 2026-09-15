/**
 * Detached process that keeps a tunnel deploy alive: a local server on 127.0.0.1:<free port>
 * (static files, or a reverse proxy to an app for `expose`) + `cloudflared tunnel` pointing at it.
 * Restarts cloudflared (and the SSH forward, when used) if they drop. Internal use: node host.js <name>.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { readConfig } from '../../config.js';
import { log } from '../../logger.js';
import { findCloudflared } from '../../services/cloudflared.js';
import { deployDir, patchState, readState } from '../../services/state.js';
import { refreshAccessProxyOrigin } from '../workers/index.js';
import { createGate } from './gate.js';
import { createProxy } from './proxy.js';
import { createStaticHandler } from './static-server.js';

const TUNNEL_URL = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/;

const name = process.argv[2];
if (!name) {
  log.ts('usage: host.js <name>');
  process.exit(2);
}
const loaded = readState(name);
if (!loaded) {
  log.ts('no state.json for', name);
  process.exit(2);
}
const initial = loaded;
const dir = deployDir(name);
let stopping = false;
let tunnel: ChildProcess | null = null;
let ssh: ChildProcess | null = null;
let restarts = 0;
let sshRestarts = 0;

/** Key info re-read from state.json (cached for 1s) so `rotate` and expiry apply without a restart. */
let keyCache: { at: number; key: string | null; expiresAt: string | null } = { at: 0, key: null, expiresAt: null };
const gate = createGate({
  getKey: () => {
    if (Date.now() - keyCache.at > 1000) {
      const s = readState(name);
      keyCache = { at: Date.now(), key: s?.key ?? null, expiresAt: s?.keyExpiresAt ?? null };
    }
    return keyCache;
  },
  log: (m) => log.ts(m),
});

async function main(): Promise<void> {
  let server: http.Server;
  if (initial.mode === 'proxy') {
    let targetPort = initial.targetPort!;
    if (initial.ssh) {
      targetPort = await freePort();
      patchState(name, { forwardPort: targetPort });
      startSshForward(targetPort);
    }
    const proxy = createProxy({ targetPort, gate });
    server = http.createServer(proxy.handler);
    server.on('upgrade', proxy.upgrade);
  } else {
    server = http.createServer(createStaticHandler({ mode: initial.mode, root: initial.root, file: initial.file, gate }));
  }
  server.keepAliveTimeout = 65_000;
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    patchState(name, { hostPid: process.pid, port, status: 'starting', local: `http://127.0.0.1:${port}` });
    log.ts('local server on port', port);
    startTunnel(port);
  });
  process.on('SIGTERM', () => shutdown(server));
  process.on('SIGINT', () => shutdown(server));
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
    probe.on('error', reject);
  });
}

/** `ssh -N -L` to the remote app; restarted with backoff if the connection drops. */
function startSshForward(localPort: number): void {
  if (stopping || !initial.ssh) return;
  const { destination, port, identity, strictHostKey } = initial.ssh;
  const args = [
    '-N',
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    'ServerAliveInterval=30',
    '-o',
    'ServerAliveCountMax=3',
    '-o',
    'BatchMode=yes',
    '-o',
    `StrictHostKeyChecking=${strictHostKey ? 'yes' : 'accept-new'}`,
    '-L',
    `127.0.0.1:${localPort}:127.0.0.1:${initial.targetPort}`,
  ];
  if (port) args.push('-p', String(port));
  if (identity) args.push('-i', identity);
  args.push(destination);
  const logFd = fs.openSync(path.join(dir, 'ssh.log'), 'a');
  ssh = spawn('ssh', args, { stdio: ['ignore', logFd, logFd], windowsHide: true });
  fs.closeSync(logFd);
  patchState(name, { sshPid: ssh.pid ?? null });
  log.ts(`ssh forward 127.0.0.1:${localPort} → ${destination}:${initial.targetPort}`);
  ssh.on('exit', (code, signal) => {
    ssh = null;
    if (stopping) return;
    sshRestarts += 1;
    const delay = Math.min(30_000, 2_000 * sshRestarts);
    log.ts(`ssh exited (code=${code} sig=${signal}); reconnecting in ${delay / 1000}s`);
    patchState(name, { sshPid: null, error: `ssh forward down (exit ${code}); reconnecting` });
    setTimeout(() => startSshForward(localPort), delay);
  });
}

function startTunnel(port: number): void {
  if (stopping) return;
  const bin = findCloudflared(readConfig());
  if (!bin) {
    patchState(name, { status: 'error', error: 'cloudflared not found' });
    return;
  }
  const logFd = fs.openSync(path.join(dir, 'tunnel.log'), 'a');
  tunnel = spawn(bin, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate', '--protocol', 'http2'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const proxiedDeploy = Boolean(readState(name)?.access);
  patchState(name, {
    tunnelPid: tunnel.pid ?? null,
    ...(proxiedDeploy ? { tunnelUrl: null } : { url: null, privateUrl: null }),
    status: 'starting',
  });
  let found = false;
  const scan = (chunk: Buffer) => {
    fs.writeSync(logFd, chunk);
    if (found) return;
    const match = chunk.toString().match(TUNNEL_URL);
    if (!match) return;
    found = true;
    const url = match[0];
    const st = readState(name);
    // Behind an Access proxy the public URL is the Worker's; the tunnel hostname stays internal.
    const proxied = Boolean(st?.access);
    patchState(name, {
      tunnelUrl: url,
      url: proxied ? (st?.url ?? null) : url,
      privateUrl: proxied ? null : st?.key ? `${url}/#key=${st.key}` : null,
      status: 'running',
      error: null,
      urlAt: new Date().toISOString(),
    });
    log.ts('tunnel ready:', url);
    if (proxied) {
      try {
        refreshAccessProxyOrigin(name, url);
        log.ts('access proxy origin updated to', url);
      } catch (e) {
        log.ts('could not update the access proxy origin:', String(e));
        patchState(name, { error: `access proxy origin not updated: ${String(e)}` });
      }
    }
  };
  tunnel.stdout?.on('data', scan);
  tunnel.stderr?.on('data', scan);
  tunnel.on('exit', (code, signal) => {
    fs.closeSync(logFd);
    tunnel = null;
    if (stopping) return;
    restarts += 1;
    const delay = Math.min(30_000, 2_000 * restarts);
    log.ts(`cloudflared exited (code=${code} sig=${signal}); restarting in ${delay / 1000}s`);
    patchState(name, {
      status: 'reconnecting',
      ...(proxiedDeploy ? { tunnelUrl: null } : { url: null, privateUrl: null }),
      tunnelPid: null,
      restarts,
    });
    setTimeout(() => startTunnel(port), delay);
  });
}

function shutdown(server: http.Server): void {
  if (stopping) return;
  stopping = true;
  log.ts('shutting down');
  patchState(name, {
    status: 'stopped',
    url: null,
    privateUrl: null,
    hostPid: null,
    tunnelPid: null,
    sshPid: null,
    stoppedAt: new Date().toISOString(),
  });
  tunnel?.kill('SIGTERM');
  ssh?.kill('SIGTERM');
  server.close();
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('uncaughtException', (err) => {
  log.ts('error', err);
  patchState(name, { status: 'error', error: String(err) });
});

void main();
