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

export function pagesCredentials(cfg = readConfig()) {
  const token = process.env.CLOUDFLARE_API_TOKEN || cfg.cloudflareApiToken;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || cfg.cloudflareAccountId;
  return token ? { token, accountId } : null;
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
  for (const f of ['host.log', 'tunnel.log', 'pages.log']) {
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
  if (backend === 'auto') backend = pagesCredentials(cfg) ? 'pages' : 'tunnel';
  if (backend === 'pages') return deployPages({ ...t, name, cfg, opts });
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

async function deployPages({ mode, root, file, name, cfg, opts }) {
  const creds = pagesCredentials(cfg);
  if (!creds) throw new Error('backend "pages" exige CLOUDFLARE_API_TOKEN (e CLOUDFLARE_ACCOUNT_ID). Use `cloudfact config set cloudflareApiToken ...` ou o backend "tunnel".');
  const d = deployDir(name);
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  const logFile = path.join(d, 'pages.log');
  let dir = root;
  if (mode === 'file') {
    dir = path.join(d, 'site');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(file, path.join(dir, 'index.html'));
  }
  const env = { ...process.env, CLOUDFLARE_API_TOKEN: creds.token, CI: '1', WRANGLER_SEND_METRICS: 'false' };
  if (creds.accountId) env.CLOUDFLARE_ACCOUNT_ID = creds.accountId;
  const wrangler = cfg.wranglerCommand ? cfg.wranglerCommand.split(' ') : ['npx', '--yes', 'wrangler@4'];
  const w = (args) => run(wrangler[0], [...wrangler.slice(1), ...args], { env, logFile });

  writeState(name, { name, backend: 'pages', mode, root: root || null, file: file || null, status: 'deploying', startedAt: new Date().toISOString(), project: name });
  let r = w(['pages', 'deploy', dir, '--project-name', name, '--branch', 'main', '--commit-dirty=true']);
  if (r.status !== 0 && /project.*not found|does not exist|Create a new project/i.test(r.text)) {
    const c = w(['pages', 'project', 'create', name, '--production-branch', 'main']);
    if (c.status !== 0) throw new Error(`falha ao criar projeto Pages "${name}":\n${c.text.slice(-1500)}`);
    r = w(['pages', 'deploy', dir, '--project-name', name, '--branch', 'main', '--commit-dirty=true']);
  }
  if (r.status !== 0) {
    writeState(name, { ...readState(name), status: 'error', error: r.text.slice(-1500) });
    throw new Error(`wrangler pages deploy falhou:\n${r.text.slice(-1500)}`);
  }
  const urls = r.text.match(/https:\/\/[a-z0-9.-]+\.pages\.dev/g) || [];
  const deploymentUrl = urls[0] || null;
  const url = `https://${name}.pages.dev`;
  const s = { ...readState(name), status: 'deployed', url, deploymentUrl, deployedAt: new Date().toISOString() };
  writeState(name, s);
  return { ...summarize(s), reused: false };
}

export async function stop(name) {
  const s = readState(name);
  if (!s) throw new Error(`deploy "${name}" não existe`);
  if (s.backend === 'pages') return { name, backend: 'pages', note: 'Pages não tem processo local; use `remove` para esquecer o registro (o site continua no Cloudflare).' };
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
  fs.rmSync(deployDir(name), { recursive: true, force: true });
  return { name, removed: true };
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
    pages: creds ? { configured: true, accountId: creds.accountId || null, accountName: cfg.cloudflareAccountName || null } : { configured: false, hint: 'rode `cloudfact login` no terminal (ou defina CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID)' },
    defaultBackend: creds ? 'pages' : 'tunnel',
    deploys: deploys.map((s) => ({ name: s.name, backend: s.backend, status: s.status, url: s.url })),
  };
}
