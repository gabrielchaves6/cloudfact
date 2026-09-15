import fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tmpDir } from './helpers.js';

let home: string;
let client: Client;
beforeAll(async () => {
  home = tmpDir();
  process.env.CLOUDFACT_HOME = home;
  const { createServer } = await import('../src/mcp/server.js');
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer().connect(a);
  client = new Client({ name: 'test', version: '0' });
  await client.connect(b);
});
afterAll(async () => {
  await client.close();
  fs.rmSync(home, { recursive: true, force: true });
});

const text = (r: Awaited<ReturnType<Client['callTool']>>) => (r.content as { text: string }[])[0].text;

describe('MCP server', () => {
  it('exposes the tools with annotations', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['deploy', 'doctor', 'expose', 'list', 'logs', 'remove', 'status', 'stop']);
    expect(tools.find((t) => t.name === 'list')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'remove')?.annotations?.destructiveHint).toBe(true);
  });
  it('doctor and list answer JSON', async () => {
    const d = JSON.parse(text(await client.callTool({ name: 'doctor', arguments: {} })));
    expect(['tunnel', 'workers']).toContain(d.defaultBackend);
    expect(JSON.parse(text(await client.callTool({ name: 'list', arguments: {} })))).toEqual([]);
  });
  it('errors become isError, not exceptions', async () => {
    const r = await client.callTool({ name: 'status', arguments: { name: 'nao-existe' } });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('does not exist');
  });
  it('deploy of a missing path fails with a clear message', async () => {
    const r = await client.callTool({ name: 'deploy', arguments: { path: '/path/that/does/not/exist' } });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('does not exist');
  });
});
