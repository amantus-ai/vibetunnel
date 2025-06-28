import { expect, test } from '../fixtures/test.fixture';

test.describe('Session Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('vibetunnel-app', { state: 'attached' });
  });

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

    const sessionName = `Nav-Test-${Date.now()}`;
    await page.fill('input[placeholder="My Session"]', sessionName);
    await page.click('button:has-text("Create")');

    // Should navigate to session view
    await expect(page).toHaveURL(/\?session=/, { timeout: 10000 });
    await page.waitForSelector('vibe-terminal', { state: 'visible' });

    // Click on VibeTunnel logo to go back to list
    await page.click('button:has(h1:has-text("VibeTunnel"))');

    // Should be back at session list
    await expect(page).toHaveURL('http://localhost:4020/');
    await page.waitForSelector('session-card', { state: 'visible' });

    // Click on the session card to navigate back
    const sessionCard = page.locator('session-card').filter({ hasText: sessionName }).first();
    await sessionCard.click();

    // Should be back in session view
    await expect(page).toHaveURL(/\?session=/);
    await page.waitForSelector('vibe-terminal', { state: 'visible' });
  });

  test('should navigate using sidebar in session view', async ({ page }) => {
    // Create a session first
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    const sessionName1 = `Sidebar-Test-1-${Date.now()}`;
    await page.fill('input[placeholder="My Session"]', sessionName1);
    await page.click('button:has-text("Create")');
    await page.waitForURL(/\?session=/);

    // Create another session via the sidebar
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    const spawnWindowToggle2 = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle2.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle2.click();
    }

    const sessionName2 = `Sidebar-Test-2-${Date.now()}`;
    await page.fill('input[placeholder="My Session"]', sessionName2);
    await page.click('button:has-text("Create")');
    await page.waitForURL(/\?session=/);

    // Now we should see both sessions in the sidebar
    const sidebar = page.locator('[role="complementary"], aside, nav').first();
    await expect(sidebar.locator('text=' + sessionName1)).toBeVisible();
    await expect(sidebar.locator('text=' + sessionName2)).toBeVisible();

    // Click on the first session in sidebar
    await sidebar.locator('text=' + sessionName1).click();

    // URL should update
    await page.waitForTimeout(500); // Give time for navigation
    const url1 = page.url();

    // Click on the second session
    await sidebar.locator('text=' + sessionName2).click();
    await page.waitForTimeout(500);
    const url2 = page.url();

    // URLs should be different
    expect(url1).not.toBe(url2);
    expect(url1).toContain('?session=');
    expect(url2).toContain('?session=');
  });

  test('should handle browser back/forward navigation', async ({ page }) => {
    // Create a session
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    await page.fill('input[placeholder="My Session"]', `History-Test-${Date.now()}`);
    await page.click('button:has-text("Create")');
    await page.waitForURL(/\?session=/);

    const sessionUrl = page.url();

    // Go back to list
    await page.click('button:has(h1:has-text("VibeTunnel"))');
    await expect(page).toHaveURL('http://localhost:4020/');

    // Use browser back button
    await page.goBack();
    await expect(page).toHaveURL(sessionUrl);

    // Use browser forward button
    await page.goForward();
    await expect(page).toHaveURL('http://localhost:4020/');
  });
});
