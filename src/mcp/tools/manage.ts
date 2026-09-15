import { z } from 'zod';
import { doctor, listDeploys, readLogs, remove, rotate, status, stop, stopAll, summarize } from '../../cloudfact.js';
import { defineTool } from '../define-tool.js';

export const listTool = defineTool({
  name: 'list',
  description: 'List every cloudfact deploy with backend, status and URL.',
  annotations: { title: 'List deploys', readOnlyHint: true },
  schema: {},
  handler: async () => listDeploys().map(summarize),
});

export const statusTool = defineTool({
  name: 'status',
  description: 'State of one deploy, including an HTTP check of its public URL (reachable/httpStatus).',
  annotations: { title: 'Deploy status', readOnlyHint: true },
  schema: { name: z.string().describe('Deploy name') },
  handler: ({ name }) => status(name),
});

export const stopTool = defineTool({
  name: 'stop',
  description:
    'Stop the local server and tunnel of one deploy (or all of them with all=true). The record is kept for inspection. Not applicable to the workers backend.',
  annotations: { title: 'Stop deploy', readOnlyHint: false, destructiveHint: false },
  schema: { name: z.string().optional().describe('Deploy name'), all: z.boolean().optional().describe('Stop every tunnel') },
  handler: ({ name, all }) => {
    if (all) return stopAll();
    if (!name) throw new Error('pass name or all=true');
    return stop(name);
  },
});

export const removeTool = defineTool({
  name: 'remove',
  description: 'Stop (if running) and delete the deploy record and logs. On the workers backend, also deletes the worker on Cloudflare.',
  annotations: { title: 'Remove deploy', readOnlyHint: false, destructiveHint: true },
  schema: { name: z.string().describe('Deploy name') },
  handler: ({ name }) => remove(name),
});

export const logsTool = defineTool({
  name: 'logs',
  description: 'Last lines of the deploy logs: host (local server), cloudflared and wrangler.',
  annotations: { title: 'Deploy logs', readOnlyHint: true },
  schema: {
    name: z.string().describe('Deploy name'),
    lines: z.number().int().min(1).max(500).optional().describe('Number of lines (default 40)'),
  },
  handler: async ({ name, lines }) => readLogs(name, lines ?? 40),
});

export const rotateTool = defineTool({
  name: 'rotate',
  description:
    'Issue a new private key for a live tunnel deploy without restarting it: the previous link and all sessions stop working at once. Optionally set an expiry. On a public deploy this turns it private. Returns the new privateUrl.',
  annotations: { title: 'Rotate private key', readOnlyHint: false, idempotentHint: false },
  schema: {
    name: z.string().describe('Deploy name'),
    expires: z.string().optional().describe('New key lifetime, e.g. "24h" (default: never)'),
  },
  handler: ({ name, expires }) => rotate(name, { expires }),
});

export const doctorTool = defineTool({
  name: 'doctor',
  description:
    'Diagnostics: cloudflared, Cloudflare sign-in, default backend and active deploys. Run it before deploy when something fails.',
  annotations: { title: 'Diagnostics', readOnlyHint: true },
  schema: {},
  handler: () => doctor(),
});
