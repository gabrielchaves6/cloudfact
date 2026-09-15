export type Backend = 'tunnel' | 'workers';
export type BackendChoice = Backend | 'auto' | 'pages';
/** dir/file = static site; proxy = app behind a reverse proxy (`expose`). */
export type DeployMode = 'dir' | 'file' | 'proxy';
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
  stoppedAt?: string;
  // proxy (expose)
  targetPort?: number | null;
  ssh?: SshTarget | null;
  /** Local port of the SSH forward (proxy → forward → remote app). */
  forwardPort?: number | null;
  sshPid?: number | null;
  // workers
  files?: number;
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
  backend?: BackendChoice;
  restart?: boolean;
  timeoutMs?: number;
}

export interface DeployResult extends DeploySummary {
  reused: boolean;
}

export interface Credentials {
  source: 'token' | 'wrangler';
  token: string | null;
  accountId: string | null;
}
