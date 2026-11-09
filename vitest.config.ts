import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

/**
 * Unit tests: tests/unit/**. Tests that touch the database use TEST_DATABASE_URL
 * (default: the local `doom_test` DB) — never the development database.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    resolve: {
      alias: {
        '@': path.resolve(__dirname),
        // `server-only` throws outside the react-server condition; harmless in tests.
        'server-only': path.resolve(__dirname, 'tests/unit/stubs/server-only.ts'),
      },
    },
    test: {
      include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
      environment: 'node',
      testTimeout: 20_000,
      hookTimeout: 30_000,
      fileParallelism: false,
      env: {
        ...env,
        NODE_ENV: 'test',
        DATABASE_URL: env.TEST_DATABASE_URL || 'postgresql://postgres@localhost:5432/doom_test',
        KYC_ENCRYPTION_KEY: env.KYC_ENCRYPTION_KEY || 'U0rYnOQheDJ4Dvi2QICW3TrDgAsEggE4SDc0LngyAtM=',
        SESSION_SECRET: env.SESSION_SECRET || 'test-session-secret-at-least-32-characters-long',
      },
    },
  };
});
