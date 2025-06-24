import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    // Set default environment
    environment: 'node',
    // Override environment for specific test files
    environmentMatchGlobs: [
      ['**/buffer-subscription-service.test.ts', 'happy-dom'],
      ['src/client/**/*.test.ts', 'happy-dom'],
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'src/test/',
        'dist/',
        'public/',
        '*.config.ts',
        '*.config.js',
        '**/*.test.ts',
        '**/*.spec.ts',
      ],
      include: [
        'src/**/*.ts',
        'src/**/*.js',
      ],
      all: true,
      lines: 80,
      functions: 80,
      branches: 80,
      statements: 80,
    },
    testTimeout: 60000, // 60s for e2e tests
    hookTimeout: 30000, // 30s for setup/teardown
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});