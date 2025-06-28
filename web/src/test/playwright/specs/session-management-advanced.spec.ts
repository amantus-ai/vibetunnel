import { expect, test } from '../fixtures/test.fixture';
import { generateTestSessionName } from '../helpers/terminal.helper';

test.describe('Advanced Session Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('vibetunnel-app', { state: 'attached' });
  });

  test('should kill individual sessions', async ({ page }) => {
    // Create a session
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    const sessionName = generateTestSessionName();
    await page.fill('input[placeholder="My Session"]', sessionName);
    await page.click('button:has-text("Create")');
    await page.waitForURL(/\?session=/);

    // Go back to session list
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible' });

    // Find the session card
    const sessionCard = page.locator('session-card').filter({ hasText: sessionName }).first();
    await expect(sessionCard).toBeVisible();

    // Hover over the session card to reveal kill button
    await sessionCard.hover();

    // Click kill button
    const killButton = sessionCard.locator('button[title="Kill session"]');
    await killButton.click();

    // Session status should change
    await expect(sessionCard.locator('text=exited')).toBeVisible({ timeout: 5000 });
  });

  test('should kill all sessions at once', async ({ page }) => {
    // Create multiple sessions
    const sessionNames = [];
    for (let i = 0; i < 3; i++) {
      await page.click('button[title="Create New Session"]');
      await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

      const spawnWindowToggle = page.locator('button[role="switch"]');
      if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
        await spawnWindowToggle.click();
      }

      const name = generateTestSessionName();
      sessionNames.push(name);
      await page.fill('input[placeholder="My Session"]', name);
      await page.click('button:has-text("Create")');
      await page.waitForURL(/\?session=/);
      await page.goto('/');
    }

    // Count running sessions
    const runningBefore = await page.locator('session-card:has(text="running")').count();
    expect(runningBefore).toBeGreaterThanOrEqual(3);

    // Click Kill All button
    const killAllButton = page.locator('button:has-text("Kill All")');
    await killAllButton.click();

    // Wait for sessions to be killed
    await page.waitForTimeout(2000);

    // All sessions should show as exited
    for (const name of sessionNames) {
      const card = page.locator('session-card').filter({ hasText: name }).first();
      await expect(card.locator('text=exited')).toBeVisible({ timeout: 5000 });
    }
  });

  test('should copy session information', async ({ page }) => {
    // Create a session
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    const sessionName = generateTestSessionName();
    await page.fill('input[placeholder="My Session"]', sessionName);
    await page.click('button:has-text("Create")');
    await page.waitForURL(/\?session=/);

    // Should see copy buttons for path and PID
    await expect(page.locator('[title="Click to copy path"]')).toBeVisible();

    // Click to copy path
    await page.click('[title="Click to copy path"]');

    // Visual feedback would normally appear (toast notification)
    // We can't test clipboard content directly in Playwright

    // Go back to list view
    await page.goto('/');
    const sessionCard = page.locator('session-card').filter({ hasText: sessionName }).first();

    // Hover to see PID copy option
    await sessionCard.hover();
    const pidElement = sessionCard.locator('[title*="Click to copy PID"]');
    await expect(pidElement).toBeVisible();

    // Click to copy PID
    await pidElement.click();
  });

  test('should display session metadata correctly', async ({ page }) => {
    // Create a session with specific working directory
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    const sessionName = generateTestSessionName();
    await page.fill('input[placeholder="My Session"]', sessionName);

    // Change working directory
    await page.fill('input[placeholder="~/"]', '/tmp');

    await page.click('button:has-text("Create")');
    await page.waitForURL(/\?session=/);

    // Check that the path is displayed
    await expect(page.locator('text=/tmp')).toBeVisible();

    // Check terminal size is displayed
    await expect(page.locator('text=/\\d+×\\d+/')).toBeVisible();

    // Check status indicator
    await expect(page.locator('text=RUNNING')).toBeVisible();
  });

  test('should filter sessions by status', async ({ page }) => {
    // This test assumes there might be an option to hide/show exited sessions
    // Create a session and kill it
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    const sessionName = generateTestSessionName();
    await page.fill('input[placeholder="My Session"]', sessionName);
    await page.click('button:has-text("Create")');
    await page.waitForURL(/\?session=/);

    // Go back and kill the session
    await page.goto('/');
    const sessionCard = page.locator('session-card').filter({ hasText: sessionName }).first();
    await sessionCard.hover();
    await sessionCard.locator('button[title="Kill session"]').click();

    // Wait for it to be killed
    await expect(sessionCard.locator('text=exited')).toBeVisible({ timeout: 5000 });

    // The exited session should still be visible by default
    await expect(sessionCard).toBeVisible();
  });
});
