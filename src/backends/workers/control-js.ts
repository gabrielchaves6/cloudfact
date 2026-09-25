/**
 * The catalog page's on/off switch, as JavaScript embedded into the gate Worker (see gate-worker.ts).
 *
 * It runs only behind Cloudflare Access, after the visitor's Access token was verified, and only on a
 * catalog published with the switch (CLOUDFACT_CONTROL=1). Such a Worker holds two secrets: the account's
 * API token and CLOUDFACT_CONTROL_TARGETS, the deploys the page may switch (Workers by name; tunnels by
 * host URL and control key). Anything not on that list is refused, the catalog itself included.
 *
 *   GET  /.cloudfact/state            → { deploys: { <name>: { on } | { error } } }, read live
 *   POST /.cloudfact/power {name, on} → turns one deploy off (link answers nothing) or back on
 *
 * Both require the `x-cloudfact: 1` header and, when the browser sends one, this page's own Origin: a
 * page on another site riding the visitor's Access cookie can do neither.
 */
export const CONTROL_JS = `
// --- the catalog page's on/off switch ---
const OFF_TAG = 'cloudfact:off';
const answer = (status, body) => reply(status, JSON.stringify(body), { 'content-type': 'application/json' });
function controlTargets(env) {
  try {
    const t = JSON.parse(env.CLOUDFACT_CONTROL_TARGETS || '{}');
    return { workers: Array.isArray(t.workers) ? t.workers : [], tunnels: t.tunnels && typeof t.tunnels === 'object' ? t.tunnels : {} };
  } catch {
    return { workers: [], tunnels: {} };
  }
}
async function cfApi(env, method, path, body) {
  const res = await fetch('https://api.cloudflare.com/client/v4/accounts/' + env.CLOUDFACT_ACCOUNT_ID + path, {
    method,
    headers: { authorization: 'Bearer ' + env.CLOUDFACT_API_TOKEN, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok || !data || data.success === false) {
    const why = (data && data.errors && data.errors.map((e) => e.message).join('; ')) || 'HTTP ' + res.status;
    throw new Error('Cloudflare API ' + method + ' ' + path + ' failed: ' + why);
  }
  return data.result;
}
async function switchWorker(env, name, on) {
  const script = '/workers/scripts/' + encodeURIComponent(name);
  const tags = (await cfApi(env, 'GET', script + '/tags')) || [];
  // the address first: that is what takes the page down, or brings it back
  await cfApi(env, 'POST', script + '/subdomain', { enabled: on, previews_enabled: false });
  await cfApi(env, 'PUT', script + '/tags', tags.filter((t) => t !== OFF_TAG).concat(on ? [] : [OFF_TAG]));
}
async function switchTunnel(t, on) {
  const res = await fetch(t.url + '/.cloudfact/power', {
    method: on === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer ' + t.key, 'content-type': 'application/json' },
    body: on === undefined ? undefined : JSON.stringify({ on }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error('the tunnel answered HTTP ' + res.status);
  return (await res.json()).on !== false;
}
async function control(request, env, url) {
  if (env.CLOUDFACT_CONTROL !== '1' || !env.CLOUDFACT_ACCOUNT_ID || !env.CLOUDFACT_API_TOKEN) return answer(404, { error: 'not_enabled' });
  const origin = request.headers.get('origin');
  if (request.headers.get('x-cloudfact') !== '1' || (origin && origin !== url.origin)) return answer(403, { error: 'forbidden' });
  const targets = controlTargets(env);
  try {
    if (url.pathname === '/.cloudfact/state' && request.method === 'GET') {
      const deploys = {};
      if (targets.workers.length)
        for (const s of await cfApi(env, 'GET', '/workers/scripts'))
          if (targets.workers.includes(s.id)) deploys[s.id] = { on: !(s.tags || []).includes(OFF_TAG) };
      await Promise.all(
        Object.entries(targets.tunnels).map(async ([name, t]) => {
          try {
            deploys[name] = { on: await switchTunnel(t) };
          } catch {
            deploys[name] = { error: 'unreachable' };
          }
        }),
      );
      return answer(200, { deploys });
    }
    if (url.pathname === '/.cloudfact/power' && request.method === 'POST') {
      let body = null;
      try {
        body = await request.json();
      } catch {}
      const name = body && body.name;
      const on = body && body.on;
      if (typeof name !== 'string' || typeof on !== 'boolean') return answer(400, { error: 'bad_request' });
      if (Object.prototype.hasOwnProperty.call(targets.tunnels, name)) return answer(200, { name, on: await switchTunnel(targets.tunnels[name], on) });
      if (targets.workers.includes(name)) {
        await switchWorker(env, name, on);
        return answer(200, { name, on });
      }
      return answer(404, { error: 'unknown', message: 'this page cannot switch ' + name });
    }
  } catch (e) {
    return answer(502, { error: 'failed', message: String((e && e.message) || e) });
  }
  return answer(404, { error: 'not_found' });
}
`;
