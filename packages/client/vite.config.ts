import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Dev proxy target. Not `PORT`: launchers set PORT for the Vite process itself.
const serverPort = Number(process.env.HEARTH_SERVER_PORT ?? 3100);

export default defineConfig({
  resolve: {
    alias: {
      '@hearth/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
      '@hearth/sim': fileURLToPath(new URL('../sim/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': { target: `http://127.0.0.1:${serverPort}`, changeOrigin: false },
      '/ws': { target: `ws://127.0.0.1:${serverPort}`, ws: true },
    },
  },
  build: {
    outDir: fileURLToPath(new URL('../../dist/client', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
});
