import { expect, test } from '../fixtures/test.fixture';
import { cleanupSessions, generateTestSessionName } from '../helpers/terminal.helper';

test.describe('Basic Session Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Clean up any existing sessions
    await cleanupSessions(page);
  });

  test('should create a new session', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');

    // Wait for app to load
    await page.waitForSelector('vibetunnel-app', { state: 'attached' });

    // Click the create session button
    await page.click('button[title="Create New Session"]');

    // Wait for the modal
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    // IMPORTANT: Turn off spawn window to create web session
    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    // Click create button
    await page.click('button:has-text("Create")');

    // Verify we navigated to a session
    await expect(page).toHaveURL(/\?session=/);

    // Verify terminal is visible
    await page.waitForSelector('vibe-terminal', { state: 'visible' });
  });

  test('should list created sessions', async ({ page }) => {
    // Create a session first
    await page.goto('/');
    await page.waitForSelector('vibetunnel-app', { state: 'attached' });
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    // Turn off spawn window
    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    // Give it a unique custom name
    const sessionName = generateTestSessionName();
    await page.fill('input[placeholder="My Session"]', sessionName);
    await page.click('button:has-text("Create")');

    // Wait for navigation
    await expect(page).toHaveURL(/\?session=/);
    await page.waitForSelector('vibe-terminal', { state: 'visible' });

    // Go back to session list
    await page.goto('/');

    // Check if our session is listed (use first() to handle multiple matches)
    const sessionCard = page.locator('session-card').filter({ hasText: sessionName }).first();
    await expect(sessionCard).toBeVisible();
  });

  test('should navigate between sessions', async ({ page }) => {
    // Create two sessions
    await page.goto('/');
    await page.waitForSelector('vibetunnel-app', { state: 'attached' });

    // First session
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    // Turn off spawn window
    const spawnWindowToggle1 = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle1.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle1.click();
    }

    const sessionOneName = generateTestSessionName();
    await page.fill('input[placeholder="My Session"]', sessionOneName);
    await page.click('button:has-text("Create")');
    await expect(page).toHaveURL(/\?session=/);
    const firstSessionUrl = page.url();

    // Second session
    await page.goto('/');
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    // Turn off spawn window again
    const spawnWindowToggle2 = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle2.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle2.click();
    }

    const sessionTwoName = generateTestSessionName();
    await page.fill('input[placeholder="My Session"]', sessionTwoName);
    await page.click('button:has-text("Create")');
    await expect(page).toHaveURL(/\?session=/);
    const secondSessionUrl = page.url();

    // Verify URLs are different
    expect(firstSessionUrl).not.toBe(secondSessionUrl);

    // Go back to session list
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible' });

    // Both sessions should be listed
    const sessionOne = page.locator('session-card').filter({ hasText: sessionOneName });
    const sessionTwo = page.locator('session-card').filter({ hasText: sessionTwoName });

    await expect(sessionOne).toBeVisible();
    await expect(sessionTwo).toBeVisible();
  });
});
