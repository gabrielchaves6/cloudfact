/**
 * Quick tunnels leave nothing in the Cloudflare account, so the catalog would miss any page that is
 * served from this machine — including pages published before cloudfact existed, or by another tool.
 * cloudflared answers `/quicktunnel` on its metrics server (ports 20241+ by default), which gives the
 * public hostname of every tunnel running here, whoever started it.
 */
const FIRST_METRICS_PORT = 20241;
const METRICS_PORTS = 24;
const PROBE_TIMEOUT = 400;
const PAGE_TIMEOUT = 4_000;

export interface LocalTunnel {
  hostname: string;
  url: string;
  /** Page title, when the page can be read from here; used as a friendlier name than the hostname. */
  title: string | null;
  /** True when the page is a cloudfact private gate (the link alone is not enough to get in). */
  gated: boolean;
}

async function quickTunnelHostname(port: number): Promise<string | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/quicktunnel`, { signal: AbortSignal.timeout(PROBE_TIMEOUT) });
    if (!res.ok) return null;
    const body = (await res.json()) as { hostname?: string };
    return body.hostname?.endsWith('.trycloudflare.com') ? body.hostname : null;
  } catch {
    return null;
  }
}

const titleOf = (html: string): string | null => /<title[^>]*>([^<]{1,80})/i.exec(html)?.[1]?.trim() || null;

async function describe(url: string): Promise<{ title: string | null; gated: boolean }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PAGE_TIMEOUT), redirect: 'follow' });
    const html = await res.text();
    // cloudfact's own gate page announces itself; anything else is served as-is
    const gated = html.includes('Private page: open it through the full link');
    return { title: gated ? null : titleOf(html), gated };
  } catch {
    return { title: null, gated: false };
  }
}

/** Every quick tunnel currently running on this machine. Empty when cloudflared is not running. */
export async function discoverTunnels(): Promise<LocalTunnel[]> {
  const ports = Array.from({ length: METRICS_PORTS }, (_, i) => FIRST_METRICS_PORT + i);
  const hostnames = (await Promise.all(ports.map(quickTunnelHostname))).filter((h): h is string => Boolean(h));
  const unique = [...new Set(hostnames)];
  return Promise.all(
    unique.map(async (hostname) => {
      const url = `https://${hostname}`;
      const { title, gated } = await describe(url);
      return { hostname, url, title, gated };
    }),
  );
}

/** A readable name for a tunnel cloudfact did not create: its page title, else the first hostname word. */
export function tunnelName(t: LocalTunnel): string {
  const fromTitle = t.title
    ?.toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return fromTitle || t.hostname.split('.')[0].split('-').slice(0, 2).join('-');
}
