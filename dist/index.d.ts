import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

type Backend = 'tunnel' | 'workers';
type BackendChoice = Backend | 'auto' | 'pages';
type DeployMode = 'dir' | 'file';
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
    /** Chave do modo privado. Nunca sai em respostas cruas; use summarize(). */
    key?: string | null;
    error?: string | null;
    hostPid?: number | null;
    tunnelPid?: number | null;
    port?: number | null;
    local?: string | null;
    restarts?: number;
    urlAt?: string;
    stoppedAt?: string;
    files?: number;
    versionId?: string | null;
    deployedAt?: string;
}
/** Estado sem a chave privada (o privateUrl já a contém). */
type DeploySummary = Omit<DeployState, 'key'>;
interface DeployOptions {
    path?: string;
    name?: string;
    private?: boolean;
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
/** Login com token de API: valida, descobre a conta e salva na config (0600). */
declare function loginWithToken(opts: {
    token?: string;
    accountId?: string;
    interactive?: boolean;
    onMessage?: (m: string) => void;
}): Promise<LoginResult>;
/**
 * Login OAuth pelo navegador (`wrangler login --device`): emite link + código via onPrompt
 * e espera a aprovação. Funciona em máquinas sem browser: aprova-se de qualquer dispositivo.
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

/** Baixa o cloudflared oficial para ~/.cloudfact/bin (Linux/macOS) e devolve o caminho. */
declare function installCloudflared(onProgress?: (msg: string) => void): Promise<string>;

declare function resolveBackend(choice: DeployOptions['backend']): Backend;
declare function deploy(opts?: DeployOptions): Promise<DeployResult>;
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
    deploys: {
        name: string;
        backend: Backend;
        status: string;
        url: string | null;
    }[];
}
declare function doctor(): Promise<DoctorReport>;

/** Monta o McpServer do cloudfact com todas as tools e o prompt. Transporte fica a cargo de quem chama. */
declare function createServer(): McpServer;

export { type Backend, type BackendChoice, type Credentials, type DeployMode, type DeployOptions, type DeployResult, type DeployState, type DeployStatus, type DeploySummary, type DoctorReport, type StatusResult, VERSION, createServer, deploy, doctor, installCloudflared, listDeploys, loginWithDevice, loginWithToken, logout, readLogs, remove, resolveBackend, status, stop, stopAll, summarize };
