import { defineConfig, devices } from '@playwright/test';
import { testConfig } from './src/test/playwright/test-config';

/**
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
  /* Run tests in files in parallel */
  fullyParallel: false, // Start with sequential execution for stability
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: 1, // Force single worker to avoid race conditions
  /* Test timeout */
  timeout: process.env.CI ? 60 * 1000 : 30 * 1000, // 60s on CI, 30s locally
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
    video: 'on-first-retry',

    /* Maximum time each action can take */
    actionTimeout: testConfig.actionTimeout,

    /* Give browser more time to start on CI */
    navigationTimeout: testConfig.actionTimeout,
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: `node dist/vibetunnel-cli --no-auth --port ${testConfig.port}`,
    port: testConfig.port,
    reuseExistingServer: false, // Always use the configured port 4022
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 180 * 1000, // 3 minutes for server startup
    env: {
      NODE_ENV: 'test',
      VIBETUNNEL_DISABLE_PUSH_NOTIFICATIONS: 'true',
      SUPPRESS_CLIENT_ERRORS: 'true',
    },
  },
});