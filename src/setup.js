// Onboarding: baixar cloudflared quando faltar e autenticar (token de API da Cloudflare) para o backend Pages.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { HOME, readConfig, writeConfig } from './lib.js';

export const BIN_DIR = path.join(HOME, 'bin');
const API = 'https://api.cloudflare.com/client/v4';
export const TOKEN_URL = 'https://dash.cloudflare.com/profile/api-tokens';

function cloudflaredAsset() {
  const arch = { x64: 'amd64', arm64: 'arm64', arm: 'arm' }[process.arch];
  if (!arch) throw new Error(`arquitetura sem build do cloudflared: ${process.arch}`);
  if (process.platform === 'linux') return { url: `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}`, tgz: false };
  if (process.platform === 'darwin') return { url: `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${arch}.tgz`, tgz: true };
  throw new Error(`instale o cloudflared manualmente para ${process.platform}: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/`);
}

/** Baixa o cloudflared para ~/.cloudfact/bin e devolve o caminho. */
export async function installCloudflared({ log = () => {} } = {}) {
  const dest = path.join(BIN_DIR, 'cloudflared');
  if (fs.existsSync(dest)) return dest;
  const { url, tgz } = cloudflaredAsset();
  fs.mkdirSync(BIN_DIR, { recursive: true, mode: 0o700 });
  log(`baixando cloudflared: ${url}`);
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`download do cloudflared falhou: HTTP ${r.status}`);
  const tmp = dest + '.part';
  if (!tgz) {
    await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(tmp, { mode: 0o755 }));
  } else {
    // tgz com um único arquivo "cloudflared": descompacta e extrai via tar do sistema.
    const tarPath = tmp + '.tar';
    await pipeline(Readable.fromWeb(r.body), createGunzip(), fs.createWriteStream(tarPath));
    const x = spawnSync('tar', ['-xf', tarPath, '-C', BIN_DIR, 'cloudflared'], { encoding: 'utf8' });
    fs.rmSync(tarPath, { force: true });
    if (x.status !== 0) throw new Error(`tar falhou: ${x.stderr}`);
    fs.renameSync(path.join(BIN_DIR, 'cloudflared'), tmp);
  }
  fs.chmodSync(tmp, 0o755);
  const v = spawnSync(tmp, ['--version'], { encoding: 'utf8' });
  if (v.status !== 0) { fs.rmSync(tmp, { force: true }); throw new Error(`binário baixado não roda: ${v.stderr || v.stdout}`); }
  fs.renameSync(tmp, dest);
  log(`cloudflared instalado em ${dest} (${(v.stdout || '').trim()})`);
  return dest;
}

async function api(pathname, token) {
  const r = await fetch(API + pathname, { headers: { Authorization: `Bearer ${token}` } });
  let body;
  try { body = await r.json(); } catch { body = {}; }
  if (!r.ok || body.success === false) {
    const msg = (body.errors || []).map((e) => e.message).join('; ') || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return body.result;
}

/**
 * Valida um token de API na Cloudflare, descobre a conta e salva em ~/.cloudfact/config.json.
 * Sem token e com TTY, pergunta interativamente.
 */
export async function login({ token, accountId, interactive = process.stdin.isTTY, log = console.error } = {}) {
  if (!token) {
    if (!interactive) throw new Error(`token ausente. Crie um em ${TOKEN_URL} e rode: cloudfact login --token <token>`);
    log(`Crie um token de API em ${TOKEN_URL}\n  → "Create Token" → template "Edit Cloudflare Workers" (ou custom com Account · Cloudflare Pages · Edit)\n`);
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    token = (await rl.question('Cole o token: ')).trim();
    rl.close();
    if (!token) throw new Error('token vazio');
  }
  let verify;
  try { verify = await api('/user/tokens/verify', token); }
  catch (e) { throw new Error(`token inválido: ${e.message}`); }
  if (verify.status !== 'active') throw new Error(`token com status "${verify.status}"`);

  let accounts = [];
  try { accounts = await api('/accounts?per_page=50', token); } catch (e) { log(`aviso: não consegui listar contas (${e.message})`); }
  if (!accountId) {
    if (accounts.length === 1) accountId = accounts[0].id;
    else if (accounts.length > 1) {
      if (!interactive) throw new Error(`token acessa ${accounts.length} contas; passe --account-id. Opções:\n` + accounts.map((a) => `  ${a.id}  ${a.name}`).join('\n'));
      log('Contas disponíveis:'); accounts.forEach((a, i) => log(`  [${i + 1}] ${a.name}  (${a.id})`));
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
      const n = Number((await rl.question('Qual? ')).trim());
      rl.close();
      accountId = accounts[n - 1]?.id;
      if (!accountId) throw new Error('escolha inválida');
    }
  }
  const account = accounts.find((a) => a.id === accountId);
  const cfg = readConfig();
  writeConfig({ ...cfg, cloudflareApiToken: token, cloudflareAccountId: accountId || null, cloudflareAccountName: account?.name || null, loggedInAt: new Date().toISOString() });
  return { ok: true, tokenId: verify.id, accountId: accountId || null, accountName: account?.name || null, config: path.join(HOME, 'config.json') };
}

/**
 * Login OAuth por navegador via `wrangler login --device`: imprime link + código (via onPrompt) e espera a aprovação.
 * Serve para VMs sem browser: o usuário aprova em qualquer dispositivo.
 */
export async function loginDevice({ onPrompt = (t) => process.stderr.write(t), timeoutMs = 6 * 60_000 } = {}) {
  const { spawn } = await import('node:child_process');
  const cfg = readConfig();
  const wrangler = cfg.wranglerCommand ? cfg.wranglerCommand.split(' ') : ['npx', '--yes', 'wrangler@4'];
  const child = spawn(wrangler[0], [...wrangler.slice(1), 'login', '--device', '--browser=false'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' } });
  let out = '';
  let prompted = false;
  const onData = (c) => {
    out += c;
    if (!prompted && /enter the code:\s*\S+/s.test(out)) { prompted = true; onPrompt(out.replace(/^.*?To authorize/s, 'To authorize')); }
  };
  child.stdout.on('data', onData); child.stderr.on('data', onData);
  const code = await new Promise((resolve) => {
    const t = setTimeout(() => { child.kill(); resolve(-1); }, timeoutMs);
    child.on('exit', (c) => { clearTimeout(t); resolve(c); });
  });
  if (code !== 0 || !/Successfully logged in/i.test(out)) throw new Error(`login por navegador não concluiu (exit ${code}):\n${out.trim().split('\n').slice(-6).join('\n')}`);
  writeConfig({ ...readConfig(), cloudflareAuth: 'wrangler', loggedInAt: new Date().toISOString() });
  return { ok: true, source: 'wrangler', config: path.join(HOME, 'config.json') };
}

export function logout() {
  const { cloudflareApiToken, cloudflareAccountId, cloudflareAccountName, cloudflareAuth, loggedInAt, ...rest } = readConfig();
  writeConfig(rest);
  return { ok: true, removed: Boolean(cloudflareApiToken || cloudflareAuth), note: cloudflareAuth === 'wrangler' ? 'credencial OAuth do wrangler continua em ~/.config/.wrangler; rode `npx wrangler logout` para revogar' : undefined };
}
