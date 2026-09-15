import { defineConfig } from 'tsup';

// Três entradas, cada uma um arquivo único sem dependências externas em runtime:
// server.js (MCP stdio), bin.js (CLI), host.js (processo do túnel, spawnado pelo core).
export default defineConfig({
  entry: { server: 'src/server.ts', bin: 'src/bin.ts', host: 'src/backends/tunnel/host.ts', index: 'src/index.ts' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  splitting: false,
  sourcemap: false,
  dts: { entry: { index: 'src/index.ts' } },
  noExternal: [/.*/],
  banner: { js: "import { createRequire as __cloudfactRequire } from 'node:module'; const require = __cloudfactRequire(import.meta.url);" },
});
