import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { VERSION } from '../config.js';
import { errorResult, textResult } from './define-tool.js';
import { tools } from './tools/index.js';

/** Monta o McpServer do cloudfact com todas as tools e o prompt. Transporte fica a cargo de quem chama. */
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
      title: 'Publicar na Cloudflare',
      description: 'Publica um caminho da máquina e devolve a URL',
      argsSchema: { path: z.string().describe('pasta ou .html') },
    },
    ({ path }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Publique ${path} com a tool deploy do cloudfact e me devolva a URL pública. Se falhar, rode doctor e logs e explique.`,
          },
        },
      ],
    }),
  );
  return server;
}
