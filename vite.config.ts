import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: { output: { entryFileNames: 'app.js', assetFileNames: '[name][extname]', chunkFileNames: '[name].js' } },
  },
  worker: { format: 'iife', rollupOptions: { output: { entryFileNames: 'chem-worker.js' } } },
});
