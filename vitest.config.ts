import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // `packages/mcp` depends on `@ekwo-ai/core` the way a published package
      // does. In this repository the tests read its source instead of its
      // build, so `npm test` never depends on `npm run build` having run —
      // which is the order the CI uses, and the order a fresh clone has.
      '@ekwo-ai/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
