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
      // Same reason for each format brick a test reads. A test that imports a
      // brick imports it by its published name, so what it exercises is what a
      // stranger installs, and not a relative path into a folder.
      '@ekwo-ai/fec': fileURLToPath(
        new URL('./packages/formats/fec/src/index.ts', import.meta.url),
      ),
      '@ekwo-ai/xbrl-cbso': fileURLToPath(
        new URL('./packages/formats/xbrl-cbso/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    // The core's tests, the tests each format brick brought with it, and the
    // tests of each module. A brick and a module are published on their own,
    // so their suites stay where they live; one `npm test` has to run all
    // three, or one of them breaks where nobody looks.
    include: [
      'tests/**/*.test.ts',
      'packages/formats/*/test/**/*.test.ts',
      'modules/*/tests/**/*.test.ts',
    ],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
