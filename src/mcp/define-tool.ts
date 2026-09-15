import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ZodRawShape, objectOutputType, ZodTypeAny } from 'zod';

export interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
}

export interface ToolDefinition<Schema extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  annotations: ToolAnnotations;
  schema: Schema;
  handler: (params: objectOutputType<Schema, ZodTypeAny>) => Promise<unknown>;
}

/** Identidade tipada: garante que `handler` recebe os params do `schema`. */
export function defineTool<Schema extends ZodRawShape>(def: ToolDefinition<Schema>): ToolDefinition<Schema> {
  return def;
}

export function textResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

export function errorResult(err: unknown): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: `erro: ${(err as Error).message ?? String(err)}` }] };
}
