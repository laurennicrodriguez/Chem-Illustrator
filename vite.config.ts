import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // The desktop app's development mode expects this exact port (src-tauri/tauri.conf.json).
  server: { port: 5173, strictPort: true },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: { output: { entryFileNames: 'app.js', assetFileNames: '[name][extname]', chunkFileNames: '[name].js' } },
  },
  worker: { format: 'iife', rollupOptions: { output: { entryFileNames: 'chem-worker.js' } } },
});
