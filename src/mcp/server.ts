import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { VERSION } from '../config.js';
import { errorResult, textResult } from './define-tool.js';
import { tools } from './tools/index.js';

/** Builds the cloudfact McpServer with every tool and the prompt. The caller picks the transport. */
export function createServer(): McpServer {
  const server = new McpServer({ name: 'cloudfact', version: VERSION });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { title: tool.annotations.title, description: tool.description, inputSchema: tool.schema, annotations: tool.annotations },
      async (params: Record<string, unknown>) => {
        try {
          return textResult(await tool.handler(params));
        } catch (err) {
          return errorResult(err);
        }
      },
    );
  }
  server.registerPrompt(
    'cloudfact',
    {
      title: 'Publish to Cloudflare',
      description: 'Publish a path from this machine and return the URL',
      argsSchema: { path: z.string().describe('folder or .html file') },
    },
    ({ path }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Publish ${path} with the cloudfact deploy tool and give me the public URL. If it fails, run doctor and logs and explain.`,
          },
        },
      ],
    }),
  );
  return server;
}
