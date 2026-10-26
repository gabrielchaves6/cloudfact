import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from './helpers.js';

export type WorkerModule = {
  default: { fetch: (req: Request, env: unknown, ctx: unknown) => Promise<Response> };
  CloudfactLogin: new (state: { storage: unknown }) => { fetch: (req: Request) => Promise<Response> };
};

/** Loads a generated Worker source as a module, the way Cloudflare runs it. */
export async function loadWorker(source: string): Promise<{ mod: WorkerModule; dir: string }> {
  const dir = tmpDir();
  const file = path.join(dir, 'worker.mjs');
  fs.writeFileSync(file, source);
  return { mod: (await import(file)) as WorkerModule, dir };
}

/** A Durable Object namespace with one in-memory object, storage API as Cloudflare's (get/put/delete/list). */
export function fakeLoginNamespace(mod: WorkerModule) {
  const store = new Map<string, unknown>();
  const storage = {
    get: async (k: string) => structuredClone(store.get(k)),
    put: async (k: string, v: unknown) => void store.set(k, structuredClone(v)),
    delete: async (k: string) => store.delete(k),
    list: async ({ prefix }: { prefix: string }) =>
      new Map([...store].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)])),
  };
  const object = new mod.CloudfactLogin({ storage });
  return {
    store,
    namespace: {
      idFromName: (name: string) => name,
      get: () => ({ fetch: (url: string, init: RequestInit) => object.fetch(new Request(url, init)) }),
    },
  };
}

/** A JSON post to the sign-in routes, as the page's script sends it. */
export function postJson(
  worker: WorkerModule['default'],
  env: unknown,
  host: string,
  route: string,
  body: unknown,
  headers: Record<string, string> = {},
  ctx: unknown = {},
) {
  return worker.fetch(
    new Request(`https://${host}/.cloudfact/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: `https://${host}`, 'accept-language': 'pt-BR', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env,
    ctx,
  );
}
