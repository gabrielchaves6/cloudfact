// Núcleo do cloudfact: estado em disco, deploy (túnel rápido ou Cloudflare Pages), stop, status, doctor.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const HOME = process.env.CLOUDFACT_HOME || path.join(os.homedir(), '.cloudfact');
export const DEPLOYS = path.join(HOME, 'deploys');
export const CONFIG = path.join(HOME, 'config.json');
export const HOST_SCRIPT = path.join(__dirname, 'host.js');
export const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { return {}; }
}
export function writeConfig(cfg) {
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
}

export function findCloudflared(cfg = readConfig()) {
  const candidates = [cfg.cloudflaredPath, process.env.CLOUDFLARED, path.join(HOME, 'bin', 'cloudflared'), 'cloudflared',
    path.join(os.homedir(), '.local/bin/cloudflared'), '/usr/local/bin/cloudflared', '/usr/bin/cloudflared'].filter(Boolean);
  for (const c of candidates) {
    if (c.includes('/')) { if (fs.existsSync(c)) return c; continue; }
    const r = spawnSync('sh', ['-c', `command -v ${c}`], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return null;
}

export const WRANGLER_CONFIG = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), '.wrangler', 'config', 'default.toml');

/** Credenciais do Pages: token de API (env/config) ou login OAuth do wrangler (`wrangler login`). */
export function pagesCredentials(cfg = readConfig()) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || cfg.cloudflareAccountId || null;
  const token = process.env.CLOUDFLARE_API_TOKEN || cfg.cloudflareApiToken;
  if (token) return { source: 'token', token, accountId };
  try {
    if (/oauth_token\s*=\s*"[^"]+"/.test(fs.readFileSync(WRANGLER_CONFIG, 'utf8'))) return { source: 'wrangler', token: null, accountId };
  } catch {}
  return null;
}

export function slug(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'site';
}

export function deployDir(name) { return path.join(DEPLOYS, name); }
export function readState(name) {
  try { return JSON.parse(fs.readFileSync(path.join(deployDir(name), 'state.json'), 'utf8')); } catch { return null; }
}
export function writeState(name, state) {
  const d = deployDir(name);
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  const tmp = path.join(d, `.state.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, path.join(d, 'state.json'));
}
export function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Estado "efetivo": corrige status se o processo host morreu. */
export function effectiveState(name) {
  const s = readState(name);
  if (!s) return null;
  const justStarted = s.status === 'starting' && Date.now() - Date.parse(s.startedAt || 0) < 10_000;
  if (s.backend === 'tunnel' && ['running', 'starting', 'reconnecting'].includes(s.status) && !alive(s.hostPid) && !justStarted) {
    return { ...s, status: 'dead', url: null, privateUrl: null };
  }
  return s;
}

export function listDeploys() {
  if (!fs.existsSync(DEPLOYS)) return [];
  return fs.readdirSync(DEPLOYS).map(effectiveState).filter(Boolean)
    .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
}

export function logs(name, lines = 40) {
  const d = deployDir(name);
  const out = {};
  for (const f of ['host.log', 'tunnel.log', 'wrangler.log']) {
    const p = path.join(d, f);
    if (fs.existsSync(p)) out[f] = fs.readFileSync(p, 'utf8').trim().split('\n').slice(-lines).join('\n');
  }
  return out;
}

function resolveTarget(target) {
  const abs = path.resolve(target || '.');
  let st;
  try { st = fs.statSync(abs); } catch { throw new Error(`caminho não existe: ${abs}`); }
  if (st.isDirectory()) return { mode: 'dir', root: abs, defaultName: path.basename(abs) };
  return { mode: 'file', file: abs, defaultName: path.basename(abs, path.extname(abs)) };
}

function summarize(s) {
  if (!s) return null;
  const { key, ...rest } = s; // nunca devolve a chave crua; privateUrl já a contém
  return rest;
}

/**
 * @param {{path?:string, name?:string, private?:boolean, backend?:'auto'|'tunnel'|'pages', restart?:boolean, timeoutMs?:number}} opts
 */
export async function deploy(opts = {}) {
  const t = resolveTarget(opts.path);
  const name = slug(opts.name || t.defaultName);
  const cfg = readConfig();
  let backend = opts.backend || 'auto';
  if (backend === 'auto') backend = pagesCredentials(cfg) ? 'workers' : 'tunnel';
  if (backend === 'pages') backend = 'workers'; // alias antigo
  if (backend === 'workers') return deployWorkers({ ...t, name, cfg, opts });
  if (backend !== 'tunnel') throw new Error(`backend desconhecido: ${backend}`);
  return deployTunnel({ ...t, name, cfg, opts });
}

async function deployTunnel({ mode, root, file, name, cfg, opts }) {
  const existing = effectiveState(name);
  const sameTarget = existing && existing.mode === mode && (existing.root ?? null) === (root ?? null)
    && (existing.file ?? null) === (file ?? null) && Boolean(existing.key) === Boolean(opts.private);
  if (existing && existing.backend === 'tunnel' && ['running', 'starting', 'reconnecting'].includes(existing.status)) {
    if (sameTarget && !opts.restart) {
      const s = await waitForUrl(name, opts.timeoutMs);
      return { ...summarize(s), reused: true };
    }
    await stop(name);
  }
  if (!findCloudflared(cfg)) {
    const { installCloudflared } = await import('./setup.js');
    await installCloudflared({ log: (m) => process.stderr.write(m + '\n') });
  }

  const key = opts.private ? crypto.randomBytes(32).toString('base64url') : null;
  const state = {
    name, backend: 'tunnel', mode, root: root || null, file: file || null, key,
    status: 'starting', url: null, privateUrl: null, hostPid: null, tunnelPid: null, port: null,
    startedAt: new Date().toISOString(), restarts: 0,
  };
  writeState(name, state);
  const d = deployDir(name);
  const out = fs.openSync(path.join(d, 'host.log'), 'a');
  const child = spawn(process.execPath, [HOST_SCRIPT, name], { detached: true, stdio: ['ignore', out, out], env: { ...process.env, CLOUDFACT_HOME: HOME } });
  child.unref();
  fs.closeSync(out);
  writeState(name, { ...readState(name), hostPid: child.pid });
  const s = await waitForUrl(name, opts.timeoutMs);
  return { ...summarize(s), reused: false };
}

async function waitForUrl(name, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = effectiveState(name);
    if (s?.status === 'running' && s.url) return s;
    if (s?.status === 'error' || s?.status === 'dead') {
      throw new Error(`deploy "${name}" falhou (${s.status}${s.error ? ': ' + s.error : ''}). Logs:\n${JSON.stringify(logs(name, 15), null, 2)}`);
    }
    await sleep(400);
  }
  throw new Error(`tempo esgotado esperando a URL do túnel "${name}". Logs:\n${JSON.stringify(logs(name, 15), null, 2)}`);
}

function run(cmd, args, { env, cwd, logFile } = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', env, cwd, maxBuffer: 16 * 1024 * 1024 });
  const text = (r.stdout || '') + (r.stderr || '');
  if (logFile) fs.appendFileSync(logFile, `\n$ ${cmd} ${args.join(' ')}\n${text}`);
  return { status: r.status, text, error: r.error };
}

/** Copia `src` para `dst` ignorando dotfiles, node_modules e symlinks. Devolve o número de arquivos. */
function stageDir(src, dst) {
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });
  let n = 0;
  const walk = (from, to) => {
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.isSymbolicLink()) continue;
      const a = path.join(from, e.name), b = path.join(to, e.name);
      if (e.isDirectory()) { fs.mkdirSync(b); walk(a, b); }
      else if (e.isFile()) { fs.copyFileSync(a, b); n += 1; }
    }
  };
  walk(src, dst);
  return n;
}

function wranglerCmd(cfg) {
  return cfg.wranglerCommand ? cfg.wranglerCommand.split(' ') : ['npx', '--yes', 'wrangler@4'];
}
function wranglerEnv(creds) {
  const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
  if (creds?.token) env.CLOUDFLARE_API_TOKEN = creds.token;
  if (creds?.accountId) env.CLOUDFLARE_ACCOUNT_ID = creds.accountId;
  return env;
}

/** Backend "workers": Cloudflare Workers com assets estáticos (sucessor do Pages). URL fixa https://<nome>.<sub>.workers.dev */
async function deployWorkers({ mode, root, file, name, cfg, opts }) {
  const creds = pagesCredentials(cfg);
  if (!creds) throw new Error('backend "workers" exige login na Cloudflare: `cloudfact login --device` (navegador) ou `cloudfact login --token <token>`. Ou use --backend tunnel.');
  if (opts.private) throw new Error('--private só existe no backend tunnel por enquanto; no Workers a URL é pública.');
  const d = deployDir(name);
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  const logFile = path.join(d, 'wrangler.log');
  const site = path.join(d, 'site');
  let files;
  if (mode === 'file') {
    fs.rmSync(site, { recursive: true, force: true });
    fs.mkdirSync(site, { recursive: true });
    fs.copyFileSync(file, path.join(site, 'index.html'));
    files = 1;
  } else {
    files = stageDir(root, site);
    if (!files) throw new Error(`pasta sem arquivos publicáveis: ${root}`);
  }
  const prev = readState(name) || {};
  writeState(name, { ...prev, name, backend: 'workers', mode, root: root || null, file: file || null, status: 'deploying', startedAt: prev.startedAt || new Date().toISOString(), files });
  const w = wranglerCmd(cfg);
  const cwd = path.join(d, 'empty'); fs.mkdirSync(cwd, { recursive: true }); // cwd neutro: sem autodetecção de projeto
  const r = run(w[0], [...w.slice(1), 'deploy', '--name', name, '--assets', site, '--compatibility-date', new Date().toISOString().slice(0, 10)], { env: wranglerEnv(creds), cwd, logFile });
  const clean = r.text.replace(/\x1b\[[0-9;]*m/g, '');
  if (r.status !== 0) {
    writeState(name, { ...readState(name), status: 'error', error: clean.slice(-1500) });
    throw new Error(`wrangler deploy falhou:\n${clean.slice(-1500)}`);
  }
  const url = (clean.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/g) || []).find((u) => u.includes(`//${name}.`)) || null;
  const version = (clean.match(/Version ID:\s*([0-9a-f-]+)/) || [])[1] || null;
  const s = { ...readState(name), status: 'deployed', url, versionId: version, deployedAt: new Date().toISOString(), error: null };
  writeState(name, s);
  return { ...summarize(s), reused: false };
}

export async function stop(name) {
  const s = readState(name);
  if (!s) throw new Error(`deploy "${name}" não existe`);
  if (s.backend === 'workers') return { name, backend: 'workers', note: 'Workers não tem processo local; `remove` apaga o worker na Cloudflare.' };
  for (const pid of [s.hostPid, s.tunnelPid]) if (alive(pid)) { try { process.kill(pid, 'SIGTERM'); } catch {} }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && (alive(s.hostPid) || alive(s.tunnelPid))) await sleep(150);
  for (const pid of [s.hostPid, s.tunnelPid]) if (alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  writeState(name, { ...readState(name), status: 'stopped', url: null, privateUrl: null, hostPid: null, tunnelPid: null, stoppedAt: new Date().toISOString() });
  return { name, stopped: true };
}

export async function stopAll() {
  const out = [];
  for (const s of listDeploys()) if (s.backend === 'tunnel' && s.status !== 'stopped') out.push(await stop(s.name));
  return out;
}

export async function remove(name) {
  const s = readState(name);
  if (!s) throw new Error(`deploy "${name}" não existe`);
  if (s.backend === 'tunnel') await stop(name);
  let remote;
  if (s.backend === 'workers' && s.status === 'deployed') {
    const cfg = readConfig();
    const w = wranglerCmd(cfg);
    const r = run(w[0], [...w.slice(1), 'delete', '--name', name, '--force'], { env: wranglerEnv(pagesCredentials(cfg)), cwd: path.join(deployDir(name), 'empty') });
    remote = r.status === 0 ? 'worker apagado' : `falha ao apagar worker: ${r.text.replace(/\x1b\[[0-9;]*m/g, '').slice(-400)}`;
  }
  fs.rmSync(deployDir(name), { recursive: true, force: true });
  return { name, removed: true, remote };
}

export async function status(name, { check = true } = {}) {
  const s = effectiveState(name);
  if (!s) throw new Error(`deploy "${name}" não existe`);
  const out = summarize(s);
  if (check && s.url) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(s.url, { method: 'HEAD', signal: ctrl.signal, redirect: 'manual' });
      clearTimeout(t);
      out.reachable = r.status < 500;
      out.httpStatus = r.status;
    } catch (e) { out.reachable = false; out.checkError = String(e.cause?.message || e.message); }
  }
  return out;
}

export async function doctor() {
  const cfg = readConfig();
  const cf = findCloudflared(cfg);
  let cfVersion = null;
  if (cf) { const r = spawnSync(cf, ['--version'], { encoding: 'utf8' }); cfVersion = (r.stdout || r.stderr || '').trim(); }
  const creds = pagesCredentials(cfg);
  const deploys = listDeploys();
  return {
    version: VERSION, node: process.version, home: HOME,
    cloudflared: cf ? { path: cf, version: cfVersion } : { missing: true, hint: 'será baixado automaticamente no primeiro deploy (ou rode `cloudfact setup`)' },
    workers: creds ? { configured: true, source: creds.source, accountId: creds.accountId || null, accountName: cfg.cloudflareAccountName || null } : { configured: false, hint: 'rode `cloudfact login --device` (autoriza no navegador) ou `cloudfact login --token <token>`' },
    defaultBackend: creds ? 'workers' : 'tunnel',
    deploys: deploys.map((s) => ({ name: s.name, backend: s.backend, status: s.status, url: s.url })),
  };
}
