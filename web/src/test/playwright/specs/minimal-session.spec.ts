import { expect, test } from '../fixtures/test.fixture';
import { generateTestSessionName } from '../helpers/terminal.helper';

test.describe('Minimal Session Tests', () => {
  test('should create and list a session', async ({ page }) => {
    // Wait for create button to be available (page is already navigated in fixture)
    await page.waitForSelector('button[title="Create New Session"]', {
      state: 'visible',
      timeout: 5000,
    });

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
    await expect(page).toHaveURL(/\?session=/, { timeout: 4000 });

    // Wait for terminal to be visible
    await page.waitForSelector('vibe-terminal', { state: 'visible', timeout: 4000 });

    // Go back to session list
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible', timeout: 5000 });

    // Check if our session is listed
    const sessionCard = page.locator('session-card').filter({ hasText: sessionName }).first();
    await expect(sessionCard).toBeVisible({ timeout: 4000 });
  });

  test('should create multiple sessions', async ({ page }) => {
    // Page is already loaded from fixture
    await page.waitForSelector('button[title="Create New Session"]', {
      state: 'visible',
      timeout: 5000,
    });

    const sessions = [];

    // Create 3 sessions
    for (let i = 0; i < 3; i++) {
      // Make sure we're on the home page before creating a session
      const currentUrl = page.url();
      if (currentUrl.includes('?session=')) {
        await page.goto('/');
        await page.waitForSelector('button[title="Create New Session"]', {
          state: 'visible',
          timeout: 5000,
        });
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

      // Wait for form to be ready
      await page.waitForTimeout(200); // Small delay to ensure form is ready

      // Click create button in modal
      const createButton = page.locator('button').filter({ hasText: 'Create' }).first();
      await expect(createButton).toBeEnabled({ timeout: 1000 });
      await createButton.click();

      // Wait for navigation to session
      await page.waitForURL(/\?session=/, { timeout: 4000 });

      // Wait for terminal to be visible
      await page.waitForSelector('vibe-terminal', {
        state: 'visible',
        timeout: 4000,
      });

      // Wait for terminal to be fully initialized
      await page.waitForFunction(
        () => {
          const terminal = document.querySelector('vibe-terminal');
          return terminal && (terminal.textContent?.trim().length > 0 || !!terminal.shadowRoot);
        },
        { timeout: 2000 }
      );
    }

    // Navigate back to home to verify all sessions
    await page.goto('/');

    // Wait for session cards to load
    await page.waitForSelector('session-card', { state: 'visible' });

    // Verify all sessions are listed
    for (const sessionName of sessions) {
      const sessionCard = page.locator('session-card').filter({ hasText: sessionName }).first();
      await expect(sessionCard).toBeVisible({ timeout: 4000 });
    }

    // Count total session cards (should be at least our 3)
    const totalCards = await page.locator('session-card').count();
    expect(totalCards).toBeGreaterThanOrEqual(3);
  });
});
