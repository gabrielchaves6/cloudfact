// Servidor MCP (stdio) do cloudfact. Tools: deploy, list, status, stop, remove, logs, doctor.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as cf from './lib.js';

const server = new McpServer({ name: 'cloudfact', version: cf.VERSION });
const text = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, 2) }] });
const wrap = (fn) => async (args) => {
  try { return text(await fn(args)); }
  catch (e) { return { isError: true, content: [{ type: 'text', text: `erro: ${e.message}` }] }; }
};

server.registerTool('deploy', {
  title: 'Publicar página estática',
  description: 'Publica uma pasta (ou um único .html) da VM em uma URL pública na Cloudflare. Backend "tunnel" (padrão sem conta): servidor local + cloudflared quick tunnel, URL *.trycloudflare.com, processo fica vivo em background e sobrevive ao fim da sessão. Backend "pages": Cloudflare Pages (URL fixa *.pages.dev), exige CLOUDFLARE_API_TOKEN. Idempotente: se o mesmo caminho já está no ar, devolve a URL existente. Devolve JSON com url (e privateUrl quando private=true, que já inclui #key=...).',
  inputSchema: {
    path: z.string().describe('Caminho absoluto da pasta ou do arquivo .html a publicar'),
    name: z.string().optional().describe('Nome do deploy (slug). Padrão: nome da pasta/arquivo'),
    private: z.boolean().optional().describe('Protege com chave: só quem abrir o privateUrl (#key=...) vê o conteúdo'),
    backend: z.enum(['auto', 'tunnel', 'pages']).optional().describe('auto = pages se houver token configurado, senão tunnel'),
    restart: z.boolean().optional().describe('Força reiniciar mesmo se já estiver no ar (gera URL nova no túnel)'),
  },
}, wrap((a) => cf.deploy(a)));

server.registerTool('list', {
  title: 'Listar deploys',
  description: 'Lista todos os deploys do cloudfact com status e URL.',
  inputSchema: {},
}, wrap(() => cf.listDeploys().map(({ key, ...s }) => s)));

server.registerTool('status', {
  title: 'Status de um deploy',
  description: 'Estado de um deploy, incluindo checagem HTTP da URL pública.',
  inputSchema: { name: z.string() },
}, wrap((a) => cf.status(a.name)));

server.registerTool('stop', {
  title: 'Parar deploy',
  description: 'Encerra o servidor local e o túnel de um deploy (ou de todos com all=true). O registro fica para consulta.',
  inputSchema: { name: z.string().optional(), all: z.boolean().optional() },
}, wrap((a) => (a.all ? cf.stopAll() : cf.stop(a.name))));

server.registerTool('remove', {
  title: 'Remover deploy',
  description: 'Para (se estiver rodando) e apaga o registro e logs do deploy.',
  inputSchema: { name: z.string() },
}, wrap((a) => cf.remove(a.name)));

server.registerTool('logs', {
  title: 'Logs de um deploy',
  description: 'Últimas linhas dos logs do host, do cloudflared e do wrangler.',
  inputSchema: { name: z.string(), lines: z.number().int().min(1).max(500).optional() },
}, wrap((a) => cf.logs(a.name, a.lines ?? 40)));

server.registerTool('doctor', {
  title: 'Diagnóstico',
  description: 'Verifica cloudflared, credenciais do Pages, backend padrão e deploys ativos.',
  inputSchema: {},
}, wrap(() => cf.doctor()));

server.registerPrompt('cloudfact', {
  title: 'Publicar na Cloudflare',
  description: 'Publica um caminho da VM e devolve a URL',
  argsSchema: { path: z.string().describe('pasta ou .html') },
}, ({ path }) => ({
  messages: [{ role: 'user', content: { type: 'text', text: `Publique ${path} com a tool cloudfact deploy e me devolva a URL pública. Se falhar, rode doctor e logs e explique.` } }],
}));

await server.connect(new StdioServerTransport());
