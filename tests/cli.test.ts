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
  it('shows help without arguments', async () => {
    const r = await run([]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('cloudfact deploy');
  });
  it('doctor --json returns valid JSON', async () => {
    const r = await run(['doctor', '--json']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toHaveProperty('defaultBackend');
  });
  it('empty list', async () => {
    expect((await run(['list'])).out).toBe('no deploys');
  });
  it('unknown command returns 2', async () => {
    const r = await run(['xyz']);
    expect(r.code).toBe(2);
    expect(r.err).toContain('unknown command');
  });
  it('status without a name throws with help', async () => {
    await expect(run(['status'])).rejects.toThrow('missing the deploy name');
  });
});
