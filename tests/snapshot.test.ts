import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { snapshot } from '../src/services/snapshot.js';
import { tmpDir } from './helpers.js';
import type { DeployState } from '../src/types.js';

const state = (over: Partial<DeployState>): DeployState =>
  ({ name: 'x', backend: 'workers', mode: 'dir', root: null, file: null, status: 'deployed', startedAt: '', ...over }) as DeployState;

describe('catalog thumbnails', () => {
  let site: string;
  beforeAll(() => {
    site = tmpDir('cloudfact-shot-');
    fs.writeFileSync(
      path.join(site, 'index.html'),
      '<!doctype html><link rel="stylesheet" href="app.css"><h1>Hello</h1><script>alert(1)</script>',
    );
    fs.writeFileSync(path.join(site, 'app.css'), 'h1{color:rebeccapurple}');
  });
  afterAll(() => fs.rmSync(site, { recursive: true, force: true }));

  it('reads the published folder, inlines its stylesheet and drops scripts', async () => {
    const html = await snapshot(state({ root: site }), { url: null, visibility: 'access' });
    expect(html).toContain('<h1>Hello</h1>');
    expect(html).toContain('<style>h1{color:rebeccapurple}</style>');
    expect(html).not.toContain('alert(1)');
    expect(html).not.toContain('<script');
  });

  it('never reads outside the published folder', async () => {
    fs.writeFileSync(path.join(site, 'escape.html'), '<link rel="stylesheet" href="../../../etc/hostname">x');
    const html = await snapshot(state({ root: site, file: path.join(site, 'escape.html') }), { url: null, visibility: 'public' });
    expect(html).toContain('x');
    expect(html).not.toContain('<style>');
  });

  it('returns nothing when this machine cannot see the content', async () => {
    expect(await snapshot(undefined, { url: null, visibility: 'access' })).toBeNull();
    expect(await snapshot(state({}), { url: 'https://gone.example', visibility: 'access' })).toBeNull();
  });
});
