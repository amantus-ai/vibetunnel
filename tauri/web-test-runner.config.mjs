import { playwrightLauncher } from '@web/test-runner-playwright';

export default {
  files: 'src/**/*.test.ts',
  nodeResolve: true,
  browsers: [
    playwrightLauncher({ product: 'chromium' }),
    playwrightLauncher({ product: 'webkit' }),
  ],
  coverageConfig: {
    include: ['src/**/*.ts'],
    exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
    threshold: {
      statements: 80,
      branches: 70,
      functions: 80,
      lines: 80
    }
  },
  testFramework: {
    config: {
      ui: 'bdd',
      timeout: 5000
    }
  }
};