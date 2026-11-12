import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Bundle workspace packages; keep real npm deps (some are native) external.
  noExternal: [/^@f1archive\//],
});
