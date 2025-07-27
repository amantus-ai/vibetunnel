import { defineConfig } from 'vitest/config';
import path from 'path';
import { readFileSync } from 'fs';

// Get version from package.json for __APP_VERSION__ definition
const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));
const version = packageJson.version;

// For Vitest 3.x, we need to use workspace configuration instead of projects
// Create separate configs that can be selected via CLI flags

export default defineConfig(({ mode }) => {
  const isClient = mode === 'client' || (typeof process !== 'undefined' && process.env?.VITEST_MODE === 'client');
  const isServer = mode === 'server' || (typeof process !== 'undefined' && process.env?.VITEST_MODE === 'server');
  
  // Default to running all tests if no mode specified
  const testInclude = isClient 
    ? ['src/client/**/*.test.ts']
    : isServer 
    ? ['src/server/**/*.test.ts', 'src/test/e2e/**/*.test.ts', 'src/test/unit/**/*.test.ts']
    : ['src/**/*.test.ts'];
    
  const coverageInclude = isClient
    ? ['src/client/**/*.ts']
    : isServer
    ? ['src/server/**/*.ts']
    : ['src/**/*.ts'];
    
  const coverageDir = isClient
    ? './coverage/client'
    : isServer
    ? './coverage/server'
    : './coverage';
    
  // No thresholds - we just want to report coverage without failing builds
  
  // Add memory reporter when MEMORY_LOG env var is set
  const reporters = process.env.MEMORY_LOG 
    ? ['default', './src/test/memory-reporter.ts']
    : ['default'];

  return {
    define: {
      __APP_VERSION__: JSON.stringify(version),
    },
    test: {
      globals: true,
      include: testInclude,
      setupFiles: ['./src/test/setup.ts'],
      environment: isClient ? 'happy-dom' : 'node',
      testTimeout: 10000, // 10s for tests
      hookTimeout: 10000, // 10s for setup/teardown
      reporters,
      poolOptions: {
        threads: {
          // Use available CPU cores for parallel execution
          maxThreads: undefined,
          minThreads: 1,
        },
        forks: {
          // Allow multiple forks for better test isolation
          maxForks: undefined,
          minForks: 1,
        }
      },
      isolate: true, // Isolate tests in separate contexts
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
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
        include: coverageInclude,
        all: true,
        reportsDirectory: coverageDir,
        // No thresholds - just report coverage
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  };
});