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
    // Default: 8 workers in CI, auto-detect locally
    return process.env.CI ? 8 : undefined;
  })(),
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
    video: process.env.CI ? 'retain-on-failure' : 'off',

    /* Maximum time each action can take */
    actionTimeout: 15000, // Increased to 15s

    /* Give browser more time to start on CI */
    navigationTimeout: process.env.CI ? 30000 : 20000, // Increased timeouts

    /* Run in headless mode for better performance */
    headless: true,

    /* Viewport size */
    viewport: { width: 1280, height: 720 },

    /* Ignore HTTPS errors */
    ignoreHTTPSErrors: true,

    /* Browser launch options for better performance */
    launchOptions: {
      args: [
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-dev-shm-usage',
        '--no-sandbox',
      ],
    },
  },

  /* Configure projects for major browsers */
  projects: [
    // Parallel tests - these tests create their own isolated sessions
    {
      name: 'chromium-parallel',
      use: { ...devices['Desktop Chrome'] },
      testMatch: [
        '**/session-creation.spec.ts',
        '**/basic-session.spec.ts',
        '**/minimal-session.spec.ts',
        '**/debug-session.spec.ts',
        '**/ui-features.spec.ts',
        '**/test-session-persistence.spec.ts',
        '**/session-navigation.spec.ts',
        '**/session-management.spec.ts',
        '**/session-management-advanced.spec.ts',
        '**/file-browser-basic.spec.ts',
        '**/ssh-key-manager.spec.ts',
        '**/push-notifications.spec.ts',
        '**/authentication.spec.ts',
        '**/activity-monitoring.spec.ts',
      ],
    },
    // Serial tests - these tests perform global operations or modify shared state
    {
      name: 'chromium-serial',
      use: { ...devices['Desktop Chrome'] },
      testMatch: [
        '**/session-management-global.spec.ts',
        '**/keyboard-shortcuts.spec.ts',
        '**/terminal-interaction.spec.ts',
      ],
      fullyParallel: false, // Override global setting for serial tests
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: `pnpm exec tsx src/cli.ts --no-auth --port ${testConfig.port}`, // Use tsx everywhere
    port: testConfig.port,
    reuseExistingServer: !process.env.CI, // Reuse server locally for faster test runs
    stdout: process.env.CI ? 'inherit' : 'pipe', // Show output in CI for debugging
    stderr: process.env.CI ? 'inherit' : 'pipe', // Show errors in CI for debugging
    timeout: 60 * 1000, // 1 minute for server startup (reduced from 3 minutes)
    cwd: process.cwd(), // Ensure we're in the right directory
    env: {
      ...process.env, // Include all existing env vars
      NODE_ENV: 'test',
      VIBETUNNEL_DISABLE_PUSH_NOTIFICATIONS: 'true',
      SUPPRESS_CLIENT_ERRORS: 'true',
      VIBETUNNEL_SEA: '', // Explicitly set to empty to disable SEA loader
    },
  },
});