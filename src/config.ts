import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Diretório de estado do cloudfact. Sobrescreva com CLOUDFACT_HOME (útil em testes). */
export const HOME = process.env.CLOUDFACT_HOME ?? path.join(os.homedir(), '.cloudfact');
export const DEPLOYS_DIR = path.join(HOME, 'deploys');
export const BIN_DIR = path.join(HOME, 'bin');
export const CONFIG_FILE = path.join(HOME, 'config.json');
export const WRANGLER_CONFIG = path.join(
  process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'),
  '.wrangler',
  'config',
  'default.toml',
);
/** Script do processo host do túnel. Em dist/ fica ao lado; em dev aponte com CLOUDFACT_HOST_SCRIPT. */
export const HOST_SCRIPT = process.env.CLOUDFACT_HOST_SCRIPT ?? path.join(here, 'host.js');
export const TOKEN_URL = 'https://dash.cloudflare.com/profile/api-tokens';

function readVersion(): string {
  for (const candidate of [path.join(here, '..', 'package.json'), path.join(here, '..', '..', 'package.json')]) {
    try {
      return (JSON.parse(fs.readFileSync(candidate, 'utf8')) as { version: string }).version;
    } catch {
      /* tenta o próximo */
    }
  }
  return '0.0.0';
}
export const VERSION = readVersion();

export interface Config {
  cloudflareApiToken?: string;
  cloudflareAccountId?: string | null;
  cloudflareAccountName?: string | null;
  cloudflareAuth?: 'wrangler';
  cloudflaredPath?: string;
  wranglerCommand?: string;
  loggedInAt?: string;
}

export function readConfig(): Config {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as Config;
  } catch {
    return {};
  }
}

export function writeConfig(cfg: Config): void {
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
}
