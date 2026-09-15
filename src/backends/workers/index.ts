/** Backend "workers": Cloudflare Workers com assets estáticos (sucessor do Pages). URL fixa *.workers.dev */
import fs from 'node:fs';
import path from 'node:path';
import { readConfig } from '../../config.js';
import { deployDir, readState, summarize, writeState } from '../../services/state.js';
import { credentials, runWrangler } from '../../services/wrangler.js';
import type { DeployMode, DeployResult } from '../../types.js';

export interface WorkersTarget {
  name: string;
  mode: DeployMode;
  root: string | null;
  file: string | null;
  private: boolean;
}

/** Copia `src` para `dst` ignorando dotfiles, node_modules e symlinks. Devolve o número de arquivos. */
export function stageDir(src: string, dst: string): number {
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });
  let count = 0;
  const walk = (from: string, to: string) => {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
      const a = path.join(from, entry.name);
      const b = path.join(to, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(b);
        walk(a, b);
      } else if (entry.isFile()) {
        fs.copyFileSync(a, b);
        count += 1;
      }
    }
  };
  walk(src, dst);
  return count;
}

export async function deployWorkers(t: WorkersTarget): Promise<DeployResult> {
  const cfg = readConfig();
  const creds = credentials(cfg);
  if (!creds) {
    throw new Error(
      'backend "workers" exige login na Cloudflare: `cloudfact login --device` (navegador) ou `cloudfact login --token <token>`. Ou use --backend tunnel.',
    );
  }
  if (t.private) throw new Error('--private só existe no backend tunnel por enquanto; no Workers a URL é pública.');

  const dir = deployDir(t.name);
  const site = path.join(dir, 'site');
  const cwd = path.join(dir, 'empty'); // cwd neutro: o wrangler não deve autodetectar projeto nenhum
  fs.mkdirSync(cwd, { recursive: true, mode: 0o700 });
  let files: number;
  if (t.mode === 'file') {
    fs.rmSync(site, { recursive: true, force: true });
    fs.mkdirSync(site, { recursive: true });
    fs.copyFileSync(t.file!, path.join(site, 'index.html'));
    files = 1;
  } else {
    files = stageDir(t.root!, site);
    if (!files) throw new Error(`pasta sem arquivos publicáveis: ${t.root}`);
  }

  const prev = readState(t.name);
  writeState(t.name, {
    ...prev,
    name: t.name,
    backend: 'workers',
    mode: t.mode,
    root: t.root,
    file: t.file,
    status: 'deploying',
    startedAt: prev?.startedAt ?? new Date().toISOString(),
    files,
  });
  const r = runWrangler(['deploy', '--name', t.name, '--assets', site, '--compatibility-date', new Date().toISOString().slice(0, 10)], {
    cfg,
    creds,
    cwd,
    logFile: path.join(dir, 'wrangler.log'),
  });
  if (r.status !== 0) {
    writeState(t.name, { ...readState(t.name)!, status: 'error', error: r.text.slice(-1500) });
    throw new Error(`wrangler deploy falhou:\n${r.text.slice(-1500)}`);
  }
  const url = (r.text.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/g) ?? []).find((u) => u.includes(`//${t.name}.`)) ?? null;
  const versionId = r.text.match(/Version ID:\s*([0-9a-f-]+)/)?.[1] ?? null;
  const state = { ...readState(t.name)!, status: 'deployed' as const, url, versionId, deployedAt: new Date().toISOString(), error: null };
  writeState(t.name, state);
  return { ...summarize(state), reused: false };
}

/** Apaga o worker na Cloudflare. Devolve uma frase de resultado. */
export function deleteWorker(name: string): string {
  const r = runWrangler(['delete', '--name', name, '--force'], { cwd: path.join(deployDir(name), 'empty') });
  return r.status === 0 ? 'worker apagado' : `falha ao apagar worker: ${r.text.slice(-400)}`;
}
