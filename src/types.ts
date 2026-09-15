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
}

export interface ExposeOptions {
  port: number;
  name?: string;
  private?: boolean;
  ssh?: SshTarget | null;
  restart?: boolean;
  timeoutMs?: number;
}

export interface DeployOptions {
  path?: string;
  name?: string;
  private?: boolean;
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
