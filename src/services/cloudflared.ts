import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { BIN_DIR, readConfig, type Config } from '../config.js';

const RELEASES = 'https://github.com/cloudflare/cloudflared/releases/latest/download';

export function findCloudflared(cfg: Config = readConfig()): string | null {
  const candidates = [
    cfg.cloudflaredPath,
    process.env.CLOUDFLARED,
    path.join(BIN_DIR, 'cloudflared'),
    'cloudflared',
    path.join(os.homedir(), '.local/bin/cloudflared'),
    '/usr/local/bin/cloudflared',
    '/usr/bin/cloudflared',
  ].filter((c): c is string => Boolean(c));
  for (const c of candidates) {
    if (c.includes('/')) {
      if (fs.existsSync(c)) return c;
      continue;
    }
    const r = spawnSync('sh', ['-c', `command -v ${c}`], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return null;
}

export function cloudflaredVersion(bin: string): string | null {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || r.stderr).trim() : null;
}

function releaseAsset(): { url: string; tgz: boolean } {
  const arch = { x64: 'amd64', arm64: 'arm64', arm: 'arm' }[process.arch as 'x64' | 'arm64' | 'arm'];
  if (!arch) throw new Error(`arquitetura sem build do cloudflared: ${process.arch}`);
  if (process.platform === 'linux') return { url: `${RELEASES}/cloudflared-linux-${arch}`, tgz: false };
  if (process.platform === 'darwin') return { url: `${RELEASES}/cloudflared-darwin-${arch}.tgz`, tgz: true };
  throw new Error(
    `instale o cloudflared manualmente para ${process.platform}: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/`,
  );
}

/** Baixa o cloudflared oficial para ~/.cloudfact/bin (Linux/macOS) e devolve o caminho. */
export async function installCloudflared(onProgress: (msg: string) => void = () => {}): Promise<string> {
  const dest = path.join(BIN_DIR, 'cloudflared');
  if (fs.existsSync(dest)) return dest;
  const { url, tgz } = releaseAsset();
  fs.mkdirSync(BIN_DIR, { recursive: true, mode: 0o700 });
  onProgress(`baixando cloudflared: ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`download do cloudflared falhou: HTTP ${res.status}`);
  const tmp = `${dest}.part`;
  if (!tgz) {
    await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(tmp, { mode: 0o755 }));
  } else {
    const tar = `${tmp}.tar`;
    await pipeline(Readable.fromWeb(res.body as never), createGunzip(), fs.createWriteStream(tar));
    const x = spawnSync('tar', ['-xf', tar, '-C', BIN_DIR, 'cloudflared'], { encoding: 'utf8' });
    fs.rmSync(tar, { force: true });
    if (x.status !== 0) throw new Error(`tar falhou: ${x.stderr}`);
    fs.renameSync(path.join(BIN_DIR, 'cloudflared'), tmp);
  }
  fs.chmodSync(tmp, 0o755);
  const version = cloudflaredVersion(tmp);
  if (!version) {
    fs.rmSync(tmp, { force: true });
    throw new Error('binário baixado não roda');
  }
  fs.renameSync(tmp, dest);
  onProgress(`cloudflared instalado em ${dest} (${version})`);
  return dest;
}
