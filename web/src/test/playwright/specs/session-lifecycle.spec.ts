import { expect, test } from '../fixtures/test.fixture';
import { TestSessionManager } from '../helpers/test-data-manager.helper';
import { TestDataFactory } from '../utils/test-utils';

const TEST_PREFIX = TestDataFactory.getTestSpecificPrefix('session-lifecycle');

test.describe('Session Lifecycle Tests', () => {
  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page, TEST_PREFIX);
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });

  test('should create and terminate session', async ({ page }) => {
    test.setTimeout(20000);
    const { sessionName, sessionId } = await sessionManager.createTrackedSession(
      sessionManager.generateSessionName('lifecycle'),
      false,
      'bash'
    );

    await page.goto('/');
    await page.waitForSelector(`session-card:has-text("${sessionName}")`, {
      state: 'visible',
      timeout: 15000,
    });

    await page
      .evaluate(async (id) => {
        await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      }, sessionId)
      .catch(() => {});

    await page.waitForFunction(
      (name) => {
        const cards = Array.from(document.querySelectorAll('session-card'));
        const card = cards.find((c) => c.textContent?.includes(name));
        if (!card) return true;
        const root = (card as unknown as { shadowRoot?: ShadowRoot }).shadowRoot;
        const status =
          (card.querySelector('span[data-status]') as HTMLElement | null) ??
          (root?.querySelector('span[data-status]') as HTMLElement | null);
        const text = (status?.textContent || '').toLowerCase();
        return text.includes('exited');
      },
      sessionName,
      { timeout: 15000, polling: 250 }
    );
  });

  test('should handle session that exits', async ({ page, sessionViewPage }) => {
    test.setTimeout(45000);

    const { sessionName } = await sessionManager.createTrackedSession(
      sessionManager.generateSessionName('exit'),
      false,
      'bash'
    );

    await sessionViewPage.waitForTerminalReady();
    await sessionViewPage.typeCommand('echo Done');
    await sessionViewPage.waitForOutput('Done', { timeout: 5000 });
    await sessionViewPage.typeCommand('exit');

    await page.goto('/');

    // Exited sessions can be hidden depending on persisted UI state.
    // Ensure exited sessions are shown before waiting for the card.
    const showExitedCheckbox = page.getByRole('checkbox', { name: 'Show' });
    if (await showExitedCheckbox.isVisible({ timeout: 2000 })) {
      if (!(await showExitedCheckbox.isChecked())) {
        await showExitedCheckbox.check();
      }
    }

    await page.waitForSelector(`session-card:has-text("${sessionName}")`, { state: 'visible' });

    await expect(
      page.locator(`session-card:has-text("${sessionName}") span[data-status]`).first()
    ).toContainText('exited', { timeout: 15000 });
  });

  test('should reconnect to existing session', async ({ page, sessionViewPage }) => {
    const { sessionName } = await sessionManager.createTrackedSession(
      sessionManager.generateSessionName('reconnect'),
      false,
      'bash'
    );

    await sessionViewPage.waitForTerminalReady();
    await sessionViewPage.typeCommand('echo "Session state test"');
    await sessionViewPage.waitForOutput('Session state test', { timeout: 5000 });

    await page.goto('/');
    await page.waitForSelector(`session-card:has-text("${sessionName}")`, {
      state: 'visible',
      timeout: 15000,
    });

    await page.locator(`session-card:has-text("${sessionName}")`).first().click();
    await sessionViewPage.waitForTerminalReady();
    await sessionViewPage.waitForOutput('Session state test', { timeout: 5000 });

    await sessionViewPage.typeCommand('echo "Reconnected"');
    await sessionViewPage.waitForOutput('Reconnected', { timeout: 5000 });
    await sessionViewPage.typeCommand('exit');
  });
});
