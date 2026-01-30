import { chromium, type FullConfig } from '@playwright/test';
import type { Session } from '../../shared/types.js';
import { testConfig } from './test-config';

function isLikelyTestSessionName(name?: string): boolean {
  if (!name) return false;
  if (name.startsWith('test-')) return true;

  // Legacy / older test prefixes (from before we standardized on "test-*").
  // Guard with timestamp marker to avoid nuking normal sessions that happen to share a word.
  const hasTimestamp = /-\d{13}-/.test(name);
  if (!hasTimestamp) return false;

  const markers = [
    'nav-test',
    'keyboard-test',
    'terminal-test',
    'terminal-input-test',
    'multi-command-test',
    'scroll-test',
    'state-test',
    'basic-test',
    'exit',
    'lifecycle',
    'reconnect',
    'metadata-test',
    'file-nav-test',
    'file-browser-ui-test',
    'file-browser-test',
    'file-browser-nav',
    'file-browser',
    'quick-start',
    'long-running',
    'sesscreate',
    'actmon',
    'termint',
    'uifeat',
  ];

  return markers.some(
    (m) => name.startsWith(`${m}-`) || name.includes(`-${m}-`) || name.includes(m)
  );
}

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

  // Skip browser verification in local dev for faster startup
  if (process.env.CI && process.env.VERIFY_BROWSER !== 'false') {
    console.log('Running in CI - verifying browser installation...');
    try {
      const browser = await chromium.launch({ headless: true });
      await browser.close();
      console.log('Browser verification successful');
    } catch (error) {
      console.error('Browser launch failed:', error);
      throw new Error('Playwright browsers not installed. Run: npx playwright install');
    }
  }

  // Set up any global test data or configuration
  process.env.PLAYWRIGHT_TEST_BASE_URL = config.use?.baseURL || testConfig.baseURL;

  // Clean up sessions in CI (or if explicitly requested)
  if (process.env.CI || process.env.CLEAN_TEST_SESSIONS === 'true') {
    console.log('Cleaning up old test sessions...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(process.env.PLAYWRIGHT_TEST_BASE_URL || testConfig.baseURL, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });

      // Wait for app to load with reduced timeout
      await page.waitForSelector('vibetunnel-app', { state: 'attached', timeout: 5000 });

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
        // Clean up test sessions
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        const testSessions = sessions.filter((s: Session) => {
          const isTestSession = isLikelyTestSessionName(s.name);
          const isOld = new Date(s.startedAt).getTime() < oneHourAgo;
          return isTestSession && (process.env.CI || isOld);
        });

        console.log(`Found ${testSessions.length} test sessions to clean up`);

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
