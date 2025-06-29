import { expect, test } from '../fixtures/test.fixture';
import { navigateToHome } from '../helpers/navigation.helper';
import { generateTestSessionName } from '../helpers/terminal.helper';

test.describe('Basic Session Tests', () => {
  // Page navigation and cleanup is handled by fixture

  test('should create a new session', async ({ page }) => {
    // App is already loaded from fixture

    // Wait for create button to be visible and ready
    await page.waitForSelector('button[title="Create New Session"]', {
      state: 'visible',
      timeout: 5000,
    });

    // Click the create session button
    await page.click('button[title="Create New Session"]', { timeout: 10000 });

    // Check if we're already in a session (quick create without modal)
    const currentUrl = page.url();
    if (currentUrl.includes('?session=')) {
      // Already navigated to session, verify terminal is visible
      await page.waitForSelector('vibe-terminal', { state: 'visible' });
      return;
    }

    // Otherwise, wait for the modal
    try {
      await page.waitForSelector('input[placeholder="My Session"]', {
        state: 'visible',
        timeout: 2000,
      });

      // IMPORTANT: Turn off spawn window to create web session
      const spawnWindowToggle = page.locator('button[role="switch"]');
      if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
        await spawnWindowToggle.click();
      }

      // Click create button
      await page.locator('button').filter({ hasText: 'Create' }).click();

      // Verify we navigated to a session
      await expect(page).toHaveURL(/\?session=/, { timeout: 10000 });

      // Verify terminal is visible
      await page.waitForSelector('vibe-terminal', { state: 'visible' });
    } catch (_e) {
      // If modal doesn't appear and we're not in a session, fail
      throw new Error('Expected either modal or immediate session creation');
    }
  });

  test('should list created sessions', async ({ page }) => {
    // Create a session first
    await page.goto('/');
    await page.waitForSelector('vibetunnel-app', { state: 'attached' });

    // Wait for create button to be visible and ready
    await page.waitForSelector('button[title="Create New Session"]', {
      state: 'visible',
      timeout: 5000,
    });
    await page.click('button[title="Create New Session"]', { timeout: 10000 });

    let sessionName = generateTestSessionName();

    // Check if we're already in a session (quick create without modal)
    const currentUrl = page.url();
    if (!currentUrl.includes('?session=')) {
      // Modal appeared, fill it out
      await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

      // Turn off spawn window
      const spawnWindowToggle = page.locator('button[role="switch"]');
      if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
        await spawnWindowToggle.click();
      }

      // Give it a unique custom name
      await page.fill('input[placeholder="My Session"]', sessionName);
      await page.locator('button').filter({ hasText: 'Create' }).click();
    } else {
      // Quick create happened, extract session ID from URL for identification
      sessionName = 'zsh (~)';
    }

    // Wait for navigation
    await expect(page).toHaveURL(/\?session=/, { timeout: 10000 });
    await page.waitForSelector('vibe-terminal', { state: 'visible', timeout: 10000 });

    // Go back to session list
    await navigateToHome(page);

    // Wait for the page to fully load
    await page.waitForLoadState('networkidle');

    // Wait for session cards with increased timeout for CI
    await page.waitForSelector('session-card', { state: 'visible', timeout: 15000 });

    // Check if our session is listed (use first() to handle multiple matches)
    const sessionCard = page.locator('session-card').filter({ hasText: sessionName }).first();
    await expect(sessionCard).toBeVisible({ timeout: 10000 });
  });

  test('should navigate between sessions', async ({ page }) => {
    test.setTimeout(30000); // Increase timeout for this test
    // Create two sessions
    await page.goto('/');
    await page.waitForSelector('vibetunnel-app', { state: 'attached' });

    // Wait for create button to be visible and ready
    await page.waitForSelector('button[title="Create New Session"]', {
      state: 'visible',
      timeout: 5000,
    });
    await page.click('button[title="Create New Session"]', { timeout: 10000 });

    let sessionOneName = generateTestSessionName();

    // Check if we're already in a session (quick create without modal)
    let currentUrl = page.url();
    if (!currentUrl.includes('?session=')) {
      // Modal appeared, fill it out
      await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

      // Turn off spawn window
      const spawnWindowToggle1 = page.locator('button[role="switch"]');
      if ((await spawnWindowToggle1.getAttribute('aria-checked')) === 'true') {
        await spawnWindowToggle1.click();
      }

      await page.fill('input[placeholder="My Session"]', sessionOneName);
      await page.locator('button').filter({ hasText: 'Create' }).click();
    } else {
      // Quick create happened
      sessionOneName = 'zsh (~)';
    }

    await expect(page).toHaveURL(/\?session=/, { timeout: 10000 });
    const firstSessionUrl = page.url();

    // Second session
    await navigateToHome(page);
    // Wait for create button to be visible again after navigation
    await page.waitForSelector('button[title="Create New Session"]', {
      state: 'visible',
      timeout: 5000,
    });
    await page.click('button[title="Create New Session"]', { timeout: 10000 });

    let sessionTwoName = generateTestSessionName();

    // Check if we're already in a session (quick create without modal)
    currentUrl = page.url();
    if (!currentUrl.includes('?session=')) {
      // Modal appeared, fill it out
      await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

      // Turn off spawn window again
      const spawnWindowToggle2 = page.locator('button[role="switch"]');
      if ((await spawnWindowToggle2.getAttribute('aria-checked')) === 'true') {
        await spawnWindowToggle2.click();
      }

      await page.fill('input[placeholder="My Session"]', sessionTwoName);
      await page.locator('button').filter({ hasText: 'Create' }).click();
    } else {
      // Quick create happened, just get a different identifier
      sessionTwoName = 'test-session';
    }

    await expect(page).toHaveURL(/\?session=/, { timeout: 10000 });
    const secondSessionUrl = page.url();

    // Verify URLs are different
    expect(firstSessionUrl).not.toBe(secondSessionUrl);

    // Go back to session list
    await navigateToHome(page);

    // Wait for the URL to be correct
    await expect(page).toHaveURL('/', { timeout: 5000 });

    // Wait for the page to fully load
    await page.waitForLoadState('domcontentloaded');

    // Wait for at least two session cards to be visible
    await page.waitForSelector('session-card', { state: 'visible', timeout: 15000 });
    const sessionCards = await page.locator('session-card').count();
    expect(sessionCards).toBeGreaterThanOrEqual(2);
  });
});
