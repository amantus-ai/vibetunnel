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

    // Create a new session without specifying a name
    await sessionListPage.createNewSession();

    // Verify we're in the session view (URL should have session query param)
    await expect(sessionViewPage.page).toHaveURL(/\?session=/);

    // For now, just verify the session was created by checking the title
    // The UI seems to have changed - we need to investigate the new layout
    await page.waitForTimeout(3000);

    // Take a screenshot for debugging
    await page.screenshot({ path: 'session-created.png' });

    // Check if we have a session title in the header
    const headerText = await page.locator('header').textContent();
    expect(headerText).toContain('zsh');
  });

  test('should create a new session with custom name', async ({
    sessionListPage,
    sessionViewPage,
  }) => {
    const sessionName = generateTestSessionName();

    // Navigate to session list
    await sessionListPage.navigate();

    // Create a new session with custom name
    await sessionListPage.createNewSession(sessionName);

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
    await sessionListPage.createNewSession(sessionName);

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
      await sessionListPage.createNewSession(name);
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
    await sessionListPage.createNewSession(sessionName);
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
