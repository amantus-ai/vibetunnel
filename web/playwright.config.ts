import { defineConfig, devices } from '@playwright/test';
import { testConfig } from './src/test/playwright/test-config';

/**
 * Playwright Test Configuration
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './src/test/playwright',
  
  /* Global setup */
  globalSetup: require.resolve('./src/test/playwright/global-setup.ts'),
  globalTeardown: require.resolve('./src/test/playwright/global-teardown.ts'),
  /* Run tests in files in parallel */
  fullyParallel: true, // Enable parallel execution for better performance
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Parallel workers configuration */
  workers: (() => {
    if (process.env.PLAYWRIGHT_WORKERS) {
      const parsed = parseInt(process.env.PLAYWRIGHT_WORKERS, 10);
      // Validate the parsed value
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
      console.warn(`Invalid PLAYWRIGHT_WORKERS value: "${process.env.PLAYWRIGHT_WORKERS}". Using default.`);
    }
    // Default: 1 worker in CI to prevent race conditions, auto-detect locally
    // This ensures test groups run sequentially, preventing session conflicts
    return process.env.CI ? 1 : undefined;
  })(),
  /* Test timeout - reduced for faster failure detection */
  timeout: process.env.CI ? 20 * 1000 : 10 * 1000, // 20s on CI, 10s locally
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['html', { open: 'never' }],
    process.env.CI ? ['github'] : ['list'],
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: testConfig.baseURL,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Take screenshot on failure */
    screenshot: 'only-on-failure',

    /* Capture video on failure */
    video: process.env.CI ? 'retain-on-failure' : 'off',

    /* Maximum time each action can take - reduced for faster feedback */
    actionTimeout: process.env.CI ? 5000 : 3000, // 5s on CI, 3s locally

    /* Navigation timeout - reduced for faster page load detection */
    navigationTimeout: process.env.CI ? 10000 : 5000, // 10s on CI, 5s locally

    /* Run in headless mode for better performance */
    headless: true,

    /* Viewport size */
    viewport: { width: 1280, height: 1200 },

    /* Ignore HTTPS errors */
    ignoreHTTPSErrors: true,

    /* Browser launch options for better performance */
    launchOptions: {
      args: [
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-extensions',
        '--disable-plugins',
        '--disable-images', // Don't load images for faster tests
        '--disable-javascript-harmony-shipping',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
      ],
    },
  },

  /* Configure single browser project */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: [
        '**/git-status-badge-debug.spec.ts', // Skip debug-only tests
      ],
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: `node scripts/test-server.js --no-auth --port ${testConfig.port}`, // Use test server script
    port: testConfig.port,
    reuseExistingServer: !process.env.CI, // Reuse server locally for faster test runs
    stdout: process.env.CI ? 'inherit' : 'ignore', // Reduce noise locally
    stderr: process.env.CI ? 'inherit' : 'pipe', // Show errors in CI for debugging
    timeout: 20 * 1000, // 20 seconds for server startup - reduced for faster feedback
    cwd: process.cwd(), // Ensure we're in the right directory
    env: (() => {
      const env = { ...process.env };
      // Keep VIBETUNNEL_SEA if it's set in CI, as we now use the native executable for tests
      // In local development, it will be undefined and tests will use TypeScript compilation
      return {
        ...env,
        NODE_ENV: 'test',
        VIBETUNNEL_DISABLE_PUSH_NOTIFICATIONS: 'true',
        SUPPRESS_CLIENT_ERRORS: 'true',
        SHELL: '/bin/bash',
        TERM: 'xterm',
      };
    })(),
  },
});