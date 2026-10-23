import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // The desktop app's development mode expects this exact port (src-tauri/tauri.conf.json).
  // docs/ holds the README pictures; the picture scripts write there while the page is open, so don't reload it
  server: { port: 5173, strictPort: true, watch: { ignored: ['**/docs/**'] } },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: {
      // the app, and the audience's window for presenter view
      input: { app: 'index.html', audience: 'audience.html' },
      output: { entryFileNames: '[name].js', assetFileNames: '[name][extname]', chunkFileNames: '[name].js' },
    },
  },
  worker: { format: 'iife', rollupOptions: { output: { entryFileNames: '[name].js' } } },
});
