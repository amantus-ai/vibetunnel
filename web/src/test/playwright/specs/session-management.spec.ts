import { expect, test } from '../fixtures/test.fixture';
import {
  cleanupSessions,
  generateTestSessionName,
  waitForShellPrompt,
} from '../helpers/terminal.helper';

test.describe('Session Management', () => {
  test.beforeEach(async ({ page }) => {
    // Clean up any existing sessions
    await cleanupSessions(page);
  });

  test('should kill an active session', async ({ sessionListPage, sessionViewPage }) => {
    const sessionName = generateTestSessionName();

    // Create a session
    await sessionListPage.navigate();
    await sessionListPage.createNewSession(sessionName, false);
    await sessionViewPage.waitForTerminalReady();

    // Navigate back to list
    await sessionViewPage.navigateBack();

    // Kill the session
    await sessionListPage.killSession(sessionName);

    // Wait for the session to be removed or marked as exited
    await sessionListPage.page.waitForTimeout(1000);

    // Verify session is no longer active
    const sessionCards = await sessionListPage.getSessionCards();
    if (sessionCards.length > 0) {
      // If session card still exists, it should not be active
      const isActive = await sessionListPage.isSessionActive(sessionName);
      expect(isActive).toBe(false);
    }
  });

  test('should handle session exit', async ({ sessionListPage, sessionViewPage, page }) => {
    const sessionName = generateTestSessionName();

    // Create a session
    await sessionListPage.navigate();
    await sessionListPage.createNewSession(sessionName, false);
    await sessionViewPage.waitForTerminalReady();
    await waitForShellPrompt(page);

    // Exit the session
    await sessionViewPage.typeCommand('exit');

    // Should redirect back to session list
    await page.waitForURL('/', { timeout: 5000 });

    // Verify session is marked as exited
    const sessionCards = await sessionListPage.getSessionCards();
    if (sessionCards.length > 0) {
      const isActive = await sessionListPage.isSessionActive(sessionName);
      expect(isActive).toBe(false);
    }
  });

  test('should display session metadata correctly', async ({
    sessionListPage,
    sessionViewPage,
  }) => {
    const sessionName = generateTestSessionName();

    // Create a session
    await sessionListPage.navigate();
    await sessionListPage.createNewSession(sessionName, false);
    await sessionViewPage.waitForTerminalReady();

    // Navigate back to see the session card
    await sessionViewPage.navigateBack();

    // Verify session card displays correct information
    const sessionCard = sessionListPage.page.locator(`session-card:has-text("${sessionName}")`);

    // Check for status
    await expect(sessionCard.locator('.status')).toContainText(/active|running/i);

    // Check for creation time (should show "just now" or similar)
    await expect(sessionCard).toContainText(/now|seconds? ago|minute ago/i);
  });

  test('should handle concurrent sessions', async ({ sessionListPage, sessionViewPage }) => {
    const session1 = generateTestSessionName();
    const session2 = generateTestSessionName();

    // Create first session
    await sessionListPage.navigate();
    await sessionListPage.createNewSession(session1, false);
    await sessionViewPage.waitForTerminalReady();

    // Type a command to identify session 1
    await sessionViewPage.typeCommand('echo "This is session 1"');
    await sessionViewPage.waitForOutput('This is session 1');

    // Create second session
    await sessionViewPage.navigateBack();
    await sessionListPage.createNewSession(session2, false);
    await sessionViewPage.waitForTerminalReady();

    // Type a command to identify session 2
    await sessionViewPage.typeCommand('echo "This is session 2"');
    await sessionViewPage.waitForOutput('This is session 2');

    // Navigate back and verify both sessions exist
    await sessionViewPage.navigateBack();
    const sessionCount = await sessionListPage.getSessionCount();
    expect(sessionCount).toBe(2);

    // Switch between sessions and verify state is maintained
    await sessionListPage.clickSession(session1);
    await sessionViewPage.waitForTerminalReady();
    let output = await sessionViewPage.getTerminalOutput();
    expect(output).toContain('This is session 1');
    expect(output).not.toContain('This is session 2');

    await sessionViewPage.navigateBack();
    await sessionListPage.clickSession(session2);
    await sessionViewPage.waitForTerminalReady();
    output = await sessionViewPage.getTerminalOutput();
    expect(output).toContain('This is session 2');
    expect(output).not.toContain('This is session 1');
  });

  test('should update session activity timestamp', async ({
    sessionListPage,
    sessionViewPage,
    page,
  }) => {
    const sessionName = generateTestSessionName();

    // Create a session
    await sessionListPage.navigate();
    await sessionListPage.createNewSession(sessionName, false);
    await sessionViewPage.waitForTerminalReady();
    await waitForShellPrompt(page);

    // Execute a command
    await sessionViewPage.typeCommand('echo "Activity test"');
    await sessionViewPage.waitForOutput('Activity test');

    // Navigate back to list
    await sessionViewPage.navigateBack();

    // The session should show recent activity
    const sessionCard = sessionListPage.page.locator(`session-card:has-text("${sessionName}")`);
    await expect(sessionCard).toContainText(/active.*now|active.*seconds? ago/i);
  });

  test('should handle session with long output', async ({
    sessionListPage,
    sessionViewPage,
    page,
  }) => {
    const sessionName = generateTestSessionName();

    // Create a session
    await sessionListPage.navigate();
    await sessionListPage.createNewSession(sessionName, false);
    await sessionViewPage.waitForTerminalReady();
    await waitForShellPrompt(page);

    // Generate long output
    await sessionViewPage.typeCommand(
      'for i in {1..100}; do echo "Line $i: This is a test of long output handling in VibeTunnel"; done'
    );

    // Wait for command to complete
    await page.waitForTimeout(2000);
    await waitForShellPrompt(page);

    // Verify we can still interact with the terminal
    await sessionViewPage.typeCommand('echo "After long output"');
    await sessionViewPage.waitForOutput('After long output');

    // Verify scrolling works (terminal should have scrollbar)
    const hasScrollbar = await page.evaluate(() => {
      const terminal = document.querySelector('.xterm-viewport');
      return terminal ? terminal.scrollHeight > terminal.clientHeight : false;
    });
    expect(hasScrollbar).toBe(true);
  });

  test('should persist session across page refresh', async ({
    sessionListPage,
    sessionViewPage,
    page,
  }) => {
    const sessionName = generateTestSessionName();

    // Create a session
    await sessionListPage.navigate();
    await sessionListPage.createNewSession(sessionName, false);
    await sessionViewPage.waitForTerminalReady();

    // Type a command
    await sessionViewPage.typeCommand('echo "Before refresh"');
    await sessionViewPage.waitForOutput('Before refresh');

    // Get the session URL
    const _sessionUrl = page.url();

    // Refresh the page
    await page.reload();

    // Wait for terminal to reload
    await sessionViewPage.waitForTerminalReady();

    // Verify session state is maintained
    const output = await sessionViewPage.getTerminalOutput();
    expect(output).toContain('Before refresh');

    // Verify we can still interact
    await sessionViewPage.typeCommand('echo "After refresh"');
    await sessionViewPage.waitForOutput('After refresh');
  });
});
