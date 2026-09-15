import { z } from 'zod';
import { doctor, listDeploys, readLogs, remove, status, stop, stopAll, summarize } from '../../cloudfact.js';
import { defineTool } from '../define-tool.js';

export const listTool = defineTool({
  name: 'list',
  description: 'Lista todos os deploys do cloudfact com backend, status e URL.',
  annotations: { title: 'Listar deploys', readOnlyHint: true },
  schema: {},
  handler: async () => listDeploys().map(summarize),
});

export const statusTool = defineTool({
  name: 'status',
  description: 'Estado de um deploy, incluindo checagem HTTP da URL pública (reachable/httpStatus).',
  annotations: { title: 'Status de um deploy', readOnlyHint: true },
  schema: { name: z.string().describe('Nome do deploy') },
  handler: ({ name }) => status(name),
});

export const stopTool = defineTool({
  name: 'stop',
  description:
    'Encerra o servidor local e o túnel de um deploy (ou de todos com all=true). O registro fica para consulta. Não se aplica ao backend workers.',
  annotations: { title: 'Parar deploy', readOnlyHint: false, destructiveHint: false },
  schema: { name: z.string().optional().describe('Nome do deploy'), all: z.boolean().optional().describe('Parar todos os túneis') },
  handler: ({ name, all }) => {
    if (all) return stopAll();
    if (!name) throw new Error('informe name ou all=true');
    return stop(name);
  },
});

export const removeTool = defineTool({
  name: 'remove',
  description: 'Para (se estiver rodando) e apaga o registro e logs do deploy. No backend workers, apaga também o worker na Cloudflare.',
  annotations: { title: 'Remover deploy', readOnlyHint: false, destructiveHint: true },
  schema: { name: z.string().describe('Nome do deploy') },
  handler: ({ name }) => remove(name),
});

export const logsTool = defineTool({
  name: 'logs',
  description: 'Últimas linhas dos logs do deploy: host (servidor local), cloudflared e wrangler.',
  annotations: { title: 'Logs de um deploy', readOnlyHint: true },
  schema: {
    name: z.string().describe('Nome do deploy'),
    lines: z.number().int().min(1).max(500).optional().describe('Quantidade de linhas (padrão 40)'),
  },
  handler: async ({ name, lines }) => readLogs(name, lines ?? 40),
});

export const doctorTool = defineTool({
  name: 'doctor',
  description: 'Diagnóstico: cloudflared, login na Cloudflare, backend padrão e deploys ativos. Rode antes de deploy quando algo falhar.',
  annotations: { title: 'Diagnóstico', readOnlyHint: true },
  schema: {},
  handler: () => doctor(),
});
