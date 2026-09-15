export type Backend = 'tunnel' | 'workers';
export type BackendChoice = Backend | 'auto' | 'pages';
export type DeployMode = 'dir' | 'file';
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
  // workers
  files?: number;
  versionId?: string | null;
  deployedAt?: string;
}

/** State without the private key (privateUrl already carries it). */
export type DeploySummary = Omit<DeployState, 'key'>;

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
