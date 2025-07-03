import { expect, test } from '../fixtures/test.fixture';
import {
  assertSessionInList,
  assertTerminalReady,
  assertUrlHasSession,
} from '../helpers/assertion.helper';
import {
  createAndNavigateToSession,
  reconnectToSession,
} from '../helpers/session-lifecycle.helper';
import { TestSessionManager } from '../helpers/test-data-manager.helper';
import { waitForElementStable } from '../helpers/wait-strategies.helper';

// These tests create their own sessions and can run in parallel
test.describe.configure({ mode: 'parallel' });

test.describe('Session Creation', () => {
  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page);
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });

  test('should create a new session with default name', async ({ page }) => {
    // One line to create and navigate to session
    const { sessionId } = await createAndNavigateToSession(page);

    // Simple assertions using helpers
    await assertUrlHasSession(page, sessionId);
    await assertTerminalReady(page);
  });

  test('should create a new session with custom name', async ({ page }) => {
    const customName = sessionManager.generateSessionName('custom');

    // Create session with custom name
    const { sessionName } = await createAndNavigateToSession(page, { name: customName });

    // Verify session is created with correct name
    await assertUrlHasSession(page);
    await waitForElementStable(page, 'session-header');

    // Check header shows custom name
    const sessionInHeader = page.locator('session-header').locator(`text="${sessionName}"`);
    await expect(sessionInHeader).toBeVisible();
  });

  test('should show created session in session list', async ({ page }) => {
    test.setTimeout(30000); // Increase timeout for this test
    // Create tracked session
    const { sessionName } = await sessionManager.createTrackedSession();

    // Navigate back and verify
    await page.goto('/');
    await assertSessionInList(page, sessionName, { status: 'RUNNING' });
  });

  test('should handle multiple session creation', async ({ page }) => {
    test.setTimeout(40000); // Increase timeout for multiple operations
    // Create multiple sessions manually to avoid navigation issues
    const sessions: string[] = [];

    // Start from the session list page
    await page.goto('/', { waitUntil: 'networkidle' });

    for (let i = 0; i < 2; i++) {
      const sessionName = sessionManager.generateSessionName(`multi-test-${i + 1}`);

      // Open create dialog
      const createButton = page.locator('button[title="Create New Session"]');
      await expect(createButton).toBeVisible({ timeout: 5000 });
      await createButton.click();

      // Wait for modal
      await page.waitForSelector('input[placeholder="My Session"]', {
        state: 'visible',
        timeout: 5000,
      });

      // Fill session details
      await page.fill('input[placeholder="My Session"]', sessionName);
      await page.fill('input[placeholder="zsh, bash, etc."]', 'bash');

      // Make sure spawn window is off
      const spawnToggle = page.locator('input[type="checkbox"]').first();
      const isChecked = await spawnToggle.isChecked();
      if (isChecked) {
        await spawnToggle.click();
      }

      // Create session
      await page.click('button:has-text("Create Session")');

      // Wait for navigation to session
      await page.waitForURL(/\?session=/, { timeout: 10000 });

      // Track the session
      sessions.push(sessionName);
      sessionManager.trackSession(sessionName, 'dummy-id', false);

      // Navigate back to list for next creation (except last one)
      if (i < 1) {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('session-card', { state: 'visible', timeout: 5000 });
      }
    }

    // Navigate to list and verify all exist
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible', timeout: 10000 });

    // Add a small delay to ensure the session list is fully updated
    await page.waitForTimeout(2000);

    // Verify each session exists
    for (const sessionName of sessions) {
      const sessionCard = page.locator(`session-card:has-text("${sessionName}")`).first();
      await expect(sessionCard).toBeVisible({ timeout: 10000 });
    }
  });

  test('should reconnect to existing session', async ({ page }) => {
    // Create and track session
    const { sessionName } = await sessionManager.createTrackedSession();
    await assertTerminalReady(page);

    // Navigate away and back
    await page.goto('/');
    await reconnectToSession(page, sessionName);

    // Verify reconnected
    await assertUrlHasSession(page);
    await assertTerminalReady(page);
  });
});
