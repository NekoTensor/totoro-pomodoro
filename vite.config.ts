import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// The renderer is a single page loaded from disk in production, so every asset
// must be referenced relatively (`base: './'`) or file:// loading breaks.
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome128',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: resolve(__dirname, 'src/renderer/index.html'),
    },
  },
  server: {
    port: 5273,
    strictPort: true,
  },
});
