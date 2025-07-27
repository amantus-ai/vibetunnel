import { chromium, type FullConfig } from '@playwright/test';
import type { Session } from '../../shared/types.js';
import { testConfig } from './test-config';

async function globalSetup(config: FullConfig) {
  // Start performance tracking
  console.time('Total test duration');

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

  // Clean up sessions if explicitly requested
  if (process.env.CLEAN_TEST_SESSIONS === 'true') {
    console.log('Cleaning up old test sessions...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(process.env.PLAYWRIGHT_TEST_BASE_URL || testConfig.baseURL, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // Wait for app to load
      await page.waitForSelector('vibetunnel-app', { state: 'attached', timeout: 10000 });

      // Check if we have sessions
      const sessions = await page.evaluate(async () => {
        const response = await fetch('/api/sessions');
        const data = await response.json();
        return data;
      });

      console.log(`Found ${sessions.length} sessions`);

      if (process.env.CI && process.env.FORCE_CLEAN_ALL_SESSIONS === 'true') {
        // On CI: Only clean ALL sessions if explicitly forced
        console.log('FORCE_CLEAN_ALL_SESSIONS enabled - removing ALL sessions');

        for (const session of sessions) {
          try {
            await page.evaluate(async (sessionId) => {
              await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
            }, session.id);
          } catch (error) {
            console.log(`Failed to kill session ${session.id}:`, error);
          }
        }

        console.log(`Cleaned up all ${sessions.length} sessions`);
      } else {
        // Clean up old test sessions (both CI and local)
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        const testSessions = sessions.filter((s: Session) => {
          const isTestSession =
            s.name?.includes('test-') ||
            s.name?.includes('nav-test') ||
            s.name?.includes('keyboard-test') ||
            s.name?.includes('sesscreate-') ||
            s.name?.includes('actmon-') ||
            s.name?.includes('termint-') ||
            s.name?.includes('uifeat-');
          const isOld = new Date(s.startedAt).getTime() < oneHourAgo;
          return isTestSession && isOld;
        });

        console.log(`Found ${testSessions.length} old test sessions to clean up`);

        // Kill old test sessions
        for (const session of testSessions) {
          try {
            await page.evaluate(async (sessionId) => {
              await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
            }, session.id);
          } catch (error) {
            console.log(`Failed to kill session ${session.id}:`, error);
          }
        }
      }

      console.log('Session cleanup complete');
    } catch (error) {
      console.error('Failed to clean up sessions:', error);
    } finally {
      await browser.close();
    }
  } else {
    console.log('Skipping session cleanup to improve test speed');
  }

  console.log(`Global setup complete. Base URL: ${process.env.PLAYWRIGHT_TEST_BASE_URL}`);
}

export default globalSetup;
