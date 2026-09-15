// Empacota servidor MCP, host e CLI em arquivos únicos sem dependências (dist/), para o plugin funcionar sem npm install.
import { build } from 'esbuild';
const common = { bundle: true, platform: 'node', format: 'esm', target: 'node20', minify: false, legalComments: 'none',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } };
await build({ ...common, entryPoints: ['src/server.js'], outfile: 'dist/server.js' });
await build({ ...common, entryPoints: ['src/host.js'], outfile: 'dist/host.js' });
await build({ ...common, entryPoints: ['bin/cloudfact.js'], outfile: 'dist/cloudfact.js', banner: common.banner });
console.log('dist/ ok');
