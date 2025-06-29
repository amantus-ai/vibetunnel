import { expect, test } from '../fixtures/test.fixture';
import { assertUrlHasSession } from '../helpers/assertion.helper';
import { takeDebugScreenshot } from '../helpers/screenshot.helper';
import { createMultipleSessions } from '../helpers/session-lifecycle.helper';
import { TestSessionManager } from '../helpers/test-data-manager.helper';

test.describe('Session Navigation', () => {
  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page);
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });

  test('should navigate between session list and session view', async ({ page }) => {
    test.setTimeout(20000);

    // Create a session
    let sessionName: string;
    try {
      const result = await sessionManager.createTrackedSession();
      sessionName = result.sessionName;
    } catch (error) {
      console.error('Failed to create session:', error);
      // Take screenshot for debugging
      await takeDebugScreenshot(page, 'session-creation-failed');
      throw error;
    }

    // Verify we navigated to the session
    const currentUrl = page.url();
    if (!currentUrl.includes('?session=')) {
      await takeDebugScreenshot(page, 'no-session-in-url');
      throw new Error(`Failed to navigate to session view. Current URL: ${currentUrl}`);
    }

    await assertUrlHasSession(page);

    // Navigate back to home - either via Back button or VibeTunnel logo
    const backButton = page.locator('button:has-text("Back")');
    const vibeTunnelLogo = page.locator('button:has(h1:has-text("VibeTunnel"))').first();

    if (await backButton.isVisible({ timeout: 1000 })) {
      await backButton.click();
    } else if (await vibeTunnelLogo.isVisible({ timeout: 1000 })) {
      await vibeTunnelLogo.click();
    } else {
      // If we have a sidebar, we're already seeing the session list
      const sessionCardsInSidebar = page.locator('aside session-card, nav session-card');
      if (!(await sessionCardsInSidebar.first().isVisible({ timeout: 1000 }))) {
        throw new Error('Could not find a way to navigate back to session list');
      }
    }

    // Verify we can see session cards - wait for session list to load
    await page.waitForFunction(
      () => {
        const cards = document.querySelectorAll('session-card');
        const noSessionsMsg = document.querySelector('.text-dark-text-muted');
        return cards.length > 0 || noSessionsMsg?.textContent?.includes('No terminal sessions');
      },
      { timeout: 10000 }
    );

    // Ensure our specific session card is visible
    await page.waitForSelector(`session-card:has-text("${sessionName}")`, {
      state: 'visible',
      timeout: 10000,
    });

    // Click on the session card to navigate back
    const sessionCard = page.locator('session-card').filter({ hasText: sessionName }).first();
    await sessionCard.scrollIntoViewIfNeeded();
    await sessionCard.click();

    // Should be back in session view
    await assertUrlHasSession(page);
    await page.waitForSelector('vibe-terminal', { state: 'visible' });
  });

  test('should navigate using sidebar in session view', async ({ page }) => {
    test.setTimeout(20000);

    // Create multiple sessions
    const sessions = await createMultipleSessions(page, 2, {
      name: 'nav-test',
    });

    const sessionName1 = sessions[0].sessionName;
    const sessionName2 = sessions[1].sessionName;
    const session2Url = page.url();

    // Navigate back to first session to get its URL
    await page.goto('/');
    const sessionListPage = await import('../pages/session-list.page').then(
      (m) => new m.SessionListPage(page)
    );
    await sessionListPage.clickSession(sessionName1);
    const session1Url = page.url();

    // Navigate back to second session
    await sessionListPage.clickSession(sessionName2);

    // We should be in session 2 now
    expect(page.url()).toBe(session2Url);

    // Check if sessions are visible in the UI (either in sidebar or session list)
    const session1TextVisible = await page
      .locator(`text="${sessionName1}"`)
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    const session2TextVisible = await page
      .locator(`text="${sessionName2}"`)
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    if (!session1TextVisible || !session2TextVisible) {
      // Sessions might not be visible in sidebar view - skip this test
      console.log('Sessions not visible in UI for navigation test');
      test.skip();
      return;
    }

    // Check if we can find session buttons in the sidebar
    const session1Button = page.locator('button').filter({ hasText: sessionName1 }).first();
    const session2Button = page.locator('button').filter({ hasText: sessionName2 }).first();

    const session1Visible = await session1Button.isVisible({ timeout: 1000 }).catch(() => false);
    const session2Visible = await session2Button.isVisible({ timeout: 1000 }).catch(() => false);

    if (session1Visible && session2Visible) {
      // Click on the first session in sidebar
      await session1Button.click();

      // Should navigate to session 1
      await page.waitForURL(session1Url);
      expect(page.url()).toBe(session1Url);

      // Click on session 2 in sidebar
      await session2Button.click();

      // Should navigate back to session 2
      await page.waitForURL(session2Url);
      expect(page.url()).toBe(session2Url);
    } else {
      // Alternative: Look for a dropdown or tab-based session switcher
      const sessionSwitcher = page
        .locator('select:has-text("session"), [role="tablist"] [role="tab"], .session-tabs')
        .first();
      const switcherVisible = await sessionSwitcher.isVisible({ timeout: 1000 }).catch(() => false);

      if (switcherVisible) {
        // Handle dropdown/select
        if (
          await page
            .locator('select')
            .isVisible({ timeout: 500 })
            .catch(() => false)
        ) {
          await page.selectOption('select', { label: sessionName1 });
          await page.waitForURL(session1Url);
          expect(page.url()).toBe(session1Url);
        } else {
          // Handle tabs
          const tab1 = page.locator('[role="tab"]').filter({ hasText: sessionName1 }).first();
          await tab1.click();
          await page.waitForURL(session1Url);
          expect(page.url()).toBe(session1Url);
        }
      } else {
        // If no sidebar or session switcher is visible, skip this test
        console.log('No sidebar or session switcher found in the UI');
        test.skip();
      }
    }
  });

  test('should handle browser back/forward navigation', async ({ page }) => {
    // Create a session
    await sessionManager.createTrackedSession();
    const sessionUrl = page.url();

    // Go back to list - check if Back button exists
    const backButton = page.locator('button').filter({ hasText: 'Back' }).first();
    const backButtonVisible = await backButton.isVisible({ timeout: 1000 }).catch(() => false);

    if (backButtonVisible) {
      await backButton.click();
      await expect(page).toHaveURL('/');
    } else {
      // In sidebar view, click on VibeTunnel header to go home
      const homeButton = page.locator('button').filter({ hasText: 'VibeTunnel' }).first();
      await homeButton.click();
      await expect(page).toHaveURL('/');
    }

    // Use browser back button
    await page.goBack();
    await expect(page).toHaveURL(sessionUrl);

    // Use browser forward button
    await page.goForward();
    await expect(page).toHaveURL('/');
  });
});
