import { z } from 'zod';
import { deploy } from '../../cloudfact.js';
import { defineTool } from '../define-tool.js';

export const deployTool = defineTool({
  name: 'deploy',
  description:
    'Publish a folder (or a single .html file) from this machine to a public Cloudflare URL. ' +
    '"tunnel" backend (default when signed out): local static server + cloudflared quick tunnel, *.trycloudflare.com URL; the process runs in the background and outlives the session. ' +
    '"workers" backend (default when signed in): Cloudflare Workers with static assets, fixed URL https://<name>.<sub>.workers.dev; redeploying updates the same address. ' +
    'Idempotent on tunnel: if the same path is already live, returns the existing URL (reused=true). ' +
    'Deploys are PRIVATE by default on both backends (key-gated link; on workers a gate Worker runs in front of the files); pass public=true to publish openly. ' +
    'access=[emails] (workers backend, API-token login) puts Cloudflare Access in front instead: visitors sign in with a one-time email code and only listed emails get in. ' +
    'Returns JSON with url and, when private, privateUrl (already includes #key=...).',
  annotations: { title: 'Publish static site', readOnlyHint: false, idempotentHint: true },
  schema: {
    path: z.string().describe('Absolute path of the folder or .html file to publish'),
    name: z.string().optional().describe('Deploy name (slug). Defaults to the folder/file name'),
    public: z.boolean().optional().describe('Publish without the key gate (default false: private)'),
    backend: z.enum(['auto', 'tunnel', 'workers']).optional().describe('auto = workers when signed in to Cloudflare, otherwise tunnel'),
    expires: z.string().optional().describe('Private key lifetime, e.g. "30m", "24h", "7d" (default: never expires)'),
    access: z
      .array(z.string())
      .optional()
      .describe('Emails allowed to sign in through Cloudflare Access (identity gate instead of the key link; workers backend)'),
    restart: z.boolean().optional().describe('Restart even if already live (yields a new URL on tunnel)'),
  },
  handler: (params) => deploy(params),
});
