import { defineConfig } from 'tsup';

// Each entry is a single file with no external runtime dependencies:
// server.js (MCP over stdio), bin.js (CLI), host.js (tunnel process spawned by the core), index.js (library).
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
