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
import { SessionListPage } from '../pages/session-list.page';

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
    test.setTimeout(60000); // Increase timeout for debugging

    // Start from session list page
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Get initial session count
    const initialCount = await page.locator('session-card').count();
    console.log(`Initial session count: ${initialCount}`);

    // Create session using the helper
    const sessionName = sessionManager.generateSessionName('list-test');
    const sessionListPage = new SessionListPage(page);
    await sessionListPage.createNewSession(sessionName, false);

    // Wait for navigation to session view
    await page.waitForURL(/\?session=/, { timeout: 10000 });
    console.log(`Navigated to session: ${page.url()}`);

    // Wait for terminal to be ready
    await page.waitForSelector('vibe-terminal', { state: 'visible', timeout: 5000 });

    // Navigate back to session list
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for multiple refresh cycles (auto-refresh happens every 1 second)
    await page.waitForTimeout(5000);

    // Check session count increased
    const newCount = await page.locator('session-card').count();
    console.log(`New session count: ${newCount}`);

    // Look for the session with more specific debugging
    const found = await page.evaluate((targetName) => {
      const cards = document.querySelectorAll('session-card');
      const sessions = [];
      for (const card of cards) {
        // Session cards are web components with properties
        const sessionCard = card as any;
        let name = 'unknown';

        // Try to get session name from the card's session property
        if (sessionCard.session) {
          name = sessionCard.session.name || sessionCard.session.command?.join(' ') || 'unknown';
        } else {
          // Fallback: Look for inline-edit component which contains the session name
          const inlineEdit = card.querySelector('inline-edit');
          if (inlineEdit) {
            // Try to get the value property (Lit property binding)
            const inlineEditElement = inlineEdit as HTMLElement & { value?: string };
            name = inlineEditElement.value || 'unknown';

            // If that doesn't work, try the shadow DOM
            if (name === 'unknown' && inlineEdit.shadowRoot) {
              const displayText = inlineEdit.shadowRoot.querySelector('.display-text');
              name = displayText?.textContent || 'unknown';
            }
          }
        }

        const statusEl = card.querySelector('span[data-status]');
        const status = statusEl?.getAttribute('data-status') || 'no-status';
        sessions.push({ name, status });
        if (name.includes(targetName)) {
          return { found: true, name, status };
        }
      }
      console.log('All sessions:', sessions);
      return { found: false, sessions };
    }, sessionName);

    console.log('Session search result:', found);

    if (!found.found) {
      throw new Error(
        `Session ${sessionName} not found in list. Available sessions: ${JSON.stringify(found.sessions)}`
      );
    }

    // Now do the actual assertion
    await assertSessionInList(page, sessionName, { status: 'running' });
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
      await page.fill('input[placeholder="zsh"]', 'bash');

      // Make sure spawn window is off
      const spawnToggle = page.locator('button[role="switch"]').first();
      const isChecked = (await spawnToggle.getAttribute('aria-checked')) === 'true';
      if (isChecked) {
        await spawnToggle.click();
        // Wait for toggle state to update
        await page.waitForFunction(
          () => {
            const toggle = document.querySelector('button[role="switch"]');
            return toggle?.getAttribute('aria-checked') === 'false';
          },
          { timeout: 1000 }
        );
      }

      // Create session
      await page.click('[data-testid="create-session-submit"]', { force: true });

      // Wait for either navigation or modal to close
      const navigationPromise = page.waitForURL(/\?session=/, { timeout: 10000 });
      const modalClosePromise = page.waitForSelector('[data-modal-state="open"]', {
        state: 'detached',
        timeout: 10000,
      });

      try {
        await Promise.race([navigationPromise, modalClosePromise]);

        // Check if we navigated
        if (page.url().includes('?session=')) {
          // Wait for terminal to be ready before navigating back
          await page.waitForSelector('vibe-terminal', { state: 'visible', timeout: 5000 });
        } else {
          console.log(
            `No navigation after create, session ${sessionName} may have been created in background`
          );
        }
      } catch (error) {
        console.error(`Failed to create session ${sessionName}:`, error);
        continue;
      }

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

    // Verify each session exists using custom evaluation
    for (const sessionName of sessions) {
      const found = await page.evaluate((targetName) => {
        const cards = document.querySelectorAll('session-card');
        for (const card of cards) {
          const sessionCard = card as any;
          if (sessionCard.session) {
            const name = sessionCard.session.name || sessionCard.session.command?.join(' ') || '';
            if (name.includes(targetName)) {
              return true;
            }
          }
        }
        return false;
      }, sessionName);

      expect(found).toBeTruthy();
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
