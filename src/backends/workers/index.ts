/** "workers" backend: Cloudflare Workers with static assets (the successor of Pages). Fixed *.workers.dev URL. */
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

/** Copies `src` into `dst` skipping dotfiles, node_modules and symlinks. Returns the file count. */
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
      'the "workers" backend requires a Cloudflare sign-in: `cloudfact login --device` (browser) or `cloudfact login --token <token>`. Or use --backend tunnel.',
    );
  }
  if (t.private) throw new Error('--private is only available on the tunnel backend for now; Workers URLs are public.');

  const dir = deployDir(t.name);
  const site = path.join(dir, 'site');
  const cwd = path.join(dir, 'empty'); // neutral cwd: wrangler must not auto-detect any project
  fs.mkdirSync(cwd, { recursive: true, mode: 0o700 });
  let files: number;
  if (t.mode === 'file') {
    fs.rmSync(site, { recursive: true, force: true });
    fs.mkdirSync(site, { recursive: true });
    fs.copyFileSync(t.file!, path.join(site, 'index.html'));
    files = 1;
  } else {
    files = stageDir(t.root!, site);
    if (!files) throw new Error(`no publishable files in ${t.root}`);
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
    throw new Error(`wrangler deploy failed:\n${r.text.slice(-1500)}`);
  }
  const url = (r.text.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/g) ?? []).find((u) => u.includes(`//${t.name}.`)) ?? null;
  const versionId = r.text.match(/Version ID:\s*([0-9a-f-]+)/)?.[1] ?? null;
  const state = { ...readState(t.name)!, status: 'deployed' as const, url, versionId, deployedAt: new Date().toISOString(), error: null };
  writeState(t.name, state);
  return { ...summarize(state), reused: false };
}

/** Deletes the worker on Cloudflare. Returns a one-line outcome. */
export function deleteWorker(name: string): string {
  const r = runWrangler(['delete', '--name', name, '--force'], { cwd: path.join(deployDir(name), 'empty') });
  return r.status === 0 ? 'worker deleted' : `failed to delete worker: ${r.text.slice(-400)}`;
}
