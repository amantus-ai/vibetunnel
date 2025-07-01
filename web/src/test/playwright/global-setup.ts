import { chromium, type FullConfig } from '@playwright/test';
import { testConfig } from './test-config';

async function globalSetup(config: FullConfig) {
  // Set up test results directory for screenshots
  const fs = await import('fs');
  const path = await import('path');

  const screenshotDir = path.join(process.cwd(), 'test-results', 'screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  // Optional: Launch browser to ensure it's installed
  if (process.env.CI) {
    console.log('Running in CI - verifying browser installation...');
    try {
      const browser = await chromium.launch();
      await browser.close();
      console.log('Browser verification successful');
    } catch (error) {
      console.error('Browser launch failed:', error);
      throw new Error('Playwright browsers not installed. Run: npx playwright install');
    }
  }

  // Set up any global test data or configuration
  process.env.PLAYWRIGHT_TEST_BASE_URL = config.use?.baseURL || testConfig.baseURL;

  // Wait for server to be ready
  console.log('Waiting for server to be ready...');
  const maxRetries = 30;
  let serverReady = false;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`${process.env.PLAYWRIGHT_TEST_BASE_URL}/health`);
      if (response.ok) {
        const text = await response.text();
        console.log(`Server health check response: ${text}`);
        serverReady = true;
        break;
      }
    } catch (_error) {
      // Server not ready yet
    }

    if (i < maxRetries - 1) {
      console.log(`Server not ready yet, retrying in 2s... (${i + 1}/${maxRetries})`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  if (!serverReady) {
    throw new Error('Server failed to start within 60 seconds');
  }

  console.log('Server is ready!');

  // Skip session cleanup to speed up tests
  console.log('Skipping session cleanup to improve test speed');
  // Skip browser storage cleanup to speed up tests

  console.log(`Global setup complete. Base URL: ${process.env.PLAYWRIGHT_TEST_BASE_URL}`);
}

export default globalSetup;
