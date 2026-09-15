import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tmpDir } from './helpers.js';

let home: string;
beforeAll(() => {
  home = tmpDir();
  process.env.CLOUDFACT_HOME = home;
});
afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

describe('state', () => {
  it('slug normaliza nomes', async () => {
    const { slug } = await import('../src/services/state.js');
    expect(slug('Relatório Final.html')).toBe('relatorio-final-html');
    expect(slug('///')).toBe('site');
  });
  it('write/read/effective e detecção de host morto', async () => {
    const { writeState, readState, effectiveState, listDeploys, summarize } = await import('../src/services/state.js');
    const base = { name: 'x', backend: 'tunnel' as const, mode: 'dir' as const, root: '/tmp', file: null, key: 'segredo' };
    writeState('x', {
      ...base,
      status: 'running',
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      hostPid: 999_999_999,
      url: 'https://a',
    });
    expect(readState('x')?.status).toBe('running');
    expect(effectiveState('x')?.status).toBe('dead');
    expect(listDeploys()).toHaveLength(1);
    expect(summarize(readState('x')!)).not.toHaveProperty('key');
  });
  it('recém-iniciado sem pid ainda conta como starting', async () => {
    const { writeState, effectiveState } = await import('../src/services/state.js');
    writeState('y', {
      name: 'y',
      backend: 'tunnel',
      mode: 'dir',
      root: '/tmp',
      file: null,
      status: 'starting',
      startedAt: new Date().toISOString(),
      hostPid: null,
    });
    expect(effectiveState('y')?.status).toBe('starting');
  });
});
