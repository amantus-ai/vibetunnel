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

test.describe('Session Lifecycle Tests', () => {
  test('should create and terminate session properly', async ({ page }) => {
    const sessionId = await createTestSession(page, sessionTracker, {
      command: 'bash',
      name: 'lifecycle-test',
    });

    await waitForSession(page, sessionId);

    // Session should be active
    const sessionRow = page.locator(`[data-testid="session-${sessionId}"]`);
    await expect(sessionRow).toBeVisible();
    await expect(sessionRow.locator('.session-status')).toContainText('active');

    // Terminate the session
    await sessionRow.locator('button[data-testid="kill-session"]').click();

    // Confirm termination
    await page.locator('button:has-text("Kill Session")').click();

    // Session should be marked as exited
    await expect(sessionRow.locator('.session-status')).toContainText('exited');
  });

  test('should handle session exit gracefully', async ({ page }) => {
    const sessionId = await createTestSession(page, sessionTracker, {
      command: 'bash -c "echo Done; exit 0"',
      name: 'exit-test',
    });

    await waitForSession(page, sessionId);

    // Wait for command to complete
    await page.waitForTimeout(500);

    // Session should show as exited
    const sessionRow = page.locator(`[data-testid="session-${sessionId}"]`);
    await expect(sessionRow.locator('.session-status')).toContainText('exited');

    // Should show exit code 0
    await expect(sessionRow).toContainText('exit code: 0');
  });

  test('should handle session with non-zero exit code', async ({ page }) => {
    const sessionId = await createTestSession(page, sessionTracker, {
      command: 'bash -c "echo Error; exit 1"',
      name: 'error-exit-test',
    });

    await waitForSession(page, sessionId);

    // Wait for command to complete
    await page.waitForTimeout(500);

    // Session should show as exited with error
    const sessionRow = page.locator(`[data-testid="session-${sessionId}"]`);
    await expect(sessionRow.locator('.session-status')).toContainText('exited');

    // Should show exit code 1
    await expect(sessionRow).toContainText('exit code: 1');
  });

  test('should reconnect to existing session', async ({ page }) => {
    const sessionId = await createTestSession(page, sessionTracker, {
      command: 'bash',
      name: 'reconnect-test',
    });

    await waitForSession(page, sessionId);

    // Type something in the terminal
    const terminal = page.locator('.xterm-screen');
    await terminal.click();
    await page.keyboard.type('echo "Session state test"');
    await page.keyboard.press('Enter');

    // Wait for output
    await expect(terminal).toContainText('Session state test');

    // Navigate away and back
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click on the session to reconnect
    const sessionRow = page.locator(`[data-testid="session-${sessionId}"]`);
    await sessionRow.click();

    // Should reconnect and show previous output
    await expect(page.locator('.xterm-screen')).toContainText('Session state test');

    // Terminal should be responsive
    await page.locator('.xterm-screen').click();
    await page.keyboard.type('echo "Reconnected"');
    await page.keyboard.press('Enter');

    await expect(page.locator('.xterm-screen')).toContainText('Reconnected');

    // Clean up
    await page.keyboard.type('exit');
    await page.keyboard.press('Enter');
  });

  test('should show session duration', async ({ page }) => {
    const sessionId = await createTestSession(page, sessionTracker, {
      command: 'sleep 2',
      name: 'duration-test',
    });

    await waitForSession(page, sessionId);

    // Session should show as active initially
    const sessionRow = page.locator(`[data-testid="session-${sessionId}"]`);
    await expect(sessionRow.locator('.session-status')).toContainText('active');

    // Wait for sleep command to complete
    await page.waitForTimeout(2500);

    // Session should show as exited
    await expect(sessionRow.locator('.session-status')).toContainText('exited');

    // Should show some duration (at least 2 seconds)
    const durationText = await sessionRow.locator('.session-duration').textContent();
    expect(durationText).toMatch(/[0-9]+[sm]/); // Should show seconds or minutes
  });

  test('should handle multiple concurrent sessions', async ({ page }) => {
    // Create multiple sessions
    const sessionIds = await Promise.all([
      createTestSession(page, sessionTracker, { command: 'bash', name: 'concurrent-1' }),
      createTestSession(page, sessionTracker, { command: 'bash', name: 'concurrent-2' }),
      createTestSession(page, sessionTracker, { command: 'bash', name: 'concurrent-3' }),
    ]);

    // Wait for all sessions to be ready
    for (const sessionId of sessionIds) {
      await waitForSession(page, sessionId);
    }

    // All sessions should be visible and active
    for (const sessionId of sessionIds) {
      const sessionRow = page.locator(`[data-testid="session-${sessionId}"]`);
      await expect(sessionRow).toBeVisible();
      await expect(sessionRow.locator('.session-status')).toContainText('active');
    }

    // Should be able to interact with each session
    for (const sessionId of sessionIds) {
      const sessionRow = page.locator(`[data-testid="session-${sessionId}"]`);
      await sessionRow.click();

      // Terminal should be active
      await expect(page.locator('.xterm-screen')).toBeVisible();

      // Type a unique command for this session
      await page.locator('.xterm-screen').click();
      await page.keyboard.type(`echo "Session ${sessionId}"`);
      await page.keyboard.press('Enter');

      // Should see the output
      await expect(page.locator('.xterm-screen')).toContainText(`Session ${sessionId}`);

      // Exit this session
      await page.keyboard.type('exit');
      await page.keyboard.press('Enter');
    }

    // Wait for sessions to exit
    await page.waitForTimeout(500);

    // All sessions should now be exited
    for (const sessionId of sessionIds) {
      const sessionRow = page.locator(`[data-testid="session-${sessionId}"]`);
      await expect(sessionRow.locator('.session-status')).toContainText('exited');
    }
  });
});
