import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@hearth/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
      '@hearth/sim': fileURLToPath(new URL('./packages/sim/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
  },
});
