/** Local management bridge: the signed-in catalog can remove deployments and their local records. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { BIN_SCRIPT, HOME, readConfig } from '../config.js';
import { deployTunnel } from '../backends/tunnel/index.js';
import { timingEqual } from '../backends/tunnel/gate.js';
import { deleteWorker } from '../backends/workers/index.js';
import { catalog, setProject, slugProject } from './catalog.js';
import { alive, patchState, readState, removeDeployDir } from './state.js';
import { remove } from '../cloudfact.js';

const SERVICE = 'cloudfact-internal-manager';
const FILE = path.join(HOME, 'catalog-manager.json');
interface ManagerState {
  pid: number;
  port: number;
  key: string;
}
const load = (): ManagerState | null => {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8')) as ManagerState;
  } catch {
    return null;
  }
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function ensureCatalogManager(): Promise<{ url: string; key: string; cookieKey: string }> {
  let state = load();
  let healthy = false;
  if (state && alive(state.pid)) {
    try {
      healthy = (
        await fetch(`http://127.0.0.1:${state.port}/health`, {
          headers: { authorization: `Bearer ${state.key}` },
          signal: AbortSignal.timeout(1500),
        })
      ).ok;
    } catch {
      /* restart below */
    }
  }
  if (!healthy) {
    const fd = fs.openSync(path.join(HOME, 'catalog-manager.log'), 'a', 0o600);
    try {
      const child = spawn(process.execPath, [BIN_SCRIPT, '_catalog-manager'], {
        detached: true,
        stdio: ['ignore', fd, fd],
        env: { ...process.env, CLOUDFACT_HOME: HOME },
      });
      child.on('error', (err) => console.error('catalog manager:', err.message));
      child.unref();
      const deadline = Date.now() + 10_000;
      do {
        await pause(100);
        state = load();
        if (state && state.pid === child.pid && alive(state.pid)) break;
      } while (Date.now() < deadline);
      if (!state || state.pid !== child.pid) throw new Error('catalog manager did not start; see catalog-manager.log');
    } finally {
      fs.closeSync(fd);
    }
  }
  const manager = state!;
  const tunnel = await deployTunnel({
    name: SERVICE,
    internal: true,
    mode: 'proxy',
    root: null,
    file: null,
    targetPort: manager.port,
    private: true,
    restart: false,
    timeoutMs: 45_000,
  });
  const local = readState(SERVICE)!;
  if (!tunnel.url || !local.key) throw new Error('catalog management tunnel is not ready');
  return { url: tunnel.url, key: manager.key, cookieKey: local.key };
}

interface ManagerActions {
  names: () => Promise<string[]>;
  remove: (name: string) => Promise<void>;
  project: (name: string, project: string | null) => Promise<void>;
  refresh: () => Promise<void>;
}

export function createCatalogManagerHandler(key: string, actions: ManagerActions): http.RequestListener {
  // Mutations and the subsequent snapshot publication must finish in order.
  let pending = Promise.resolve();
  return async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (!timingEqual(req.headers.authorization ?? '', `Bearer ${key}`)) return send(401, { error: 'unauthorized' });
    const route = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (req.method === 'GET' && route === '/health') return send(200, { ok: true });
    try {
      if (req.method === 'GET' && route === '/state') return send(200, { names: await actions.names() });
      if (req.method !== 'POST' || !['/remove', '/project'].includes(route)) return send(404, { error: 'not_found' });
      let text = '';
      for await (const chunk of req) {
        text += String(chunk);
        if (text.length > 4096) return send(413, { error: 'too_large' });
      }
      let body;
      try {
        body = JSON.parse(text) as { name?: unknown; confirm?: unknown; project?: unknown };
      } catch {
        return send(400, { error: 'bad_request' });
      }
      const name = body?.name;
      if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) return send(400, { error: 'bad_request' });
      if (route === '/remove' && body.confirm !== name) return send(400, { error: 'confirmation_required' });
      if (route === '/project' && body.project !== null && typeof body.project !== 'string') return send(400, { error: 'bad_request' });
      const project = typeof body.project === 'string' && body.project.trim() ? slugProject(body.project) : null;
      const work = pending.then(async () => {
        if (!(await actions.names()).includes(name)) {
          send(404, { error: 'unknown' });
          return;
        }
        if (route === '/remove') await actions.remove(name);
        else await actions.project(name, project);
        // A failed publish must not pretend that a completed deletion was undone.
        let warning: string | undefined;
        try {
          await actions.refresh();
        } catch {
          warning = 'The change was saved, but the catalog could not be republished. Refresh it with cloudfact catalog --publish.';
        }
        send(200, { name, ...(route === '/remove' ? { removed: true } : { project }), ...(warning ? { warning } : {}) });
      });
      pending = work.catch(() => {});
      await work;
    } catch (err) {
      send(502, { error: 'failed', message: (err as Error).message });
    }
  };
}

export async function runCatalogManager(): Promise<void> {
  // remove() normally launches a detached refresh; this service publishes it once, in order instead.
  process.env.CLOUDFACT_NO_CATALOG_REFRESH = '1';
  const key = crypto.randomBytes(32).toString('base64url');
  const entries = async () =>
    (await catalog({ scanLocal: false })).projects
      .flatMap((p) => p.deploys)
      .filter((d) => !d.untracked && d.name !== readConfig().catalogDeploy);
  const handler = createCatalogManagerHandler(key, {
    names: async () => (await entries()).map((d) => d.name),
    remove: async (name) => {
      if (readState(name)) await remove(name);
      else {
        await deleteWorker(name);
        removeDeployDir(name);
      }
    },
    project: async (name, project) => {
      const entry = (await entries()).find((d) => d.name === name)!;
      if (entry.inAccount) await setProject(name, project);
      if (readState(name)) patchState(name, { project });
    },
    refresh: async () => {
      // Read the installed bundle afresh: an updated gallery must not be overwritten by this daemon's older in-memory copy.
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, [BIN_SCRIPT, 'catalog', '--publish', '--json'], {
          stdio: ['ignore', 'ignore', 'inherit'],
          env: { ...process.env, CLOUDFACT_HOME: HOME, CLOUDFACT_NO_CATALOG_REFRESH: '1' },
        });
        child.once('error', reject);
        child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error('catalog publication failed'))));
      });
    },
  });
  const server = http.createServer(handler);
  server.requestTimeout = 120_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as { port: number };
  fs.writeFileSync(FILE, JSON.stringify({ pid: process.pid, port: address.port, key }), { mode: 0o600 });
}
