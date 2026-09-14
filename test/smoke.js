// Sobe o servidor MCP via stdio, lista as tools e chama doctor + list.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const client = new Client({ name: 'smoke', version: '0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'src/server.js')] }));
const tools = (await client.listTools()).tools.map((t) => t.name);
console.log('tools:', tools.join(', '));
for (const need of ['deploy', 'list', 'status', 'stop', 'remove', 'logs', 'doctor']) if (!tools.includes(need)) throw new Error('faltou tool ' + need);
const doctor = JSON.parse((await client.callTool({ name: 'doctor', arguments: {} })).content[0].text);
console.log('doctor.defaultBackend:', doctor.defaultBackend);
const list = await client.callTool({ name: 'list', arguments: {} });
console.log('list ok:', Array.isArray(JSON.parse(list.content[0].text)));
const bad = await client.callTool({ name: 'status', arguments: { name: 'nao-existe' } });
if (!bad.isError) throw new Error('status de deploy inexistente devia dar isError');
console.log('erro tratado ok');
await client.close();
console.log('smoke OK');
