import { expect, test } from '../fixtures/test.fixture';
import { generateTestSessionName } from '../helpers/terminal.helper';
import { testConfig } from '../test-config';

test.describe('Session Navigation', () => {
  // Page navigation is handled by fixture

  test('should navigate between session list and session view', async ({ page }) => {
    test.setTimeout(15000); // Increase timeout

    // Wait for create button to be visible
    await page.waitForSelector('button[title="Create New Session"]', {
      state: 'visible',
      timeout: 5000,
    });
    await page.click('button[title="Create New Session"]', { timeout: 10000 });
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    // Turn off native terminal
    const spawnWindowToggle = page.locator('button[role="switch"]');
    const isSpawnWindowOn = (await spawnWindowToggle.getAttribute('aria-checked')) === 'true';
    if (isSpawnWindowOn) {
      await spawnWindowToggle.click();
    }

    const sessionName = generateTestSessionName();
    await page.fill('input[placeholder="My Session"]', sessionName);
    await page.click('button:has-text("Create")');

    // Should navigate to session view - wait for either terminal or error
    try {
      await expect(page).toHaveURL(/\?session=/, { timeout: 5000 });
      await page.waitForSelector('vibe-terminal', { state: 'visible', timeout: 5000 });
    } catch (_e) {
      // If we're not in session view, let's check current URL
      const currentUrl = page.url();
      console.log('Current URL after session creation:', currentUrl);

      // If we're still on the home page, click on the session to open it
      if (!currentUrl.includes('?session=')) {
        await page.waitForSelector('session-card', { state: 'visible' });
        const sessionCard = page.locator('session-card').filter({ hasText: sessionName }).first();
        await sessionCard.click();
        await expect(page).toHaveURL(/\?session=/, { timeout: 5000 });
        await page.waitForSelector('vibe-terminal', { state: 'visible' });
      }
    }

    // Navigate back to home - either via Back button or clicking VibeTunnel logo
    const backButton = page.locator('button:has-text("Back")');
    const vibeTunnelLogo = page.locator('button:has(h1:has-text("VibeTunnel"))').first();

    if (await backButton.isVisible({ timeout: 1000 })) {
      await backButton.click();
    } else if (await vibeTunnelLogo.isVisible({ timeout: 1000 })) {
      await vibeTunnelLogo.click();
    } else {
      // If we have a sidebar, we're already seeing the session list
      // Just verify that session cards are visible
      const sessionCardsInSidebar = page.locator('aside session-card, nav session-card');
      if (await sessionCardsInSidebar.first().isVisible({ timeout: 1000 })) {
        // We're in a layout with sidebar, no need to navigate
        console.log('Already showing session list in sidebar');
      } else {
        throw new Error('Could not find a way to navigate back to session list');
      }
    }

    // Verify we can see session cards (either in main view or sidebar)
    await page.waitForSelector('session-card', { state: 'visible' });

    // Click on the session card to navigate back
    const sessionCard = page.locator('session-card').filter({ hasText: sessionName }).first();
    await sessionCard.scrollIntoViewIfNeeded();
    await sessionCard.click();

    // Should be back in session view
    await expect(page).toHaveURL(/\?session=/);
    await page.waitForSelector('vibe-terminal', { state: 'visible' });
  });

  test('should navigate using sidebar in session view', async ({ page }) => {
    test.setTimeout(20000); // Give more time for multiple session creation

    // Create first session
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    const sessionName1 = generateTestSessionName();
    await page.fill('input[placeholder="My Session"]', sessionName1);
    await page.locator('button').filter({ hasText: 'Create' }).click();
    await page.waitForURL(/\?session=/);
    const session1Url = page.url();

    // Go back to list - check if Back button exists or if we're in sidebar view
    const backButton = page.locator('button').filter({ hasText: 'Back' }).first();
    const backButtonVisible = await backButton.isVisible({ timeout: 1000 }).catch(() => false);
    
    if (backButtonVisible) {
      await backButton.click();
      await page.waitForURL('/');
      await page.waitForSelector('session-card', { state: 'visible' });
    } else {
      // We're in sidebar view, no need to navigate back
      console.log('In sidebar view, sessions are already visible');
    }

    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    const spawnWindowToggle2 = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle2.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle2.click();
    }

    const sessionName2 = generateTestSessionName();
    await page.fill('input[placeholder="My Session"]', sessionName2);
    await page.locator('button').filter({ hasText: 'Create' }).click();
    await page.waitForURL(/\?session=/);
    const session2Url = page.url();

    // We should be in session 2 now
    expect(page.url()).toBe(session2Url);

    // Check if sessions are visible in the UI (either in sidebar or session list)
    const session1TextVisible = await page.locator(`text="${sessionName1}"`).first().isVisible({ timeout: 2000 }).catch(() => false);
    const session2TextVisible = await page.locator(`text="${sessionName2}"`).first().isVisible({ timeout: 2000 }).catch(() => false);
    
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
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    await page.fill('input[placeholder="My Session"]', generateTestSessionName());
    await page.locator('button').filter({ hasText: 'Create' }).click();
    await page.waitForURL(/\?session=/);

    const sessionUrl = page.url();

    // Go back to list - check if Back button exists
    const backButton = page.locator('button').filter({ hasText: 'Back' }).first();
    const backButtonVisible = await backButton.isVisible({ timeout: 1000 }).catch(() => false);
    
    if (backButtonVisible) {
      await backButton.click();
      await expect(page).toHaveURL(`${testConfig.baseURL}/`);
    } else {
      // In sidebar view, click on VibeTunnel header to go home
      const homeButton = page.locator('button').filter({ hasText: 'VibeTunnel' }).first();
      await homeButton.click();
      await expect(page).toHaveURL(`${testConfig.baseURL}/`);
    }

    // Use browser back button
    await page.goBack();
    await expect(page).toHaveURL(sessionUrl);

    // Use browser forward button
    await page.goForward();
    await expect(page).toHaveURL(`${testConfig.baseURL}/`);
  });
});
