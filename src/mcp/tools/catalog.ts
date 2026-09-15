import { z } from 'zod';
import { catalog, publishCatalog, setCredentials, setProject } from '../../cloudfact.js';
import { defineTool } from '../define-tool.js';

export const catalogTool = defineTool({
  name: 'catalog',
  description:
    "Every cloudfact in the user's Cloudflare account, grouped by project, as the account itself sees them (so deploys made from another machine show up too). Each entry says whether it is public, a private key link or behind Cloudflare Access sign-in, and whether it serves static files or an app with its own server. Quick tunnels have no account-side resource and appear only when this machine still has their record (inAccount=false). publish=true turns the catalog into a browsable page and returns its URL; that page asks for Cloudflare Access sign-in by default, for the email that owns the account.",
  annotations: { title: 'Account catalog', readOnlyHint: false },
  schema: {
    project: z.string().optional().describe('Only deploys filed under this project'),
    publish: z.boolean().optional().describe('Publish the catalog as a page and return its URL'),
    access: z
      .array(z.string())
      .optional()
      .describe('With publish: emails allowed to sign in to the catalog page (default: the account owner)'),
  },
  handler: ({ project, publish, access }) => (publish ? publishCatalog({ project, access }) : catalog({ project })),
});

export const projectTool = defineTool({
  name: 'project',
  description: 'File a deploy under a project in the account catalog (or pass project=null to clear it). Takes effect without redeploying.',
  annotations: { title: 'Set project', readOnlyHint: false, idempotentHint: true },
  schema: {
    name: z.string().describe('Deploy name'),
    project: z.string().nullable().describe('Project name, or null to clear'),
  },
  handler: ({ name, project }) => setProject(name, project),
});

export const credentialsTool = defineTool({
  name: 'credentials',
  description:
    "Record how to get into the app behind a deploy (its own username/password/note, not cloudfact's). Stored with the deploy on this machine and shown only on a catalog page that is itself behind Cloudflare Access sign-in. Pass creds=null to clear. Never put the user's secrets in your reply.",
  annotations: { title: 'Set app login', readOnlyHint: false, idempotentHint: true },
  schema: {
    name: z.string().describe('Deploy name'),
    user: z.string().nullable().optional().describe("The app's username"),
    password: z.string().nullable().optional().describe("The app's password"),
    note: z.string().nullable().optional().describe('Anything else needed to get in'),
    clear: z.boolean().optional().describe('Forget the stored login'),
  },
  handler: async ({ name, user, password, note, clear }) => setCredentials(name, clear ? null : { user, password, note }),
});
