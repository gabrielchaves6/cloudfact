// Processo destacado que mantém um deploy vivo: servidor estático local + cloudflared quick tunnel.
// Uso interno: node host.js <nome>. Estado em ~/.cloudfact/deploys/<nome>/state.json.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHandler } from './static.js';
import { readState, writeState, deployDir, readConfig, findCloudflared } from './lib.js';

const name = process.argv[2];
if (!name) { console.error('uso: host.js <nome>'); process.exit(2); }
const dir = deployDir(name);
let state = readState(name);
if (!state) { console.error('sem state.json'); process.exit(2); }

const log = (...a) => console.error(new Date().toISOString(), ...a);
const patch = (p) => { state = { ...readState(name), ...p }; writeState(name, state); };
const TUNNEL_RE = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/g;

let stopping = false;
let tunnel = null;
let restarts = 0;

const handler = createHandler({ mode: state.mode, root: state.root, file: state.file, key: state.key });
const server = http.createServer(handler);
server.keepAliveTimeout = 65_000;
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  patch({ hostPid: process.pid, port, status: 'starting', local: `http://127.0.0.1:${port}` });
  log('servidor local na porta', port);
  startTunnel(port);
});

function startTunnel(port) {
  if (stopping) return;
  const bin = findCloudflared(readConfig());
  if (!bin) { patch({ status: 'error', error: 'cloudflared não encontrado' }); return; }
  const out = fs.openSync(path.join(dir, 'tunnel.log'), 'a');
  tunnel = spawn(bin, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate', '--protocol', 'http2'], { stdio: ['ignore', 'pipe', 'pipe'] });
  patch({ tunnelPid: tunnel.pid, url: null, status: 'starting' });
  let found = false;
  const scan = (chunk) => {
    fs.writeSync(out, chunk);
    if (found) return;
    const m = String(chunk).match(TUNNEL_RE);
    if (m) {
      found = true;
      const url = m[0];
      const key = state.key;
      patch({ url, privateUrl: key ? `${url}/#key=${key}` : null, status: 'running', error: null, urlAt: new Date().toISOString() });
      log('túnel pronto:', url);
    }
  };
  tunnel.stdout.on('data', scan);
  tunnel.stderr.on('data', scan);
  tunnel.on('exit', (code, sig) => {
    fs.closeSync(out);
    tunnel = null;
    if (stopping) return;
    restarts += 1;
    const delay = Math.min(30_000, 2_000 * restarts);
    log(`cloudflared saiu (code=${code} sig=${sig}); religando em ${delay / 1000}s`);
    patch({ status: 'reconnecting', url: null, privateUrl: null, tunnelPid: null, restarts });
    setTimeout(() => startTunnel(port), delay);
  });
}

function shutdown() {
  if (stopping) return;
  stopping = true;
  log('encerrando');
  patch({ status: 'stopped', url: null, privateUrl: null, hostPid: null, tunnelPid: null, stoppedAt: new Date().toISOString() });
  if (tunnel) { try { tunnel.kill('SIGTERM'); } catch {} }
  server.close();
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('uncaughtException', (e) => { log('erro', e); patch({ status: 'error', error: String(e) }); });
