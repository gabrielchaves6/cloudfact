import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { tmpDir } from './helpers.js';

/** Account with two cloudfact workers (one tagged, one from an older version) and one unrelated worker. */
function fakeAccount() {
  const tags = new Map<string, string[]>([
    ['painel', ['cloudfact', 'cloudfact:project:migracao', 'cloudfact:vis:access', 'cloudfact:kind:static']],
    ['api-live', ['cloudfact', 'cloudfact:project:migracao', 'cloudfact:vis:private', 'cloudfact:kind:app']],
    ['legado', ['cloudfact']],
    ['nao-e-meu', []],
  ]);
  const json = (result: unknown) => new Response(JSON.stringify({ success: true, result }));
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const p = url.pathname.replace(/^\/client\/v4/, '');
    const m = /\/workers\/scripts\/([^/]+)\/tags$/.exec(p);
    if (m) {
      tags.set(decodeURIComponent(m[1]), JSON.parse(String(init!.body)));
      return json(tags.get(decodeURIComponent(m[1])));
    }
    if (p.endsWith('/workers/scripts'))
      return json([...tags].map(([id, t]) => ({ id, tags: t, modified_on: '2026-09-15T10:00:00Z', has_assets: id !== 'api-live' })));
    if (p.endsWith('/workers/subdomain')) return json({ subdomain: 'example-sub' });
    if (p.includes('/access/apps'))
      return json([{ id: 'app-1', name: 'cloudfact: painel', domain: 'painel.example-sub.workers.dev', aud: 'aud-1' }]);
    return new Response('not found', { status: 404 });
  });
  return { fetchImpl, tags };
}

describe('account catalog', () => {
  let home: string;
  const api = fakeAccount();

  beforeAll(() => {
    home = tmpDir();
    process.env.CLOUDFACT_HOME = home;
    process.env.CLOUDFLARE_API_TOKEN = 'test-token';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acc123';
    fs.mkdirSync(path.join(home, 'deploys', 'tunel-local'), { recursive: true });
    fs.writeFileSync(
      path.join(home, 'deploys', 'tunel-local', 'state.json'),
      JSON.stringify({
        name: 'tunel-local',
        backend: 'tunnel',
        mode: 'proxy',
        status: 'running',
        startedAt: '2026-09-15T09:00:00Z',
        url: 'https://xyz.trycloudflare.com',
        key: 'k',
        hostPid: 1,
        project: 'migracao',
      }),
    );
    vi.stubGlobal('fetch', api.fetchImpl);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('lists only cloudfact workers, grouped by project, with visibility and kind', async () => {
    const { catalog } = await import('../src/cloudfact.js');
    const c = await catalog();
    const all = c.projects.flatMap((p) => p.deploys);
    expect(all.map((d) => d.name).sort()).toEqual(['api-live', 'legado', 'painel', 'tunel-local']);
    expect(all.find((d) => d.name === 'nao-e-meu')).toBeUndefined();

    const painel = all.find((d) => d.name === 'painel')!;
    expect(painel).toMatchObject({
      project: 'migracao',
      url: 'https://painel.example-sub.workers.dev',
      inAccount: true,
      visibility: 'access',
      kind: 'static',
    });
    const api2 = all.find((d) => d.name === 'api-live')!;
    expect(api2).toMatchObject({ visibility: 'private', kind: 'app', project: 'migracao' });
  });

  it('falls back to has_assets when an older deploy carries no visibility tag', async () => {
    const { catalog } = await import('../src/cloudfact.js');
    const legado = (await catalog()).projects.flatMap((p) => p.deploys).find((d) => d.name === 'legado')!;
    expect(legado).toMatchObject({ project: null, kind: 'static', visibility: 'public' });
  });

  it('shows a local quick tunnel as not living in the account', async () => {
    const { catalog } = await import('../src/cloudfact.js');
    const t = (await catalog()).projects.flatMap((p) => p.deploys).find((d) => d.name === 'tunel-local')!;
    expect(t).toMatchObject({ inAccount: false, local: true, backend: 'tunnel', kind: 'app', visibility: 'private' });
  });

  it('filters by project', async () => {
    const { catalog } = await import('../src/cloudfact.js');
    const c = await catalog({ project: 'migracao' });
    expect(c.projects).toHaveLength(1);
    expect(c.projects[0].deploys.map((d) => d.name).sort()).toEqual(['api-live', 'painel', 'tunel-local']);
  });

  it('files a deploy under a project without losing visibility or kind', async () => {
    const { setProject } = await import('../src/cloudfact.js');
    const moved = await setProject('api-live', 'Migração 2026');
    expect(moved.project).toBe('migracao-2026');
    expect(api.tags.get('api-live')).toEqual([
      'cloudfact',
      'cloudfact:project:migracao-2026',
      'cloudfact:vis:private',
      'cloudfact:kind:app',
    ]);
  });

  it('renders a page with one card per deploy, its state and its project', async () => {
    const { catalog } = await import('../src/cloudfact.js');
    const { galleryHtml } = await import('../src/services/gallery.js');
    const html = galleryHtml(await catalog());
    expect(html).toContain('CloudFacts');
    expect(html).toContain('painel');
    expect(html).toContain('Sign-in');
    expect(html).toContain('Server app');
    expect(html).toContain('Static');
    expect(html).toContain('local tunnel');
    expect(html).not.toContain('nao-e-meu');
    // gated deploys must not be framed
    expect(html).not.toContain('<iframe src="https://painel.example-sub.workers.dev"');
  });
});

describe('pages served from this machine that cloudfact never recorded', () => {
  let home: string;
  beforeAll(() => {
    home = tmpDir();
    process.env.CLOUDFACT_HOME = home;
    process.env.CLOUDFLARE_API_TOKEN = 'test-token';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acc123';
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('lists a live quick tunnel found on the metrics port, named after its page title', async () => {
    const account = fakeAccount().fetchImpl;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === 'http://127.0.0.1:20243/quicktunnel')
          return new Response(JSON.stringify({ hostname: 'jill-goes-souls-ruth.trycloudflare.com' }));
        if (url.startsWith('http://127.0.0.1:')) throw new Error('closed');
        if (url === 'https://jill-goes-souls-ruth.trycloudflare.com')
          return new Response('<html><head><title>Tutorial: Plano de Receita</title></head><body>hi</body></html>');
        return account(input, init);
      }),
    );
    const { catalog } = await import('../src/cloudfact.js');
    const found = (await catalog()).projects.flatMap((p) => p.deploys).find((d) => d.untracked);
    expect(found).toMatchObject({
      name: 'tutorial-plano-de-receita',
      url: 'https://jill-goes-souls-ruth.trycloudflare.com',
      untracked: true,
      inAccount: false,
      visibility: 'public',
      backend: 'tunnel',
    });
  });
});

describe('what the catalog page is allowed to carry', () => {
  let home: string;
  beforeAll(() => {
    home = tmpDir();
    process.env.CLOUDFACT_HOME = home;
    fs.mkdirSync(path.join(home, 'deploys', 'painel'), { recursive: true });
    fs.writeFileSync(
      path.join(home, 'deploys', 'painel', 'state.json'),
      JSON.stringify({
        name: 'painel',
        backend: 'tunnel',
        mode: 'proxy',
        status: 'running',
        startedAt: '2026-09-15T09:00:00Z',
        url: 'https://abc.trycloudflare.com',
        privateUrl: 'https://abc.trycloudflare.com/#key=SEGREDO',
        key: 'SEGREDO',
        hostPid: 1,
        creds: { user: 'ana', password: 'TROCAR123' },
      }),
    );
  });
  afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

  it('a page behind sign-in opens the deploys directly and can show their login', async () => {
    const { galleryHtml } = await import('../src/services/gallery.js');
    const html = galleryHtml({
      accountId: 'acc',
      accountName: null,
      subdomain: null,
      projects: [
        {
          project: null,
          deploys: [
            {
              name: 'painel',
              project: null,
              url: 'https://abc.trycloudflare.com',
              openUrl: 'https://abc.trycloudflare.com/#key=SEGREDO',
              creds: { user: 'ana', password: 'TROCAR123' },
              inAccount: false,
              local: true,
              access: null,
              visibility: 'private',
              kind: 'app',
              hasAssets: false,
              createdAt: null,
              modifiedAt: null,
              backend: 'tunnel',
              status: 'running',
            },
          ],
        },
      ],
    });
    expect(html).toContain('#key=SEGREDO');
    expect(html).toContain('TROCAR123');
    expect(html).toContain('data-creds>');
    expect(html).not.toContain('<iframe src='); // never points a frame at the live site
  });

  it('a page open to anyone carries neither keys nor logins', async () => {
    const { withLocalSecrets } = await import('../src/cloudfact.js');
    const { galleryHtml } = await import('../src/services/gallery.js');
    const states = new Map([
      [
        'painel',
        {
          name: 'painel',
          privateUrl: 'https://abc.trycloudflare.com/#key=SEGREDO',
          creds: { user: 'ana', password: 'TROCAR123' },
        } as never,
      ],
    ]);
    const base = () => ({
      accountId: 'acc',
      accountName: null,
      subdomain: null,
      projects: [
        {
          project: null,
          deploys: [
            {
              name: 'painel',
              project: null,
              url: 'https://abc.trycloudflare.com',
              inAccount: false,
              local: true,
              access: null,
              visibility: 'private' as const,
              kind: 'app' as const,
              hasAssets: false,
              createdAt: null,
              modifiedAt: null,
              backend: 'tunnel' as const,
              status: 'running' as const,
            },
          ],
        },
      ],
    });
    const open = galleryHtml(withLocalSecrets(base(), states, false));
    expect(open).not.toContain('SEGREDO');
    expect(open).not.toContain('TROCAR123');
    expect(open).not.toContain('data-creds>'); // no reveal button on any card

    const gated = galleryHtml(withLocalSecrets(base(), states, true));
    expect(gated).toContain('#key=SEGREDO');
    expect(gated).toContain('TROCAR123');
  });
});

describe('the login box stays shut until asked', () => {
  it('hides credentials by default even though the class sets a display', async () => {
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
              name: 'app',
              project: null,
              url: 'https://x.dev',
              creds: { user: 'ana', password: 'TROCAR123' },
              inAccount: true,
              local: true,
              access: null,
              visibility: 'private',
              kind: 'app',
              hasAssets: false,
              createdAt: null,
              modifiedAt: null,
              backend: 'workers',
              status: 'deployed',
            },
          ],
        },
      ],
    });
    expect(html).toContain('<div class="creds" hidden>');
    expect(html).toContain('.creds[hidden]{display:none}');
  });
});
