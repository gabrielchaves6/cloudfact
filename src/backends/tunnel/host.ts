/**
 * Processo destacado que mantém um deploy do túnel vivo: servidor estático em 127.0.0.1:<porta livre>
 * + `cloudflared tunnel` apontando para ele. Religa o cloudflared se cair. Uso interno: node host.js <nome>.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { readConfig } from '../../config.js';
import { log } from '../../logger.js';
import { findCloudflared } from '../../services/cloudflared.js';
import { deployDir, patchState, readState } from '../../services/state.js';
import { createStaticHandler } from './static-server.js';

const TUNNEL_URL = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/;

const name = process.argv[2];
if (!name) {
  log.ts('uso: host.js <nome>');
  process.exit(2);
}
const initial = readState(name);
if (!initial) {
  log.ts('sem state.json para', name);
  process.exit(2);
}
const dir = deployDir(name);
let stopping = false;
let tunnel: ChildProcess | null = null;
let restarts = 0;

const server = http.createServer(createStaticHandler({ mode: initial.mode, root: initial.root, file: initial.file, key: initial.key }));
server.keepAliveTimeout = 65_000;
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  patchState(name, { hostPid: process.pid, port, status: 'starting', local: `http://127.0.0.1:${port}` });
  log.ts('servidor local na porta', port);
  startTunnel(port);
});

function startTunnel(port: number): void {
  if (stopping) return;
  const bin = findCloudflared(readConfig());
  if (!bin) {
    patchState(name, { status: 'error', error: 'cloudflared não encontrado' });
    return;
  }
  const logFd = fs.openSync(path.join(dir, 'tunnel.log'), 'a');
  tunnel = spawn(bin, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate', '--protocol', 'http2'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  patchState(name, { tunnelPid: tunnel.pid ?? null, url: null, privateUrl: null, status: 'starting' });
  let found = false;
  const scan = (chunk: Buffer) => {
    fs.writeSync(logFd, chunk);
    if (found) return;
    const match = chunk.toString().match(TUNNEL_URL);
    if (!match) return;
    found = true;
    const url = match[0];
    const key = readState(name)?.key;
    patchState(name, {
      url,
      privateUrl: key ? `${url}/#key=${key}` : null,
      status: 'running',
      error: null,
      urlAt: new Date().toISOString(),
    });
    log.ts('túnel pronto:', url);
  };
  tunnel.stdout?.on('data', scan);
  tunnel.stderr?.on('data', scan);
  tunnel.on('exit', (code, signal) => {
    fs.closeSync(logFd);
    tunnel = null;
    if (stopping) return;
    restarts += 1;
    const delay = Math.min(30_000, 2_000 * restarts);
    log.ts(`cloudflared saiu (code=${code} sig=${signal}); religando em ${delay / 1000}s`);
    patchState(name, { status: 'reconnecting', url: null, privateUrl: null, tunnelPid: null, restarts });
    setTimeout(() => startTunnel(port), delay);
  });
}

function shutdown(): void {
  if (stopping) return;
  stopping = true;
  log.ts('encerrando');
  patchState(name, { status: 'stopped', url: null, privateUrl: null, hostPid: null, tunnelPid: null, stoppedAt: new Date().toISOString() });
  tunnel?.kill('SIGTERM');
  server.close();
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('uncaughtException', (err) => {
  log.ts('erro', err);
  patchState(name, { status: 'error', error: String(err) });
});
