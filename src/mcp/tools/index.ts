import type { ToolDefinition } from '../define-tool.js';
import { deployTool } from './deploy.js';
import { exposeTool } from './expose.js';
import { doctorTool, listTool, logsTool, removeTool, statusTool, stopTool } from './manage.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const tools: ToolDefinition<any>[] = [deployTool, exposeTool, listTool, statusTool, stopTool, removeTool, logsTool, doctorTool];
