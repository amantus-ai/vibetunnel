import { expect, test } from '../fixtures/test.fixture';
import { generateTestSessionName } from '../helpers/terminal.helper';
import { testConfig } from '../test-config';

test.describe('Session Navigation', () => {
  // Page navigation is handled by fixture

  test('should navigate between session list and session view', async ({ page }) => {
    // Create a new session
    await page.click('button[title="Create New Session"]');
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

    // Should navigate to session view
    await expect(page).toHaveURL(/\?session=/, { timeout: 4000 });
    await page.waitForSelector('vibe-terminal', { state: 'visible' });

    // Click on VibeTunnel logo to go back to list
    await page.click('button:has(h1:has-text("VibeTunnel"))');

    // Should be back at session list
    await expect(page).toHaveURL(`${testConfig.baseURL}/`);
    await page.waitForSelector('session-card', { state: 'visible' });

    // Click on the session card to navigate back
    const sessionCard = page.locator('session-card').filter({ hasText: sessionName }).first();
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
    await page.click('button:has-text("Create")');
    await page.waitForURL(/\?session=/);
    const session1Url = page.url();

    // Go back to list using UI navigation and create second session
    await page.click('button:has(h1:has-text("VibeTunnel"))');
    await page.waitForURL('/');
    await page.waitForSelector('session-card', { state: 'visible' });

    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    const spawnWindowToggle2 = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle2.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle2.click();
    }

    const sessionName2 = generateTestSessionName();
    await page.fill('input[placeholder="My Session"]', sessionName2);
    await page.click('button:has-text("Create")');
    await page.waitForURL(/\?session=/);
    const session2Url = page.url();

    // We should be in session 2 now
    expect(page.url()).toBe(session2Url);

    // Look for sidebar or session switcher
    // The sidebar might be collapsed, look for a button to expand it
    const sidebarToggle = page
      .locator('button[title*="sidebar"], button[aria-label*="sidebar"], button:has-text("☰")')
      .first();
    const sidebarToggleVisible = await sidebarToggle
      .isVisible({ timeout: 1000 })
      .catch(() => false);

    if (sidebarToggleVisible) {
      // Click to expand sidebar
      await sidebarToggle.click();
      await page.waitForTimeout(300); // Wait for animation
    }

    // Look for session list in sidebar or a session switcher component
    const sessionList = page
      .locator('aside session-card, [role="navigation"] session-card, .sidebar session-card')
      .first();
    const sessionListVisible = await sessionList.isVisible({ timeout: 1000 }).catch(() => false);

    if (sessionListVisible) {
      // Click on the first session in sidebar
      const firstSessionInSidebar = page
        .locator('aside session-card, [role="navigation"] session-card, .sidebar session-card')
        .filter({ hasText: sessionName1 })
        .first();
      await expect(firstSessionInSidebar).toBeVisible({ timeout: 2000 });
      await firstSessionInSidebar.click();

      // Should navigate to session 1
      await page.waitForURL(session1Url);
      expect(page.url()).toBe(session1Url);

      // Click on session 2 in sidebar
      const secondSessionInSidebar = page
        .locator('aside session-card, [role="navigation"] session-card, .sidebar session-card')
        .filter({ hasText: sessionName2 })
        .first();
      await expect(secondSessionInSidebar).toBeVisible({ timeout: 2000 });
      await secondSessionInSidebar.click();

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
    await page.click('button:has-text("Create")');
    await page.waitForURL(/\?session=/);

    const sessionUrl = page.url();

    // Go back to list
    await page.click('button:has(h1:has-text("VibeTunnel"))');
    await expect(page).toHaveURL(`${testConfig.baseURL}/`);

    // Use browser back button
    await page.goBack();
    await expect(page).toHaveURL(sessionUrl);

    // Use browser forward button
    await page.goForward();
    await expect(page).toHaveURL(`${testConfig.baseURL}/`);
  });
});
