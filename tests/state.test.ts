import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { tmpDir } from './helpers.js';

let home: string;
beforeAll(() => {
  home = tmpDir();
  process.env.CLOUDFACT_HOME = home;
});
afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

describe('state', () => {
  it('slug normalizes names', async () => {
    const { slug } = await import('../src/services/state.js');
    expect(slug('Résumé Final.html')).toBe('resume-final-html');
    expect(slug('///')).toBe('site');
  });
  it('write/read/effective and dead-host detection', async () => {
    const { writeState, readState, effectiveState, listDeploys, summarize } = await import('../src/services/state.js');
    const base = { name: 'x', backend: 'tunnel' as const, mode: 'dir' as const, root: '/tmp', file: null, key: 'secret' };
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
  it('just-started without pid still counts as starting', async () => {
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
  it('a rename refused while another process has the file open is tried again; anything else is thrown', async () => {
    const { renameOver } = await import('../src/services/state.js');
    const busy = Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
    const real = fs.renameSync;
    let refusals = 2;
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (refusals-- > 0) throw busy;
      real(from, to);
    });
    try {
      const from = `${home}/a.tmp`;
      fs.writeFileSync(from, 'new');
      renameOver(from, `${home}/a.json`);
      expect(fs.readFileSync(`${home}/a.json`, 'utf8')).toBe('new');
      expect(spy).toHaveBeenCalledTimes(3);

      refusals = Infinity;
      expect(() => renameOver(`${home}/b.tmp`, `${home}/b.json`, 3)).toThrow(/EPERM/);
      spy.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      });
      spy.mockClear();
      expect(() => renameOver(`${home}/c.tmp`, `${home}/c.json`)).toThrow(/ENOENT/);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
