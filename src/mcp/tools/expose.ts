import { z } from 'zod';
import { expose } from '../../cloudfact.js';
import { defineTool } from '../define-tool.js';

export const exposeTool = defineTool({
  name: 'expose',
  description:
    'Publish an app that is already listening on a port to a public *.trycloudflare.com URL (tunnel backend). ' +
    'Without ssh, the port is on this machine. With ssh (user@host), the app runs on another machine: cloudfact opens an SSH port-forward to it and publishes through here — nothing to install remotely (key-based SSH access required). ' +
    'HTTP and WebSocket traffic is proxied. Apps are PRIVATE by default (same #key gate as static deploys, with rate limiting and optional expiry); pass public=true to publish without the gate. ' +
    'Idempotent: the same port/host already live returns the existing URL (reused=true).',
  annotations: { title: 'Expose a running app', readOnlyHint: false, idempotentHint: true },
  schema: {
    port: z.number().int().min(1).max(65535).describe('Port the app listens on (locally, or on the SSH host)'),
    name: z.string().optional().describe('Deploy name (slug). Defaults to port-<port> or <host>-<port>'),
    public: z.boolean().optional().describe('Publish without the key gate (default false: private)'),
    expires: z.string().optional().describe('Private key lifetime, e.g. "30m", "24h", "7d" (default: never expires)'),
    ssh: z
      .string()
      .optional()
      .describe('SSH destination of the machine running the app, e.g. ubuntu@10.0.0.5 or a Host alias from ~/.ssh/config'),
    sshPort: z.number().int().optional().describe('SSH port (default 22)'),
    identity: z.string().optional().describe('Path to the SSH private key (default: ssh agent / ~/.ssh/config)'),
    strictHostKey: z.boolean().optional().describe('Require the SSH host key to be in known_hosts already (no first-connection trust)'),
    restart: z.boolean().optional().describe('Restart even if already live (yields a new URL)'),
  },
  handler: ({ port, name, public: pub, expires, ssh, sshPort, identity, strictHostKey, restart }) =>
    expose({ port, name, public: pub, expires, restart, ssh: ssh ? { destination: ssh, port: sshPort, identity, strictHostKey } : null }),
});
