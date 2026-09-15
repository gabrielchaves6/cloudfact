import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { tmpDir } from './helpers.js';

let home: string;
beforeAll(() => {
  home = tmpDir();
  process.env.CLOUDFACT_HOME = home;
});
afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

async function run(args: string[]): Promise<{ code: number; out: string; err: string }> {
  const { main } = await import('../src/cli/main.js');
  const out: string[] = [];
  const err: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...a) => void out.push(a.join(' ')));
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...a) => void err.push(a.join(' ')));
  try {
    const code = await main(args);
    return { code, out: out.join('\n'), err: err.join('\n') };
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
  }
}

describe('cli', () => {
  it('sem argumentos mostra ajuda', async () => {
    const r = await run([]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('cloudfact deploy');
  });
  it('doctor --json devolve JSON válido', async () => {
    const r = await run(['doctor', '--json']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toHaveProperty('defaultBackend');
  });
  it('list vazio', async () => {
    expect((await run(['list'])).out).toBe('nenhum deploy');
  });
  it('comando desconhecido devolve 2', async () => {
    const r = await run(['xyz']);
    expect(r.code).toBe(2);
    expect(r.err).toContain('comando desconhecido');
  });
  it('status sem nome lança erro com ajuda', async () => {
    await expect(run(['status'])).rejects.toThrow('faltou o nome');
  });
});
