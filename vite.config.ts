import { defineConfig } from 'vite';

// In development the API runs separately (server/node.ts on :8787); Vite forwards /api to it.
export default defineConfig({
  server: { proxy: { '/api': { target: 'http://localhost:8787', ws: true } } },
  // three.js alone is ~550 kB; that's expected
  build: { target: 'es2020', chunkSizeWarningLimit: 700 },
});
