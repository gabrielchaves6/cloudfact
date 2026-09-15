// Gera docs/tools.md a partir das definições das tools (dist/index.js). Rode após `npm run build`.
import fs from 'node:fs';
import { tools } from '../dist/index.js';

function describeType(schema) {
  const def = schema._def ?? {};
  const inner = def.innerType ?? def.schema;
  if (inner) return describeType(inner);
  if (def.typeName === 'ZodEnum') return def.values.map((v) => `\`${v}\``).join(' \\| ');
  return (def.typeName ?? 'unknown').replace(/^Zod/, '').toLowerCase();
}

let md = '# Tools\n\n_Generated from `src/mcp/tools` by `npm run docs`. Do not edit by hand._\n\n';
for (const tool of tools) {
  const a = tool.annotations;
  const flags = [
    a.readOnlyHint ? 'read-only' : 'mutating',
    a.destructiveHint ? 'destructive' : null,
    a.idempotentHint ? 'idempotent' : null,
  ].filter(Boolean);
  md += `## \`${tool.name}\` — ${a.title}\n\n${tool.description}\n\n_${flags.join(', ')}_\n\n`;
  const entries = Object.entries(tool.schema);
  if (!entries.length) {
    md += 'No parameters.\n\n';
    continue;
  }
  md += '| parameter | type | required | description |\n| --- | --- | --- | --- |\n';
  for (const [key, schema] of entries) {
    md += `| \`${key}\` | ${describeType(schema)} | ${schema.isOptional() ? 'no' : 'yes'} | ${schema.description ?? ''} |\n`;
  }
  md += '\n';
}
fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/tools.md', md);
console.log(`docs/tools.md: ${tools.length} tools`);
