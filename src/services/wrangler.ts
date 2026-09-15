import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { WRANGLER_CONFIG, readConfig, type Config } from '../config.js';
import type { Credentials } from '../types.js';

// eslint-disable-next-line no-control-regex
export const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

/** Cloudflare credentials: API token (env/config) or wrangler's OAuth login. */
/** The OAuth access token wrangler stores after `login --device`; usable as a REST API bearer. */
export function oauthToken(): string | null {
  try {
    return /oauth_token\s*=\s*"([^"]+)"/.exec(fs.readFileSync(WRANGLER_CONFIG, 'utf8'))?.[1] ?? null;
  } catch {
    return null;
  }
}

export function credentials(cfg: Config = readConfig()): Credentials | null {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? cfg.cloudflareAccountId ?? null;
  const token = process.env.CLOUDFLARE_API_TOKEN ?? cfg.cloudflareApiToken;
  if (token) return { source: 'token', token, accountId };
  try {
    if (/oauth_token\s*=\s*"[^"]+"/.test(fs.readFileSync(WRANGLER_CONFIG, 'utf8'))) {
      return { source: 'wrangler', token: null, accountId };
    }
  } catch {
    /* no wrangler login */
  }
  return null;
}

export function wranglerCommand(cfg: Config = readConfig()): string[] {
  return cfg.wranglerCommand ? cfg.wranglerCommand.split(' ') : ['npx', '--yes', 'wrangler@4'];
}

export function wranglerEnv(creds: Credentials | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
  if (creds?.token) env.CLOUDFLARE_API_TOKEN = creds.token;
  if (creds?.accountId) env.CLOUDFLARE_ACCOUNT_ID = creds.accountId;
  return env;
}

export interface RunResult {
  status: number | null;
  text: string;
}

/** Runs wrangler synchronously, appending its output to logFile when given. */
export function runWrangler(
  args: string[],
  opts: { cfg?: Config; creds?: Credentials | null; cwd?: string; logFile?: string; input?: string } = {},
): RunResult {
  const cfg = opts.cfg ?? readConfig();
  const [cmd, ...base] = wranglerCommand(cfg);
  const r = spawnSync(cmd, [...base, ...args], {
    encoding: 'utf8',
    env: wranglerEnv(opts.creds ?? credentials(cfg)),
    cwd: opts.cwd,
    input: opts.input,
    maxBuffer: 16 * 1024 * 1024,
  });
  const text = stripAnsi((r.stdout ?? '') + (r.stderr ?? ''));
  if (opts.logFile) fs.appendFileSync(opts.logFile, `\n$ wrangler ${args.join(' ')}\n${text}`);
  return { status: r.status, text };
}
