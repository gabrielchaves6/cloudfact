import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCatalogManagerHandler } from '../src/services/catalog-manager.js';

describe('catalog management bridge', () => {
  let server: http.Server;
  let base: string;
  let names: string[];
  const remove = vi.fn(async (name: string) => {
    names = names.filter((n) => n !== name);
  });
  const project = vi.fn(async (_name: string, _project: string | null) => {});
  const refresh = vi.fn(async () => {});
  const post = (route: string, body: unknown, key = 'secret') =>
    fetch(base + route, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  beforeEach(async () => {
    vi.clearAllMocks();
    names = ['worker', 'stopped-tunnel'];
    server = http.createServer(createCatalogManagerHandler('secret', { names: async () => names, remove, project, refresh }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('requires its private secret and explicit name confirmation, and rejects unknown names', async () => {
    expect((await post('/remove', { name: 'worker', confirm: 'worker' }, 'wrong')).status).toBe(401);
    expect((await post('/remove', { name: 'worker' })).status).toBe(400);
    expect((await post('/remove', { name: '../worker', confirm: '../worker' })).status).toBe(400);
    expect((await post('/remove', { name: 'cloudfacts', confirm: 'cloudfacts' })).status).toBe(404);
    expect(remove).not.toHaveBeenCalled();
  });

  it('removes a stopped local tunnel too, and refreshes only after the deletion', async () => {
    const res = await post('/remove', { name: 'stopped-tunnel', confirm: 'stopped-tunnel' });
    expect(await res.json()).toEqual({ name: 'stopped-tunnel', removed: true });
    expect(names).toEqual(['worker']);
    expect(remove).toHaveBeenCalledWith('stopped-tunnel');
    expect(refresh.mock.invocationCallOrder[0]).toBeGreaterThan(remove.mock.invocationCallOrder[0]);
  });

  it('does not report a failed deletion as success or refresh away its record', async () => {
    remove.mockRejectedValueOnce(new Error('Cloudflare refused deletion'));
    const res = await post('/remove', { name: 'worker', confirm: 'worker' });
    expect(res.status).toBe(502);
    expect(names).toContain('worker');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('creates a project by moving to a new name, moves to existing ones and clears it', async () => {
    for (const [value, expected] of [
      ['Projeto Novíssimo', 'projeto-novissimo'],
      ['vault', 'vault'],
      ['', null],
      [null, null],
    ]) {
      expect((await post('/project', { name: 'worker', project: value })).status).toBe(200);
      expect(project).toHaveBeenLastCalledWith('worker', expected);
    }
    expect(refresh).toHaveBeenCalledTimes(4);
  });

  it('keeps a completed deletion distinct from an unsuccessful snapshot refresh', async () => {
    refresh.mockRejectedValueOnce(new Error('publish failed'));
    const res = await post('/remove', { name: 'worker', confirm: 'worker' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ removed: true, warning: expect.any(String) });
    expect(names).not.toContain('worker');
  });
});
