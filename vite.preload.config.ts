import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// The preload runs in a SANDBOXED context, where `require()` is limited to
// `electron` and relative requires do not resolve at all. So it is bundled
// into one self-contained CommonJS file, inlining the shared constants it
// needs instead of importing them at runtime.
export default defineConfig({
  build: {
    outDir: resolve(__dirname, 'dist/preload'),
    emptyOutDir: true,
    minify: false,
    target: 'node20',
    lib: {
      entry: resolve(__dirname, 'src/preload/preload.ts'),
      formats: ['cjs'],
      fileName: () => 'preload.js',
    },
    rollupOptions: {
      external: ['electron'],
    },
  },
});
