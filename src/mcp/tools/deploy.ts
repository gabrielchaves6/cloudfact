import { z } from 'zod';
import { deploy } from '../../cloudfact.js';
import { defineTool } from '../define-tool.js';

export const deployTool = defineTool({
  name: 'deploy',
  description:
    'Publica uma pasta (ou um único .html) da máquina em uma URL pública na Cloudflare. ' +
    'Backend "tunnel" (padrão sem login): servidor local + cloudflared quick tunnel, URL *.trycloudflare.com; o processo fica em background e sobrevive ao fim da sessão. ' +
    'Backend "workers" (padrão quando logado): Cloudflare Workers com assets estáticos, URL fixa https://<nome>.<sub>.workers.dev; republicar atualiza no mesmo endereço. ' +
    'No tunnel é idempotente: se o mesmo caminho já está no ar, devolve a URL existente (reused=true). ' +
    'Devolve JSON com url e, quando private=true, privateUrl (já inclui #key=...).',
  annotations: { title: 'Publicar página estática', readOnlyHint: false, idempotentHint: true },
  schema: {
    path: z.string().describe('Caminho absoluto da pasta ou do arquivo .html a publicar'),
    name: z.string().optional().describe('Nome do deploy (slug). Padrão: nome da pasta/arquivo'),
    private: z
      .boolean()
      .optional()
      .describe('Protege com chave: só quem abrir o privateUrl (#key=...) vê o conteúdo. Força o backend tunnel'),
    backend: z.enum(['auto', 'tunnel', 'workers']).optional().describe('auto = workers se logado na Cloudflare, senão tunnel'),
    restart: z.boolean().optional().describe('Força reiniciar mesmo se já estiver no ar (gera URL nova no tunnel)'),
  },
  handler: (params) => deploy(params),
});
