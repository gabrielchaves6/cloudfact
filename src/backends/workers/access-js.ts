/**
 * JavaScript shared by the Workers cloudfact generates: the response helper plus Cloudflare Access
 * JWT verification (RS256 against the team's JWKS, cached in the isolate). Embedded as a string into
 * each generated Worker so the asset gate and the Access proxy verify identity with the same code.
 */
export const ACCESS_JS = `const enc = new TextEncoder();
const reply = (status, body, headers) =>
  new Response(body, { status, headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', ...headers } });

// --- Cloudflare Access JWT verification (RS256 against the team's JWKS, cached in the isolate) ---
let certsCache = { team: null, keys: null, at: 0 };
async function accessKeys(team, force) {
  if (!force && certsCache.team === team && certsCache.keys && Date.now() - certsCache.at < 600000) return certsCache.keys;
  const res = await fetch('https://' + team + '/cdn-cgi/access/certs');
  if (!res.ok) throw new Error('access certs: HTTP ' + res.status);
  const data = await res.json();
  const keys = [];
  for (const jwk of data.keys || []) {
    if (jwk.kty !== 'RSA') continue;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    keys.push({ kid: jwk.kid, key });
  }
  certsCache = { team, keys, at: Date.now() };
  return keys;
}
function b64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4;
  if (pad) s += '='.repeat(4 - pad);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function accessToken(request) {
  const header = request.headers.get('cf-access-jwt-assertion');
  if (header) return header;
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === 'CF_Authorization') return v.join('=');
  }
  return null;
}
async function verifyAccess(request, team, aud) {
  const token = accessToken(request);
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  let header, payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64url(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64url(parts[1])));
  } catch {
    return false;
  }
  if (!header || header.alg !== 'RS256' || !payload) return false;
  let keys = await accessKeys(team, false);
  let entry = keys.find((k) => k.kid === header.kid);
  if (!entry) {
    keys = await accessKeys(team, true); // key rotation: refresh once
    entry = keys.find((k) => k.kid === header.kid);
  }
  if (!entry) return false;
  const ok = await crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, entry.key, b64url(parts[2]), enc.encode(parts[0] + '.' + parts[1]));
  if (!ok) return false;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) return false;
  if (typeof payload.nbf === 'number' && payload.nbf > now + 60) return false;
  if (payload.iss !== 'https://' + team) return false;
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  return auds.includes(aud);
}
`;
