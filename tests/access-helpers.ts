import { webcrypto } from 'node:crypto';

export const TEAM = 'team.cloudflareaccess.com';
export const AUD = 'aud-123';
export const SESSION_SECRET = 'session-secret-for-tests';
const b64url = (data: string | Uint8Array) => Buffer.from(data).toString('base64url');

export const rsa = () =>
  webcrypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );

/** An Access JWT, signed by `privateKey` under `kid`. */
export async function jwt(privateKey: CryptoKey, kid: string, payload: Record<string, unknown>): Promise<string> {
  const head = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = await webcrypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

/** Claims Access puts in a token for this team and app. */
export function claims(over: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return { aud: [AUD], iss: `https://${TEAM}`, exp: now + 600, nbf: now - 60, email: 'ana@example.com', ...over };
}

type Fetcher = { fetch: (req: Request, env: unknown, ctx: unknown) => Promise<Response> };

/** Goes through /.cloudfact/login the way Access forwards it, and returns the response (a 303 with the cookie). */
export function login(worker: Fetcher, env: unknown, token: string, query = 'remember=1', host = 'https://site.example.workers.dev') {
  return worker.fetch(new Request(`${host}/.cloudfact/login?${query}`, { headers: { 'cf-access-jwt-assertion': token } }), env, {});
}

/** `name=value` of the cookie a response sets, ready for a Cookie header. */
export function cookieOf(res: Response): string {
  const set = res.headers.get('set-cookie') ?? '';
  return set.split(';')[0];
}
