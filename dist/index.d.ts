import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ZodRawShape, z } from 'zod';

type Backend = 'tunnel' | 'workers';
type BackendChoice = Backend | 'auto' | 'pages';
/** dir/file = static site; proxy = app behind a reverse proxy (`expose`). */
type DeployMode = 'dir' | 'file' | 'proxy';
type DeployStatus = 'starting' | 'running' | 'reconnecting' | 'stopped' | 'dead' | 'error' | 'deploying' | 'deployed';
interface DeployState {
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
    hostPid?: number | null;
    tunnelPid?: number | null;
    port?: number | null;
    local?: string | null;
    restarts?: number;
    urlAt?: string;
    stoppedAt?: string;
    targetPort?: number | null;
    ssh?: SshTarget | null;
    /** Local port of the SSH forward (proxy → forward → remote app). */
    forwardPort?: number | null;
    sshPid?: number | null;
    files?: number;
    versionId?: string | null;
    deployedAt?: string;
}
/** State without the private key (privateUrl already carries it). */
type DeploySummary = Omit<DeployState, 'key'>;
interface SshTarget {
    /** user@host or host */
    destination: string;
    port?: number;
    identity?: string;
    /** Require the host key to be in known_hosts already (StrictHostKeyChecking=yes). */
    strictHostKey?: boolean;
}
interface ExposeOptions {
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
interface DeployOptions {
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
interface DeployResult extends DeploySummary {
    reused: boolean;
}
interface Credentials {
    source: 'token' | 'wrangler';
    token: string | null;
    accountId: string | null;
}

declare function listDeploys(): DeployState[];
declare function summarize(state: DeployState): DeploySummary;
declare function readLogs(name: string, lines?: number): Record<string, string>;

interface LoginResult {
    ok: true;
    source: 'token' | 'wrangler';
    accountId?: string | null;
    accountName?: string | null;
    config: string;
}
/** API-token sign-in: validates the token, discovers the account and stores both in the config file (0600). */
declare function loginWithToken(opts: {
    token?: string;
    accountId?: string;
    interactive?: boolean;
    onMessage?: (m: string) => void;
}): Promise<LoginResult>;
/**
 * Browser OAuth sign-in (`wrangler login --device`): emits the link + code through onPrompt and waits
 * for approval. Works on machines without a browser: approve from any device.
 */
declare function loginWithDevice(opts?: {
    onPrompt?: (text: string) => void;
    timeoutMs?: number;
}): Promise<LoginResult>;
declare function logout(): {
    ok: true;
    removed: boolean;
    note?: string;
};

declare const VERSION: string;

/** Downloads the official cloudflared into ~/.cloudfact/bin (Linux/macOS) and returns its path. */
declare function installCloudflared(onProgress?: (msg: string) => void): Promise<string>;

declare function resolveBackend(choice: DeployOptions['backend']): Backend;
declare function deploy(opts?: DeployOptions): Promise<DeployResult>;
/** Publish an app that already listens on a port, here or on a machine reachable over SSH. Tunnel backend only. Private by default. */
declare function expose(opts: ExposeOptions): Promise<DeployResult>;
/**
 * Issues a new private key (and optional expiry) for a live tunnel deploy without restarting it: the old
 * link and every session cookie stop working immediately. On a public deploy this turns it private.
 */
declare function rotate(name: string, opts?: {
    expires?: string;
}): Promise<DeployResult>;
declare function stop(name: string): Promise<{
    name: string;
    stopped: boolean;
    note?: string;
}>;
declare function stopAll(): Promise<{
    name: string;
    stopped: boolean;
}[]>;
declare function remove(name: string): Promise<{
    name: string;
    removed: true;
    remote?: string;
}>;
interface StatusResult extends DeploySummary {
    reachable?: boolean;
    httpStatus?: number;
    checkError?: string;
}
declare function status(name: string, opts?: {
    check?: boolean;
}): Promise<StatusResult>;
interface DoctorReport {
    version: string;
    node: string;
    home: string;
    cloudflared: {
        path: string;
        version: string | null;
    } | {
        missing: true;
        hint: string;
    };
    cloudflare: {
        loggedIn: true;
        source: 'token' | 'wrangler';
        accountId: string | null;
        accountName: string | null;
    } | {
        loggedIn: false;
        hint: string;
    };
    defaultBackend: Backend;
    /** ssh client available (needed for expose --ssh) */
    ssh: boolean;
    deploys: {
        name: string;
        backend: Backend;
        status: string;
        url: string | null;
    }[];
}
declare function doctor(): Promise<DoctorReport>;

/** Builds the cloudfact McpServer with every tool and the prompt. The caller picks the transport. */
declare function createServer(): McpServer;

interface ToolAnnotations {
    title: string;
    readOnlyHint: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
}
interface ToolDefinition<Schema extends ZodRawShape = ZodRawShape> {
    name: string;
    description: string;
    annotations: ToolAnnotations;
    schema: Schema;
    handler: (params: z.infer<z.ZodObject<Schema>>) => Promise<unknown>;
}

declare const tools: ToolDefinition<any>[];

export { type Backend, type BackendChoice, type Credentials, type DeployMode, type DeployOptions, type DeployResult, type DeployState, type DeployStatus, type DeploySummary, type DoctorReport, type ExposeOptions, type SshTarget, type StatusResult, type ToolDefinition, VERSION, createServer, deploy, doctor, expose, installCloudflared, listDeploys, loginWithDevice, loginWithToken, logout, readLogs, remove, resolveBackend, rotate, status, stop, stopAll, summarize, tools };
