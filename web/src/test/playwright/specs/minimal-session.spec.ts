import { expect, test } from '../fixtures/test.fixture';
import { generateTestSessionName } from '../helpers/terminal.helper';

test.describe('Minimal Session Tests', () => {
  test('should create and list a session', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');

    // Wait for app to load
    await page.waitForSelector('vibetunnel-app', { state: 'attached' });
    await page.waitForTimeout(1000);

    // Click the create session button
    await page.click('button[title="Create New Session"]');

    // Wait for the modal content to appear (modal renders nothing when not visible)
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    // IMPORTANT: Turn OFF "Spawn window" to create web sessions instead of native terminals
    // Find the toggle switch by its role and current state
    const spawnWindowToggle = page.locator('button[role="switch"]');
    const isSpawnWindowOn = (await spawnWindowToggle.getAttribute('aria-checked')) === 'true';
    if (isSpawnWindowOn) {
      await spawnWindowToggle.click();
      // Verify it's now off
      await expect(spawnWindowToggle).toHaveAttribute('aria-checked', 'false');
    }

    // Fill in session name
    const sessionName = generateTestSessionName();
    await page.fill('input[placeholder="My Session"]', sessionName);

    // Click create button
    await page.click('button:has-text("Create")');

    // Verify we navigated to a session
    await expect(page).toHaveURL(/\?session=/, { timeout: 10000 });

    // Wait for terminal to be visible
    await page.waitForSelector('vibe-terminal', { state: 'visible', timeout: 10000 });

    // Go back to session list
    await page.goto('/');
    await page.waitForSelector('vibetunnel-app', { state: 'attached' });

    // Check if our session is listed
    const sessionCard = page.locator('session-card').filter({ hasText: sessionName }).first();
    await expect(sessionCard).toBeVisible({ timeout: 5000 });
  });

  test('should create multiple sessions', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForSelector('vibetunnel-app', { state: 'attached' });

    const sessions = [];

    // Create 3 sessions
    for (let i = 0; i < 3; i++) {
      // Make sure we're on the home page before creating a session
      const currentUrl = page.url();
      if (currentUrl.includes('?session=')) {
        await page.goto('/');
        await page.waitForSelector('vibetunnel-app', { state: 'attached' });
        await page.waitForTimeout(500); // Give time for navigation
      }

      // Click create button
      await page.click('button[title="Create New Session"]');

      // Wait for the modal content to appear
      await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

      // IMPORTANT: Turn OFF "Spawn window" toggle
      const spawnWindowToggle = page.locator('button[role="switch"]');
      const isSpawnWindowOn = (await spawnWindowToggle.getAttribute('aria-checked')) === 'true';
      if (isSpawnWindowOn) {
        await spawnWindowToggle.click();
        await expect(spawnWindowToggle).toHaveAttribute('aria-checked', 'false');
      }

      // Give unique name
      const name = generateTestSessionName();
      sessions.push(name);
      await page.fill('input[placeholder="My Session"]', name);

      // Add small delay to avoid race conditions
      await page.waitForTimeout(100);

      // Click create button in modal
      await page.click('button:has-text("Create")');

      // Wait for navigation to session
      await page.waitForURL(/\?session=/, { timeout: 10000 });

      // Wait for terminal to be visible
      await page.waitForSelector('vibe-terminal', {
        state: 'visible',
        timeout: 10000,
      });

      // Small delay to ensure session is fully loaded
      await page.waitForTimeout(1000);
    }

    // Navigate back to home to verify all sessions
    await page.goto('/');
    await page.waitForSelector('vibetunnel-app', { state: 'attached' });

    // Wait for session cards to load
    await page.waitForSelector('session-card', { state: 'visible' });

    // Verify all sessions are listed
    for (const sessionName of sessions) {
      const sessionCard = page.locator('session-card').filter({ hasText: sessionName }).first();
      await expect(sessionCard).toBeVisible({ timeout: 5000 });
    }

    // Count total session cards (should be at least our 3)
    const totalCards = await page.locator('session-card').count();
    expect(totalCards).toBeGreaterThanOrEqual(3);
  });
});
