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
    /* empty body */
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

/** API-token sign-in: validates the token, discovers the account and stores both in the config file (0600). */
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
    if (!interactive) throw new Error(`missing token. Create one at ${TOKEN_URL} and run: cloudfact login --token <token>`);
    say(`Create an API token at ${TOKEN_URL}\n  → "Create Token" → "Edit Cloudflare Workers" template\n`);
    token = await ask('Paste the token: ');
    if (!token) throw new Error('empty token');
  }
  let verify: { id: string; status: string };
  try {
    verify = await api('/user/tokens/verify', token);
  } catch (e) {
    throw new Error(`invalid token: ${(e as Error).message}`, { cause: e });
  }
  if (verify.status !== 'active') throw new Error(`token status is "${verify.status}"`);

  let accounts: { id: string; name: string }[] = [];
  try {
    accounts = await api('/accounts?per_page=50', token);
  } catch (e) {
    say(`warning: could not list accounts (${(e as Error).message})`);
  }
  let accountId = opts.accountId ?? null;
  if (!accountId && accounts.length === 1) accountId = accounts[0].id;
  if (!accountId && accounts.length > 1) {
    const menu = accounts.map((a, i) => `  [${i + 1}] ${a.name}  (${a.id})`).join('\n');
    if (!interactive) throw new Error(`the token can access ${accounts.length} accounts; pass --account-id:\n${menu}`);
    say(`Available accounts:\n${menu}`);
    const n = Number(await ask('Which one? '));
    accountId = accounts[n - 1]?.id ?? null;
    if (!accountId) throw new Error('invalid choice');
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
 * Browser OAuth sign-in (`wrangler login --device`): emits the link + code through onPrompt and waits
 * for approval. Works on machines without a browser: approve from any device.
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
    throw new Error(`browser sign-in did not complete (exit ${code}):\n${out.trim().split('\n').slice(-6).join('\n')}`);
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
        ? "wrangler's OAuth credential is still in ~/.config/.wrangler; `npx wrangler logout` revokes it"
        : undefined,
  };
}
