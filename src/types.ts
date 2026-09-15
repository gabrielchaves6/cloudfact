export type Backend = 'tunnel' | 'workers';
export type BackendChoice = Backend | 'auto' | 'pages';
/** dir/file = static site; proxy = app behind a reverse proxy (`expose`). */
export type DeployMode = 'dir' | 'file' | 'proxy';
/** Who can open a deploy: anyone, whoever holds the key link, or the emails allowed by Cloudflare Access. */
export type Visibility = 'public' | 'private' | 'access';
/** Static files uploaded/served, or an app with its own server behind the proxy. */
export type DeployKind = 'static' | 'app';
export type DeployStatus = 'starting' | 'running' | 'reconnecting' | 'stopped' | 'dead' | 'error' | 'deploying' | 'deployed';

export interface DeployState {
  name: string;
  backend: Backend;
  mode: DeployMode;
  root: string | null;
  file: string | null;
  status: DeployStatus;
  startedAt: string;
  url?: string | null;
  privateUrl?: string | null;
  /** Private-mode key. Never returned raw; use summarize(). */
  key?: string | null;
  /** ISO date after which the private key stops working (null = never). */
  keyExpiresAt?: string | null;
  error?: string | null;
  // tunnel
  hostPid?: number | null;
  tunnelPid?: number | null;
  port?: number | null;
  local?: string | null;
  restarts?: number;
  urlAt?: string;
  /** Public hostname of the tunnel that serves this deploy when a Worker fronts it. */
  tunnelUrl?: string | null;
  stoppedAt?: string;
  // proxy (expose)
  targetPort?: number | null;
  ssh?: SshTarget | null;
  /** Local port of the SSH forward (proxy → forward → remote app). */
  forwardPort?: number | null;
  sshPid?: number | null;
  // workers
  files?: number;
  /** Project this deploy belongs to in the account catalog. */
  project?: string | null;
  /** Cloudflare Access app in front of this deploy (identity sign-in). */
  access?: { appId: string; aud: string; domain: string; emails: string[]; teamDomain: string } | null;
  versionId?: string | null;
  deployedAt?: string;
}

/** State without the private key (privateUrl already carries it). */
export type DeploySummary = Omit<DeployState, 'key'>;

export interface SshTarget {
  /** user@host or host */
  destination: string;
  port?: number;
  identity?: string;
  /** Require the host key to be in known_hosts already (StrictHostKeyChecking=yes). */
  strictHostKey?: boolean;
}

export interface ExposeOptions {
  port: number;
  name?: string;
  /** Apps are private by default; set public=true to publish without the key gate. */
  public?: boolean;
  /** Key lifetime, e.g. "30m", "24h", "7d". Default: no expiry. */
  expires?: string;
  ssh?: SshTarget | null;
  /** Project to file this deploy under in the account catalog. */
  project?: string;
  restart?: boolean;
  timeoutMs?: number;
}

export interface DeployOptions {
  path?: string;
  name?: string;
  /** Deploys are private by default; set public=true to publish without the key gate. */
  public?: boolean;
  /** @deprecated private is the default; kept for compatibility (true forces private). */
  private?: boolean;
  /** Key lifetime for private deploys, e.g. "30m", "24h", "7d". Default: no expiry. */
  expires?: string;
  /** Emails allowed to sign in through Cloudflare Access (workers backend). Replaces the key gate. */
  access?: string[];
  /** Project to file this deploy under in the account catalog. */
  project?: string;
  backend?: BackendChoice;
  restart?: boolean;
  timeoutMs?: number;
}

export interface DeployResult extends DeploySummary {
  reused: boolean;
}

/** One deploy as seen from the Cloudflare account (plus what this machine knows about it). */
export interface CatalogEntry {
  name: string;
  project: string | null;
  url: string | null;
  /** True when the deploy exists in the Cloudflare account (workers). Quick tunnels are local-only. */
  inAccount: boolean;
  /** True when this machine still has the deploy's local record. */
  local: boolean;
  access: { emails: string[]; appId: string } | null;
  visibility: Visibility;
  kind: DeployKind;
  hasAssets: boolean;
  createdAt: string | null;
  modifiedAt: string | null;
  backend: Backend;
  status: DeployStatus;
  /**
   * Live on this machine but with no local record: published by an older cloudfact whose state is gone,
   * from another folder or home, or by another tool entirely. The page works; cloudfact cannot manage it.
   */
  untracked?: boolean;
}

export interface CatalogResult {
  accountId: string;
  accountName: string | null;
  subdomain: string | null;
  projects: { project: string | null; deploys: CatalogEntry[] }[];
}

export interface Credentials {
  source: 'token' | 'wrangler';
  token: string | null;
  accountId: string | null;
}
