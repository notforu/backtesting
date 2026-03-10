import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 60000, // 60 seconds for backtests
    hookTimeout: 60000,
    // Use threads pool instead of forks to avoid shared memory issues in Docker
    // threads pool uses less memory and doesn't require /dev/shm allocation
    pool: 'threads',
    // Vitest 4: pool options moved to top level (no longer poolOptions)
    singleThread: true,
    isolate: true,
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/analysis/**'],
      exclude: ['**/__tests__/**', '**/*.test.ts'],
      reporter: ['text', 'text-summary'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
