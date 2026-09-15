import path from 'node:path';
import readline from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { HOME, TOKEN_URL, readConfig, writeConfig } from '../config.js';
import { wranglerCommand, stripAnsi } from './wrangler.js';

const API = 'https://api.cloudflare.com/client/v4';

interface ApiEnvelope<T> {
  success: boolean;
  result: T;
  errors?: { message: string }[];
}

async function api<T>(pathname: string, token: string): Promise<T> {
  const res = await fetch(API + pathname, { headers: { Authorization: `Bearer ${token}` } });
  let body: ApiEnvelope<T> | undefined;
  try {
    body = (await res.json()) as ApiEnvelope<T>;
  } catch {
    /* corpo vazio */
  }
  if (!res.ok || body?.success === false) {
    throw new Error(body?.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`);
  }
  return body!.result;
}

async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export interface LoginResult {
  ok: true;
  source: 'token' | 'wrangler';
  accountId?: string | null;
  accountName?: string | null;
  config: string;
}

/** Login com token de API: valida, descobre a conta e salva na config (0600). */
export async function loginWithToken(opts: {
  token?: string;
  accountId?: string;
  interactive?: boolean;
  onMessage?: (m: string) => void;
}): Promise<LoginResult> {
  const say = opts.onMessage ?? ((m) => process.stderr.write(`${m}\n`));
  const interactive = opts.interactive ?? Boolean(process.stdin.isTTY);
  let token = opts.token;
  if (!token) {
    if (!interactive) throw new Error(`token ausente. Crie um em ${TOKEN_URL} e rode: cloudfact login --token <token>`);
    say(`Crie um token de API em ${TOKEN_URL}\n  → "Create Token" → template "Edit Cloudflare Workers"\n`);
    token = await ask('Cole o token: ');
    if (!token) throw new Error('token vazio');
  }
  let verify: { id: string; status: string };
  try {
    verify = await api('/user/tokens/verify', token);
  } catch (e) {
    throw new Error(`token inválido: ${(e as Error).message}`, { cause: e });
  }
  if (verify.status !== 'active') throw new Error(`token com status "${verify.status}"`);

  let accounts: { id: string; name: string }[] = [];
  try {
    accounts = await api('/accounts?per_page=50', token);
  } catch (e) {
    say(`aviso: não consegui listar contas (${(e as Error).message})`);
  }
  let accountId = opts.accountId ?? null;
  if (!accountId && accounts.length === 1) accountId = accounts[0].id;
  if (!accountId && accounts.length > 1) {
    const menu = accounts.map((a, i) => `  [${i + 1}] ${a.name}  (${a.id})`).join('\n');
    if (!interactive) throw new Error(`token acessa ${accounts.length} contas; passe --account-id:\n${menu}`);
    say(`Contas disponíveis:\n${menu}`);
    const n = Number(await ask('Qual? '));
    accountId = accounts[n - 1]?.id ?? null;
    if (!accountId) throw new Error('escolha inválida');
  }
  const account = accounts.find((a) => a.id === accountId);
  writeConfig({
    ...readConfig(),
    cloudflareApiToken: token,
    cloudflareAccountId: accountId,
    cloudflareAccountName: account?.name ?? null,
    loggedInAt: new Date().toISOString(),
  });
  return { ok: true, source: 'token', accountId, accountName: account?.name ?? null, config: path.join(HOME, 'config.json') };
}

/**
 * Login OAuth pelo navegador (`wrangler login --device`): emite link + código via onPrompt
 * e espera a aprovação. Funciona em máquinas sem browser: aprova-se de qualquer dispositivo.
 */
export async function loginWithDevice(opts: { onPrompt?: (text: string) => void; timeoutMs?: number } = {}): Promise<LoginResult> {
  const onPrompt = opts.onPrompt ?? ((t) => process.stderr.write(t));
  const [cmd, ...base] = wranglerCommand();
  const child = spawn(cmd, [...base, 'login', '--device', '--browser=false'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: '1' },
  });
  let out = '';
  let prompted = false;
  const onData = (chunk: Buffer) => {
    out += stripAnsi(chunk.toString());
    if (!prompted && /enter the code:\s*\S+/s.test(out)) {
      prompted = true;
      onPrompt(out.replace(/^.*?To authorize/s, 'To authorize'));
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const code = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(
      () => {
        child.kill();
        resolve(-1);
      },
      opts.timeoutMs ?? 6 * 60_000,
    );
    child.on('exit', (c) => {
      clearTimeout(timer);
      resolve(c);
    });
  });
  if (code !== 0 || !/Successfully logged in/i.test(out)) {
    throw new Error(`login por navegador não concluiu (exit ${code}):\n${out.trim().split('\n').slice(-6).join('\n')}`);
  }
  writeConfig({ ...readConfig(), cloudflareAuth: 'wrangler', loggedInAt: new Date().toISOString() });
  return { ok: true, source: 'wrangler', config: path.join(HOME, 'config.json') };
}

export function logout(): { ok: true; removed: boolean; note?: string } {
  const { cloudflareApiToken, cloudflareAccountId: _a, cloudflareAccountName: _n, cloudflareAuth, loggedInAt: _l, ...rest } = readConfig();
  writeConfig(rest);
  return {
    ok: true,
    removed: Boolean(cloudflareApiToken || cloudflareAuth),
    note:
      cloudflareAuth === 'wrangler'
        ? 'a credencial OAuth do wrangler continua em ~/.config/.wrangler; `npx wrangler logout` revoga'
        : undefined,
  };
}
