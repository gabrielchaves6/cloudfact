import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tmpDir } from './helpers.js';

const writeDeploy = (home: string, name: string) => {
  const dir = path.join(home, 'deploys', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'state.json'),
    JSON.stringify({ name, backend: 'workers', mode: 'dir', status: 'deployed', startedAt: '2026-09-15T09:00:00Z' }),
  );
};
const config = (home: string) => JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));

describe('catalog upkeep', () => {
  let home: string;
  beforeEach(() => {
    home = tmpDir();
    process.env.CLOUDFACT_HOME = home;
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'config.json'), '{}');
  });
  afterEach(() => {
    delete process.env.CLOUDFLARE_API_TOKEN;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('stays quiet until there are a few deploys, then mentions the catalog exactly once', async () => {
    const { catalogHint } = await import('../src/cloudfact.js');
    writeDeploy(home, 'um');
    writeDeploy(home, 'dois');
    expect(catalogHint()).toBeNull(); // two is not enough to be worth a tip

    writeDeploy(home, 'tres');
    const first = catalogHint();
    expect(first).toContain('catalog --publish');
    expect(catalogHint()).toBeNull(); // never again
    expect(config(home).catalogHintShown).toBe(true);
  });

  it('never mentions it to someone who already has the page', async () => {
    const { catalogHint } = await import('../src/cloudfact.js');
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ catalogDeploy: 'cloudfacts' }));
    for (const n of ['um', 'dois', 'tres', 'quatro']) writeDeploy(home, n);
    expect(catalogHint()).toBeNull();
  });

  it('does not try to refresh a catalog page that was never published', async () => {
    const { refreshCatalogPage } = await import('../src/cloudfact.js');
    expect(await refreshCatalogPage('qualquer')).toBe(false);
  });

  it('refuses to refresh itself, and stands down inside a refresh', async () => {
    const { refreshCatalogPage } = await import('../src/cloudfact.js');
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ catalogDeploy: 'cloudfacts' }));
    expect(await refreshCatalogPage('cloudfacts')).toBe(false); // the page itself was just deployed

    process.env.CLOUDFACT_NO_CATALOG_REFRESH = '1';
    try {
      expect(await refreshCatalogPage('outro')).toBe(false); // already inside the refresh process
    } finally {
      delete process.env.CLOUDFACT_NO_CATALOG_REFRESH;
    }
  });
});
