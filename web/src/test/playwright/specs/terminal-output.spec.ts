import { expect, test } from '@playwright/test';
import { createTestSession, TestSessionTracker, waitForSession } from '../test-utils';

let sessionTracker: TestSessionTracker;

test.beforeEach(async ({ page }) => {
  sessionTracker = new TestSessionTracker();
  await page.goto('/');
  await page.waitForLoadState('networkidle');
});

test.afterEach(async () => {
  await sessionTracker.cleanup();
});

test.describe('Terminal Output Tests', () => {
  test('should display command output correctly', async ({ page }) => {
    const sessionId = await createTestSession(page, sessionTracker, {
      command: 'echo "Hello, World!"',
      name: 'output-test',
    });

    await waitForSession(page, sessionId);

    // Check that command output appears
    await expect(page.locator('.xterm-screen')).toContainText('Hello, World!');

    // Verify terminal is responsive
    await expect(page.locator('.xterm-cursor')).toBeVisible();
  });

  test('should handle multiline output', async ({ page }) => {
    const sessionId = await createTestSession(page, sessionTracker, {
      command: 'printf "Line 1\\nLine 2\\nLine 3"',
      name: 'multiline-test',
    });

    await waitForSession(page, sessionId);

    // Check that all lines are displayed
    const terminal = page.locator('.xterm-screen');
    await expect(terminal).toContainText('Line 1');
    await expect(terminal).toContainText('Line 2');
    await expect(terminal).toContainText('Line 3');
  });

  test('should handle large output efficiently', async ({ page }) => {
    const sessionId = await createTestSession(page, sessionTracker, {
      command: 'seq 1 100',
      name: 'large-output-test',
    });

    await waitForSession(page, sessionId);

    // Terminal should remain responsive even with lots of output
    const terminal = page.locator('.xterm-screen');
    await expect(terminal).toBeVisible();

    // Should see some of the sequence numbers
    await expect(terminal).toContainText('1');
    await expect(terminal).toContainText('100');
  });

  test('should handle ANSI color codes', async ({ page }) => {
    const sessionId = await createTestSession(page, sessionTracker, {
      command: 'echo -e "\\033[31mRed text\\033[0m \\033[32mGreen text\\033[0m"',
      name: 'color-test',
    });

    await waitForSession(page, sessionId);

    // Check that colored text appears (ANSI codes should be processed)
    const terminal = page.locator('.xterm-screen');
    await expect(terminal).toContainText('Red text');
    await expect(terminal).toContainText('Green text');

    // Verify terminal processed colors (check for color classes)
    await expect(page.locator('.xterm-fg-1, .xterm-fg-2')).toHaveCount({ min: 1 });
  });

  test('should scroll automatically with new output', async ({ page }) => {
    const sessionId = await createTestSession(page, sessionTracker, {
      command: 'for i in {1..50}; do echo "Line $i"; sleep 0.01; done',
      name: 'scroll-test',
    });

    await waitForSession(page, sessionId);

    // Wait for output to start
    await expect(page.locator('.xterm-screen')).toContainText('Line 1');

    // Wait for more output
    await page.waitForTimeout(500);

    // Should see later lines (terminal should auto-scroll)
    await expect(page.locator('.xterm-screen')).toContainText('Line 2');

    // Terminal should remain responsive
    await expect(page.locator('.xterm-cursor')).toBeVisible();
  });
});
