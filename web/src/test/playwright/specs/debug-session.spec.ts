import { TIMEOUTS } from '../constants/timeouts';
import { expect, test } from '../fixtures/test.fixture';
import { TestSessionManager } from '../helpers/test-data-manager.helper';
import { TestDataFactory } from '../utils/test-utils';

// Use a unique prefix for this test suite
const TEST_PREFIX = TestDataFactory.getTestSpecificPrefix('debug-session');

// These tests create their own sessions and can run in parallel
test.describe.configure({ mode: 'parallel' });

test.describe('Debug Session Tests', () => {
  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page, TEST_PREFIX);
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });
  test('debug session creation and listing', async ({ page }) => {
    // Navigate to root
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');

    // Wait for page to be ready
    const createButton = page
      .locator('[data-testid="create-session-button"]')
      .or(page.locator('button[title="Create New Session"]'))
      .or(page.locator('button[title="Create New Session (⌘K)"]'))
      .first();

    await createButton.waitFor({ state: 'visible', timeout: 10000 });

    // Create a session manually to debug the flow
    await createButton.click();

    // Wait for modal to appear and animations to complete
    await page.waitForSelector('text="New Session"', { state: 'visible', timeout: 10000 });
    await page.waitForFunction(
      () => {
        const modal = document.querySelector('[role="dialog"], .modal');
        return (
          modal &&
          getComputedStyle(modal).opacity === '1' &&
          !document.documentElement.classList.contains('view-transition-active')
        );
      },
      { timeout: TIMEOUTS.UI_ANIMATION }
    );

    // Try both possible selectors for the session name input
    const nameInput = page
      .locator('[data-testid="session-name-input"]')
      .or(page.locator('input[placeholder="My Session"]'));
    await nameInput.waitFor({ state: 'visible', timeout: 5000 });

    // Check the initial state of spawn window toggle
    const spawnWindowToggle = page.locator('button[role="switch"]');
    const initialState = await spawnWindowToggle.getAttribute('aria-checked');
    console.log(`Initial spawn window state: ${initialState}`);

    // Turn OFF spawn window
    if (initialState === 'true') {
      await spawnWindowToggle.click();
      // Wait for toggle state to update
      await page.waitForFunction(
        () =>
          document.querySelector('button[role="switch"]')?.getAttribute('aria-checked') === 'false',
        { timeout: 1000 }
      );
    }

    const finalState = await spawnWindowToggle.getAttribute('aria-checked');
    console.log(`Final spawn window state: ${finalState}`);

    // Fill in session name
    const sessionName = sessionManager.generateSessionName('debug');
    await nameInput.fill(sessionName);

    // Intercept the API request to see what's being sent
    const [request] = await Promise.all([
      page.waitForRequest('/api/sessions'),
      page
        .locator('[data-testid="create-session-submit"]')
        .or(page.locator('button:has-text("Create")'))
        .click({ force: true }),
    ]);

    const requestBody = request.postDataJSON();
    console.log('Request body:', JSON.stringify(requestBody));

    // Wait for response
    const response = await request.response();
    const responseBody = await response?.json();
    console.log('Response status:', response?.status());
    console.log('Response body:', JSON.stringify(responseBody));

    // Wait for navigation
    await page.waitForURL(/\?session=/, { timeout: 10000 });
    console.log('Navigated to session');

    // Navigate back to home using the UI
    const backButton = page.locator('button').filter({ hasText: 'Back' }).first();
    if (await backButton.isVisible({ timeout: 1000 })) {
      await backButton.click();
      await page.waitForURL('/');
      console.log('Navigated back to home');
    } else {
      // We might be in a sidebar layout where sessions are already visible
      console.log('No Back button found - might be in sidebar layout');
    }

    // Wait for the page to be fully loaded after navigation
    await page.waitForLoadState('networkidle');

    // Simply verify that the session was created by checking the URL
    const currentUrl = page.url();
    const isInSessionView = currentUrl.includes('session=');

    if (!isInSessionView) {
      // We navigated back, check if our session is visible somewhere
      const sessionVisible = await page
        .locator(`text="${sessionName}"`)
        .first()
        .isVisible({ timeout: 2000 })
        .catch(() => false);
      expect(sessionVisible).toBe(true);
    }

    // Check hideExitedSessions state
    const hideExited = await page.evaluate(() => localStorage.getItem('hideExitedSessions'));
    console.log('localStorage hideExitedSessions:', hideExited);

    // Check the app component's state
    const appHideExited = await page.evaluate(() => {
      const app = document.querySelector('vibetunnel-app') as HTMLElement & {
        hideExited?: boolean;
      };
      return app?.hideExited;
    });
    console.log('App component hideExited:', appHideExited);

    // Check what's in the DOM
    const sessionCards = await page.locator('session-card').count();
    console.log(`Found ${sessionCards} session cards in DOM`);

    // Check for any error messages
    const errorElements = await page.locator('.text-red-500, .error, [class*="error"]').count();
    console.log(`Found ${errorElements} error elements`);

    // Check the session list container (might be in the sidebar in split view)
    const listContainerLocator = page.locator(
      '[data-testid="session-list-container"], session-list'
    );
    const listContainerVisible = await listContainerLocator
      .isVisible({ timeout: 1000 })
      .catch(() => false);

    if (listContainerVisible) {
      const listContainer = await listContainerLocator.first().textContent();
      console.log('Session list container content:', listContainer?.substring(0, 200));
    } else {
      console.log('Session list container not visible - might be in mobile view');
    }

    // Try to fetch sessions directly
    const sessionsResponse = await page.evaluate(async () => {
      const response = await fetch('/api/sessions');
      const data = await response.json();
      return { status: response.status, count: data.length, sessions: data };
    });
    console.log('Direct API call:', JSON.stringify(sessionsResponse));

    // If we have sessions but no cards, it's likely due to filtering
    if (sessionsResponse.count > 0 && sessionCards === 0) {
      console.log('Sessions exist in API but not showing in UI - likely filtered out');

      // Check if all sessions are exited
      const exitedCount = sessionsResponse.sessions.filter(
        (s: { status: string }) => s.status === 'exited'
      ).length;
      console.log(`Exited sessions: ${exitedCount} out of ${sessionsResponse.count}`);
    }
  });
});
