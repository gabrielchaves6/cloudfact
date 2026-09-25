import { vi } from 'vitest';

/** In-memory stand-in for the Cloudflare API: organizations, identity providers, access apps. */
export function fakeCloudflareApi() {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  let org: { auth_domain: string } | null = null;
  const idps: { id: string; type: string }[] = [];
  const apps: { id: string; aud: string; domain: string; body: unknown }[] = [];
  const json = (result: unknown, status = 200) => new Response(JSON.stringify({ success: true, result }), { status });
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const p = url.pathname.replace(/^\/client\/v4/, '');
    calls.push({ method, path: p, body });
    if (p.endsWith('/workers/subdomain')) return json({ subdomain: 'example-sub' });
    if (p.endsWith('/workers/scripts'))
      return json([
        { id: 'site', tags: ['cloudfact', 'cloudfact:vis:private', 'cloudfact:kind:static'], has_assets: true },
        { id: 'cloudfacts', tags: ['cloudfact', 'cloudfact:catalog'], has_assets: true },
      ]);
    if (/\/workers\/scripts\/[^/]+\/tags$/.test(p)) return json(body);
    if (p === '/user') return json({ email: 'owner@example.com' });
    if (p.endsWith('/access/organizations')) {
      if (method === 'GET')
        return org
          ? json(org)
          : new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: 'none' }] }), { status: 404 });
      org = { auth_domain: (body as { auth_domain: string }).auth_domain };
      return json(org);
    }
    if (p.endsWith('/access/identity_providers')) {
      if (method === 'GET') return json(idps);
      const idp = { id: `idp-${idps.length + 1}`, type: (body as { type: string }).type };
      idps.push(idp);
      return json(idp);
    }
    if (p.endsWith('/access/apps')) {
      if (method === 'GET') return json(apps.map((a) => ({ id: a.id, domain: a.domain })));
      const app = { id: `app-${apps.length + 1}`, aud: `aud-${apps.length + 1}`, domain: (body as { domain: string }).domain, body };
      apps.push(app);
      return json(app);
    }
    const m = p.match(/\/access\/apps\/([^/]+)$/);
    if (m) {
      const app = apps.find((a) => a.id === m[1])!;
      if (method === 'PUT') {
        app.body = body;
        return json({ id: app.id, aud: app.aud });
      }
      if (method === 'DELETE') {
        apps.splice(apps.indexOf(app), 1);
        return json({ id: app.id });
      }
    }
    return new Response('not found', { status: 404 });
  });
  return {
    fetchImpl,
    calls,
    state: {
      get org() {
        return org;
      },
      idps,
      apps,
    },
  };
}
