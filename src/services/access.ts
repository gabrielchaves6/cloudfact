/**
 * Cloudflare Access (Zero Trust) in front of Workers deploys: identity-based sign-in (one-time email
 * code by default) without owning a domain. Talks to the Cloudflare API with an API token; the wrangler
 * OAuth login has no Access scopes, so `cloudfact login --token` is required for this feature.
 */
import { readConfig, writeConfig, type Config } from '../config.js';
import { credentials } from './wrangler.js';

const API = 'https://api.cloudflare.com/client/v4';

export const ACCESS_TOKEN_HELP =
  'Cloudflare Access needs an API token (the browser login has no Access scopes). Create one at https://dash.cloudflare.com/profile/api-tokens ' +
  '→ Create Token → template "Edit Cloudflare Workers" → add permissions "Access: Apps and Policies — Edit" and ' +
  '"Access: Organizations, Identity Providers, and Groups — Edit" → then run: cloudfact login --token <token>';

export interface AccessApp {
  appId: string;
  aud: string;
  domain: string;
  emails: string[];
  teamDomain: string;
}

interface Envelope<T> {
  success: boolean;
  result: T;
  errors?: { code: number; message: string }[];
}

export interface AccessClient {
  request<T>(method: string, path: string, body?: unknown): Promise<T>;
}

export function apiClient(token: string, fetchImpl: typeof fetch = fetch): AccessClient {
  return {
    async request<T>(method: string, path: string, body?: unknown): Promise<T> {
      const res = await fetchImpl(API + path, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let env: Envelope<T> | undefined;
      try {
        env = (await res.json()) as Envelope<T>;
      } catch {
        /* no body */
      }
      if (!res.ok || env?.success === false) {
        const msg = env?.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${res.status}`;
        throw new Error(`Cloudflare API ${method} ${path} failed — ${msg}`);
      }
      return env!.result;
    },
  };
}

export interface AccessContext {
  client: AccessClient;
  accountId: string;
  cfg: Config;
}

export function accessContext(cfg: Config = readConfig(), fetchImpl?: typeof fetch): AccessContext {
  const creds = credentials(cfg);
  if (!creds?.token) throw new Error(ACCESS_TOKEN_HELP);
  if (!creds.accountId)
    throw new Error('Cloudflare account id unknown; run `cloudfact login --token <token>` again (it discovers the account)');
  return { client: apiClient(creds.token, fetchImpl), accountId: creds.accountId, cfg };
}

export function slugTeam(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'cloudfact'
  );
}

/** Zero Trust organization (team domain). Created once with a `<team>.cloudflareaccess.com` domain. */
export async function ensureOrganization(ctx: AccessContext, teamName?: string): Promise<string> {
  const base = `/accounts/${ctx.accountId}/access/organizations`;
  try {
    const org = await ctx.client.request<{ auth_domain?: string }>('GET', base);
    if (org?.auth_domain) {
      if (ctx.cfg.cloudflareTeamDomain !== org.auth_domain) writeConfig({ ...readConfig(), cloudflareTeamDomain: org.auth_domain });
      return org.auth_domain;
    }
  } catch {
    /* none yet */
  }
  const team = slugTeam(teamName ?? ctx.cfg.cloudflareTeam ?? `cloudfact-${ctx.accountId.slice(0, 8)}`);
  const authDomain = `${team}.cloudflareaccess.com`;
  await ctx.client.request('POST', base, { name: team, auth_domain: authDomain, auto_redirect_to_identity: false });
  writeConfig({ ...readConfig(), cloudflareTeamDomain: authDomain });
  return authDomain;
}

/** One-time PIN (email code) identity provider: the zero-setup way to sign in. */
export async function ensureOtpProvider(ctx: AccessContext): Promise<string> {
  const base = `/accounts/${ctx.accountId}/access/identity_providers`;
  const list = await ctx.client.request<{ id: string; type: string }[]>('GET', base);
  const otp = list.find((p) => p.type === 'onetimepin');
  if (otp) return otp.id;
  const created = await ctx.client.request<{ id: string }>('POST', base, { name: 'One-time PIN', type: 'onetimepin', config: {} });
  return created.id;
}

export interface UpsertAppOptions {
  name: string;
  domain: string;
  emails: string[];
  sessionDuration?: string;
}

/** Self-hosted Access application for `domain` allowing exactly `emails`. Idempotent by domain. */
export async function upsertAccessApp(ctx: AccessContext, opts: UpsertAppOptions): Promise<AccessApp> {
  const teamDomain = await ensureOrganization(ctx);
  await ensureOtpProvider(ctx);
  const base = `/accounts/${ctx.accountId}/access/apps`;
  const emails = [...new Set(opts.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!emails.length) throw new Error('--access needs at least one email');
  const body = {
    name: `cloudfact: ${opts.name}`,
    domain: opts.domain,
    type: 'self_hosted',
    session_duration: opts.sessionDuration ?? '24h',
    auto_redirect_to_identity: true,
    app_launcher_visible: false,
    policies: [{ name: 'cloudfact allow list', decision: 'allow', include: emails.map((email) => ({ email: { email } })) }],
  };
  const existing = (await ctx.client.request<{ id: string; domain: string }[]>('GET', `${base}?per_page=100`)).find(
    (a) => a.domain === opts.domain,
  );
  const app = existing
    ? await ctx.client.request<{ id: string; aud: string }>('PUT', `${base}/${existing.id}`, body)
    : await ctx.client.request<{ id: string; aud: string }>('POST', base, body);
  return { appId: app.id, aud: app.aud, domain: opts.domain, emails, teamDomain };
}

export async function deleteAccessApp(ctx: AccessContext, appId: string): Promise<void> {
  await ctx.client.request('DELETE', `/accounts/${ctx.accountId}/access/apps/${appId}`);
}
