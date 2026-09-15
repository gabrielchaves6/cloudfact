import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ZodRawShape, z } from 'zod';

type Backend = 'tunnel' | 'workers';
type BackendChoice = Backend | 'auto' | 'pages';
/** dir/file = static site; proxy = app behind a reverse proxy (`expose`). */
type DeployMode = 'dir' | 'file' | 'proxy';
/** Who can open a deploy: anyone, whoever holds the key link, or the emails allowed by Cloudflare Access. */
type Visibility = 'public' | 'private' | 'access';
/** Static files uploaded/served, or an app with its own server behind the proxy. */
type DeployKind = 'static' | 'app';
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
    /** Project this deploy belongs to in the account catalog. */
    project?: string | null;
    /** Cloudflare Access app in front of this deploy (identity sign-in). */
    access?: {
        appId: string;
        aud: string;
        domain: string;
        emails: string[];
        teamDomain: string;
    } | null;
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
    /** Project to file this deploy under in the account catalog. */
    project?: string;
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
    /** Emails allowed to sign in through Cloudflare Access (workers backend). Replaces the key gate. */
    access?: string[];
    /** Project to file this deploy under in the account catalog. */
    project?: string;
    backend?: BackendChoice;
    restart?: boolean;
    timeoutMs?: number;
}
interface DeployResult extends DeploySummary {
    reused: boolean;
}
/** One deploy as seen from the Cloudflare account (plus what this machine knows about it). */
interface CatalogEntry {
    name: string;
    project: string | null;
    url: string | null;
    /** True when the deploy exists in the Cloudflare account (workers). Quick tunnels are local-only. */
    inAccount: boolean;
    /** True when this machine still has the deploy's local record. */
    local: boolean;
    access: {
        emails: string[];
        appId: string;
    } | null;
    visibility: Visibility;
    kind: DeployKind;
    hasAssets: boolean;
    createdAt: string | null;
    modifiedAt: string | null;
    backend: Backend;
    status: DeployStatus;
}
interface CatalogResult {
    accountId: string;
    accountName: string | null;
    subdomain: string | null;
    projects: {
        project: string | null;
        deploys: CatalogEntry[];
    }[];
}
interface Credentials {
    source: 'token' | 'wrangler';
    token: string | null;
    accountId: string | null;
}

declare function listDeploys(): DeployState[];
declare function summarize(state: DeployState): DeploySummary;
declare function readLogs(name: string, lines?: number): Record<string, string>;

declare const VERSION: string;

/**
 * Account-wide catalog: every cloudfact deploy that lives in the Cloudflare account, not just the ones
 * this machine remembers. Cloudflare Workers carry script tags, so cloudfact marks what it creates with
 * `cloudfact` plus `cloudfact:project:<project>`; listing the account's scripts is then enough to rebuild
 * the whole picture from any machine, even after a reinstall.
 *
 * Quick tunnels have no account-side resource: they exist only while the machine that started them runs,
 * so they can only ever come from local state (`local: true`, `inAccount: false`).
 */

/**
 * The account's cloudfact deploys, grouped by project, merged with what this machine knows.
 * Three API calls: scripts, the workers.dev subdomain and (best effort) the Access applications.
 */
declare function catalog(opts?: {
    project?: string;
    fetchImpl?: typeof fetch;
}): Promise<CatalogResult>;
/** Files an existing deploy under a project (or clears it with null), without redeploying. */
declare function setProject(name: string, project: string | null, fetchImpl?: typeof fetch): Promise<CatalogEntry>;

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

/** Downloads the official cloudflared into ~/.cloudfact/bin (Linux/macOS) and returns its path. */
declare function installCloudflared(onProgress?: (msg: string) => void): Promise<string>;

declare function resolveBackend(choice: DeployOptions['backend']): Backend;
declare function deploy(opts?: DeployOptions): Promise<DeployResult>;
/** Publish an app that already listens on a port, here or on a machine reachable over SSH. Tunnel backend only. Private by default. */
declare function expose(opts: ExposeOptions): Promise<DeployResult>;
/**
 * Publishes the catalog itself: a page with one card per cloudfact in the account, grouped by project,
 * showing whether each is public, key-gated or behind sign-in, and static or a server app.
 *
 * The page is an index of everything you host, so it asks for identity by default: without an explicit
 * list, Cloudflare Access is put in front of it for the email that owns the account. It falls back to a
 * private key link only when that email cannot be determined, and `public: true` still opts out.
 */
declare function publishCatalog(opts?: {
    name?: string;
    project?: string;
    access?: string[];
    public?: boolean;
    title?: string;
}): Promise<DeployResult>;
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

export { type Backend, type BackendChoice, type CatalogEntry, type CatalogResult, type Credentials, type DeployKind, type DeployMode, type DeployOptions, type DeployResult, type DeployState, type DeployStatus, type DeploySummary, type DoctorReport, type ExposeOptions, type SshTarget, type StatusResult, type ToolDefinition, VERSION, type Visibility, catalog, createServer, deploy, doctor, expose, installCloudflared, listDeploys, loginWithDevice, loginWithToken, logout, publishCatalog, readLogs, remove, resolveBackend, rotate, setProject, status, stop, stopAll, summarize, tools };
