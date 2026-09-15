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
    'Returns JSON with url and, when private=true, privateUrl (already includes #key=...).',
  annotations: { title: 'Publish static site', readOnlyHint: false, idempotentHint: true },
  schema: {
    path: z.string().describe('Absolute path of the folder or .html file to publish'),
    name: z.string().optional().describe('Deploy name (slug). Defaults to the folder/file name'),
    private: z
      .boolean()
      .optional()
      .describe('Key-protected: only whoever opens privateUrl (#key=...) sees the content. Forces the tunnel backend'),
    backend: z.enum(['auto', 'tunnel', 'workers']).optional().describe('auto = workers when signed in to Cloudflare, otherwise tunnel'),
    restart: z.boolean().optional().describe('Restart even if already live (yields a new URL on tunnel)'),
  },
  handler: (params) => deploy(params),
});
