import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    environmentMatchGlobs: [
      // Use happy-dom for client-side component tests
      ['src/client/**/*.test.ts', 'happy-dom'],
      // Use node for server-side and e2e tests
      ['src/server/**/*.test.ts', 'node'],
      ['src/test/e2e/**/*.test.ts', 'node'],
    ],
    setupFiles: ['./src/test/setup.ts'],
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