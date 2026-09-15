import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GATE_HTML } from '../src/backends/tunnel/gate.js';
import { galleryHtml } from '../src/services/gallery.js';

const empty = { accountId: 'a', accountName: null, subdomain: null, projects: [] };

describe('CloudFacts identity', () => {
  it('ships the font, its licence and the mark', () => {
    const brand = path.resolve('brand');
    for (const file of ['CloudFactsSans-Regular.woff2', 'CloudFactsSans-Medium.woff2', 'OFL.txt', 'symbol.png', 'favicon.png'])
      expect(fs.existsSync(path.join(brand, file)), file).toBe(true);
  });

  it('the catalog page asks for the two weights that exist, and nothing heavier', () => {
    const html = galleryHtml(empty);
    expect(html).toContain("@font-face{font-family:'CloudFacts Sans';src:url('./CloudFactsSans-Regular.woff2')");
    expect(html).toContain("url('./CloudFactsSans-Medium.woff2')");
    expect(html).toMatch(/font-weight:400/);
    expect(html).toMatch(/font-weight:500/);
    expect(html).not.toMatch(/font-weight:\s*(600|700|bold)/);
  });

  it('the catalog page carries the name, the slogan and the mark', () => {
    const html = galleryHtml(empty);
    expect(html).toContain('CloudFacts');
    expect(html).toContain('Your stuff, flexible, everywhere.');
    expect(html).toContain('./symbol.png');
  });

  it('both generated pages set a tab icon', () => {
    expect(galleryHtml(empty)).toContain('<link rel="icon" href="./favicon.png"');
    expect(GATE_HTML).toContain('<link rel="icon" href="data:image/png;base64,');
  });

  it('the private gate looks like CloudFacts and needs nothing from the network', () => {
    expect(GATE_HTML).toContain('CloudFacts');
    expect(GATE_HTML).toContain('data:image/png;base64,');
    expect(GATE_HTML).toContain('#f4f4f1');
    expect(GATE_HTML).not.toMatch(/src="https?:/);
  });
});

describe('a page that asks for its own login', () => {
  it('is not called public, and says where its login lives', async () => {
    const { galleryHtml } = await import('../src/services/gallery.js');
    const html = galleryHtml({
      accountId: 'a',
      accountName: null,
      subdomain: null,
      projects: [
        {
          project: null,
          deploys: [
            {
              name: 'terminal',
              project: null,
              url: 'https://t.trycloudflare.com',
              inAccount: false,
              local: true,
              access: null,
              visibility: 'app-login',
              kind: 'app',
              hasAssets: false,
              createdAt: null,
              modifiedAt: null,
              backend: 'tunnel',
              status: 'running',
              untracked: true,
            },
          ],
        },
      ],
    });
    expect(html).toContain('App login');
    expect(html).not.toContain('>Public<');
    expect(html).toContain('cloudfact creds');
  });
});
