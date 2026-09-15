/** Entrada do servidor MCP via stdio. */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './mcp/server.js';

await createServer().connect(new StdioServerTransport());
