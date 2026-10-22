import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL, TEST_DATABASE_MIGRATION_URL } from './test/test-env.js';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    fileParallelism: false,
    globalSetup: ['test/global-setup.js'],
    env: { TEST_DATABASE_URL, TEST_DATABASE_MIGRATION_URL },
  },
});
