import { expect, test } from '../fixtures/test.fixture';
import { TestSessionManager } from '../helpers/test-data-manager.helper';

test.describe('Debug Session Tests', () => {
  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page);
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });
  test('debug session creation and listing', async ({ page }) => {
    // Wait for page to be ready
    await page.waitForSelector('button[title="Create New Session"]', {
      state: 'visible',
      timeout: 10000,
    });

    // Create a session manually to debug the flow
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

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
    await page.fill('input[placeholder="My Session"]', sessionName);

    // Intercept the API request to see what's being sent
    const [request] = await Promise.all([
      page.waitForRequest('/api/sessions'),
      page.locator('button').filter({ hasText: 'Create' }).click(),
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
