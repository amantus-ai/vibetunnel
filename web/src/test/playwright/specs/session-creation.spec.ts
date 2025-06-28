import { expect, test } from '../fixtures/test.fixture';
import { cleanupSessions, generateTestSessionName } from '../helpers/terminal.helper';

test.describe('Session Creation', () => {
  test.beforeEach(async ({ page }) => {
    // Clean up any existing sessions
    await cleanupSessions(page);
  });

  test('should create a new session with default name', async ({
    sessionListPage,
    sessionViewPage,
    page,
  }) => {
    // Navigate to session list
    await sessionListPage.navigate();

    // Create a new session without specifying a name (spawn window = false for web session)
    await sessionListPage.createNewSession(undefined, false);

    // Verify we're in the session view (URL should have session query param)
    await expect(sessionViewPage.page).toHaveURL(/\?session=/);

    // The session view has a dark sidebar on the left showing sessions
    // Look for the session name in the sidebar (it shows "zsh (~)")
    const sessionInSidebar = page.locator('text=/zsh.*\\(~\\)/').first();
    await expect(sessionInSidebar).toBeVisible({ timeout: 5000 });

    // The terminal area should be visible (even if black initially)
    const terminalArea = page.locator('vibe-terminal');
    await expect(terminalArea).toBeVisible();
  });

  test('should create a new session with custom name', async ({
    sessionListPage,
    sessionViewPage,
  }) => {
    const sessionName = generateTestSessionName();

    // Navigate to session list
    await sessionListPage.navigate();

    // Create a new session with custom name (spawn window = false for web session)
    await sessionListPage.createNewSession(sessionName, false);

    // Verify we're in the session view (URL should have session query param)
    await expect(sessionViewPage.page).toHaveURL(/\?session=/);

    // Wait for terminal to be ready
    await sessionViewPage.waitForTerminalReady();

    // Verify session name appears in the page
    await expect(sessionViewPage.page).toHaveTitle(new RegExp(sessionName));
  });

  test('should show created session in session list', async ({
    sessionListPage,
    sessionViewPage,
  }) => {
    const sessionName = generateTestSessionName();

    // Navigate to session list
    await sessionListPage.navigate();

    // Get initial session count
    const initialCount = await sessionListPage.getSessionCount();

    // Create a new session
    await sessionListPage.createNewSession(sessionName, false);

    // Wait for terminal to be ready
    await sessionViewPage.waitForTerminalReady();

    // Navigate back to session list
    await sessionViewPage.navigateBack();

    // Verify session count increased
    const newCount = await sessionListPage.getSessionCount();
    expect(newCount).toBe(initialCount + 1);

    // Verify session is active
    const isActive = await sessionListPage.isSessionActive(sessionName);
    expect(isActive).toBe(true);
  });

  test('should handle multiple session creation', async ({ sessionListPage, sessionViewPage }) => {
    const sessionNames = [
      generateTestSessionName(),
      generateTestSessionName(),
      generateTestSessionName(),
    ];

    // Navigate to session list
    await sessionListPage.navigate();

    // Create multiple sessions
    for (const name of sessionNames) {
      await sessionListPage.createNewSession(name, false);
      await sessionViewPage.waitForTerminalReady();
      await sessionViewPage.navigateBack();
    }

    // Verify all sessions are listed
    const sessionCount = await sessionListPage.getSessionCount();
    expect(sessionCount).toBe(sessionNames.length);

    // Verify all sessions are active
    for (const name of sessionNames) {
      const isActive = await sessionListPage.isSessionActive(name);
      expect(isActive).toBe(true);
    }
  });

  test('should reconnect to existing session', async ({ sessionListPage, sessionViewPage }) => {
    const sessionName = generateTestSessionName();

    // Create a session
    await sessionListPage.navigate();
    await sessionListPage.createNewSession(sessionName, false);
    await sessionViewPage.waitForTerminalReady();

    // Type a command to identify the session
    const testCommand = `echo "Session ${sessionName}"`;
    await sessionViewPage.typeCommand(testCommand);
    await sessionViewPage.waitForOutput(`Session ${sessionName}`);

    // Navigate back
    await sessionViewPage.navigateBack();

    // Click on the session to reconnect
    await sessionListPage.clickSession(sessionName);

    // Verify we can see the previous output
    await sessionViewPage.waitForTerminalReady();
    const output = await sessionViewPage.getTerminalOutput();
    expect(output).toContain(`Session ${sessionName}`);
  });
});
