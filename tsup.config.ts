import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  // Single entry point — no benefit to code splitting; keeps output simple.
  splitting: false,
  treeshake: true,
  minify: false,
  target: 'es2020',
  outDir: 'dist',
  shims: true,
})
