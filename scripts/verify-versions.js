// Falha se a versão divergir entre package.json, server.json e os manifestos do plugin.
import fs from 'node:fs';
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const pkg = read('package.json').version;
const found = {
  'package.json': pkg,
  'server.json': read('server.json').version,
  'server.json packages[0]': read('server.json').packages[0].version,
  '.claude-plugin/plugin.json': read('.claude-plugin/plugin.json').version,
  '.claude-plugin/marketplace.json plugins[0]': read('.claude-plugin/marketplace.json').plugins[0].version,
};
const bad = Object.entries(found).filter(([, v]) => v !== pkg);
if (bad.length) {
  console.error(`versão esperada ${pkg}; divergentes:\n` + bad.map(([k, v]) => `  ${k}: ${v}`).join('\n'));
  process.exit(1);
}
console.log(`versões sincronizadas: ${pkg}`);
