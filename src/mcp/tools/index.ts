import type { ToolDefinition } from '../define-tool.js';
import { deployTool } from './deploy.js';
import { exposeTool } from './expose.js';
import { doctorTool, listTool, logsTool, removeTool, rotateTool, statusTool, stopTool } from './manage.js';
import { catalogTool, projectTool } from './catalog.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const tools: ToolDefinition<any>[] = [
  deployTool,
  exposeTool,
  listTool,
  catalogTool,
  projectTool,
  statusTool,
  rotateTool,
  stopTool,
  removeTool,
  logsTool,
  doctorTool,
];
