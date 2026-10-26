/**
 * The Durable Object behind cloudfact's email-code sign-in: one per site, the same rules as the private
 * Stash's login service (stash-seedhost/login/stash_login.py), which keeps them in SQLite.
 *   - a code lasts 1 hour and takes 5 tries; a used code is gone;
 *   - codes asked for one address: 5 per 15 minutes and 30 per day; 60 per 15 minutes for everyone;
 *   - an address with no access gets an unguessable code all the same, so the answers never tell which
 *     address has access.
 * It keeps only code hashes (with the address an allowed code was mailed to) and the times of the asks.
 * A Durable Object handles one request at a time, which makes each ask and each try a transaction, as
 * BEGIN IMMEDIATE does for the Stash.
 * Embedded as a string into the generated Workers, which export it as the LOGIN binding's class.
 */
export const LOGIN_STORE_JS = String.raw`
// --- email-code sign-in state: one Durable Object per site ---
const CODE_TTL = 3600; // seconds
const CODE_TRIES = 5;
const ADDRESS_LIMITS = [[900, 5], [86400, 30]]; // codes asked for one address: 5 per 15 min, 30 per day
const ANYONE_LIMIT = [900, 60];
function sameHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export class CloudfactLogin {
  constructor(state) {
    this.storage = state.storage;
  }
  async fetch(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'invalid' }, { status: 400 });
    }
    const now = Date.now() / 1000;
    if (body.op === 'ask') return Response.json(await this.ask(body, now));
    if (body.op === 'enter') return Response.json(await this.enter(body, now));
    return Response.json({ error: 'invalid' }, { status: 400 });
  }
  /** { ok } after storing the code's hash, or { error: 'busy' } past a limit (nothing stored then). */
  async ask({ request, hash, addressKey, address }, now) {
    for (const [key, row] of await this.storage.list({ prefix: 'code:' })) if (row.expires < now) await this.storage.delete(key);
    for (const [key, times] of await this.storage.list({ prefix: 'asks:' }))
      if (!times.some((at) => at >= now - 86400)) await this.storage.delete(key);
    const anyone = ((await this.storage.get('asks:anyone')) || []).filter((at) => at > now - ANYONE_LIMIT[0]);
    const mine = ((await this.storage.get('asks:' + addressKey)) || []).filter((at) => at > now - 86400);
    const seen = (list, window) => list.filter((at) => at > now - window).length;
    if (anyone.length >= ANYONE_LIMIT[1] || ADDRESS_LIMITS.some(([w, n]) => seen(mine, w) >= n)) {
      await this.storage.put('asks:anyone', anyone);
      await this.storage.put('asks:' + addressKey, mine);
      return { error: 'busy' };
    }
    anyone.push(now);
    mine.push(now);
    await this.storage.put('asks:anyone', anyone);
    await this.storage.put('asks:' + addressKey, mine);
    await this.storage.put('code:' + request, { hash, address: address || null, attempts: 0, expires: now + CODE_TTL });
    return { ok: true };
  }
  /** { ok, address } for the right code (then gone), { error: 'expired' | 'wrong' | 'wrong-last' } otherwise. */
  async enter({ request, hash }, now) {
    const key = 'code:' + request;
    const row = await this.storage.get(key);
    if (!row || row.expires <= now || row.attempts >= CODE_TRIES) return { error: 'expired' };
    if (!sameHex(hash, row.hash)) {
      row.attempts += 1;
      await this.storage.put(key, row);
      return { error: row.attempts >= CODE_TRIES ? 'wrong-last' : 'wrong' };
    }
    await this.storage.delete(key);
    return { ok: true, address: row.address };
  }
}
`;

/** Wrangler config for the LOGIN binding: a SQLite-backed Durable Object class, available on the Workers Free plan. */
export const LOGIN_STORE_CONFIG = {
  durable_objects: { bindings: [{ name: 'LOGIN', class_name: 'CloudfactLogin' }] },
  migrations: [{ tag: 'login-v1', new_sqlite_classes: ['CloudfactLogin'] }],
};
