import { defineConfig } from 'vitest/config';

// `npm run eval`: accuracy benchmark against the personal test data in test-data/.
export default defineConfig({
  test: {
    include: ['eval/**/*.eval.ts'],
    testTimeout: 600_000,
    hookTimeout: 120_000,
  },
});
