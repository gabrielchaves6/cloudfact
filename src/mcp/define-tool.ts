import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { z, ZodRawShape } from 'zod';

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
  handler: (params: z.infer<z.ZodObject<Schema>>) => Promise<unknown>;
}

/** Typed identity: guarantees `handler` receives the params described by `schema`. */
export function defineTool<Schema extends ZodRawShape>(def: ToolDefinition<Schema>): ToolDefinition<Schema> {
  return def;
}

export function textResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

export function errorResult(err: unknown): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: `error: ${(err as Error).message ?? String(err)}` }] };
}
