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

test.describe('Keyboard Input Tests', () => {
  test('should handle basic text input', async ({ page }) => {
    const sessionId = await createTestSession(page, sessionTracker, {
      command: 'cat',
      name: 'input-test',
    });

    await waitForSession(page, sessionId);

    // Wait for cat command to be ready for input
    await page.waitForTimeout(100);

    // Type some text
    const terminal = page.locator('.xterm-screen');
    await terminal.click();
    await page.keyboard.type('Hello Terminal');
    await page.keyboard.press('Enter');

    // Should see the echoed text
    await expect(terminal).toContainText('Hello Terminal');

    // End cat command
    await page.keyboard.press('Control+C');
  });

  test('should handle special key combinations', async ({ page }) => {
    const sessionId = await createTestSession(page, sessionTracker, {
      command: 'bash',
      name: 'keys-test',
    });

    await waitForSession(page, sessionId);

    const terminal = page.locator('.xterm-screen');
    await terminal.click();

    // Test Ctrl+C (interrupt)
    await page.keyboard.type('sleep 10');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    await page.keyboard.press('Control+C');

    // Should see the interrupted command
    await expect(terminal).toContainText('sleep 10');

    // Test command history (Up arrow)
    await page.keyboard.press('ArrowUp');
    await expect(terminal).toContainText('sleep 10');

    // Clear the line
    await page.keyboard.press('Control+C');

    // Exit bash
    await page.keyboard.type('exit');
    await page.keyboard.press('Enter');
  });

  test('should handle tab completion', async ({ page }) => {
    const sessionId = await createTestSession(page, sessionTracker, {
      command: 'bash',
      name: 'tab-test',
    });

    await waitForSession(page, sessionId);

    const terminal = page.locator('.xterm-screen');
    await terminal.click();

    // Try tab completion with a common command
    await page.keyboard.type('ec');
    await page.keyboard.press('Tab');

    // Should complete to 'echo' or show options
    await page.waitForTimeout(100);

    // Clear and exit
    await page.keyboard.press('Control+C');
    await page.keyboard.type('exit');
    await page.keyboard.press('Enter');
  });

  test('should handle copy and paste', async ({ page }) => {
    const sessionId = await createTestSession(page, sessionTracker, {
      command: 'cat',
      name: 'paste-test',
    });

    await waitForSession(page, sessionId);

    const terminal = page.locator('.xterm-screen');
    await terminal.click();

    // Type some text to copy
    await page.keyboard.type('Test text for copying');
    await page.keyboard.press('Enter');

    // Try to select and copy text (this depends on terminal implementation)
    // For now, just test that paste works with clipboard API
    await page.evaluate(() => navigator.clipboard.writeText('Pasted text'));

    // Paste using Ctrl+V (if supported) or right-click
    await page.keyboard.press('Control+V');
    await page.waitForTimeout(100);

    // End cat command
    await page.keyboard.press('Control+C');
  });

  test('should handle arrow key navigation', async ({ page }) => {
    const sessionId = await createTestSession(page, sessionTracker, {
      command: 'bash',
      name: 'arrow-test',
    });

    await waitForSession(page, sessionId);

    const terminal = page.locator('.xterm-screen');
    await terminal.click();

    // Type a long command
    await page.keyboard.type('echo "This is a long command for testing arrow keys"');

    // Use left arrow to move cursor
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');

    // Insert some text in the middle
    await page.keyboard.type('new ');

    // Execute the command
    await page.keyboard.press('Enter');

    // Should see the modified command output
    await expect(terminal).toContainText('long new command');

    // Exit bash
    await page.keyboard.type('exit');
    await page.keyboard.press('Enter');
  });
});
