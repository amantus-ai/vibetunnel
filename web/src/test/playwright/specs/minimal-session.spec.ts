import { expect, test } from '../fixtures/test.fixture';
import { generateTestSessionName } from '../helpers/terminal.helper';
import { createSession, waitForSessionsToLoad } from '../helpers/session.helper';
import { navigateToHome } from '../helpers/navigation.helper';

test.describe('Minimal Session Tests', () => {
  test('should create and list a session', async ({ page }) => {
    // Wait for page to be ready
    await page.waitForSelector('button[title="Create New Session"]', {
      state: 'visible',
      timeout: 5000,
    });

    // Create a session with spawn_terminal: false
    const sessionName = generateTestSessionName();
    const sessionId = await createSession(page, {
      name: sessionName,
      spawnWindow: false,
    });

    console.log(`Created session ${sessionId} with name: ${sessionName}`);

    // Navigate back to home
    await navigateToHome(page);

    // Wait for sessions to load
    await waitForSessionsToLoad(page);

    // Debug: log all session cards found
    const sessionCount = await page.locator('session-card').count();
    console.log(`Found ${sessionCount} session cards after navigation`);

    // Check if our session is listed
    const sessionCard = page.locator('session-card').filter({ hasText: sessionName }).first();
    await expect(sessionCard).toBeVisible({ timeout: 10000 });
  });

  test('should create multiple sessions', async ({ page }) => {
    // Page is already loaded from fixture
    await page.waitForSelector('button[title="Create New Session"]', {
      state: 'visible',
      timeout: 5000,
    });

    const sessionNames: string[] = [];
    const sessionIds: string[] = [];

    // Create 3 sessions
    for (let i = 0; i < 3; i++) {
      // Make sure we're on the home page before creating a session
      const currentUrl = page.url();
      if (currentUrl.includes('?session=')) {
        await navigateToHome(page);
        await waitForSessionsToLoad(page);
      }

      // Create a session
      const name = generateTestSessionName();
      sessionNames.push(name);

      const sessionId = await createSession(page, {
        name,
        spawnWindow: false,
      });
      sessionIds.push(sessionId);

      console.log(`Created session ${i + 1}: ${sessionId} with name: ${name}`);
    }

    // Navigate back to home
    await navigateToHome(page);

    // Wait for sessions to load
    await waitForSessionsToLoad(page);

    // Debug: log session count
    const totalCards = await page.locator('session-card').count();
    console.log(`Found ${totalCards} total session cards`);

    // Verify all sessions are listed
    for (const sessionName of sessionNames) {
      const sessionCard = page.locator('session-card').filter({ hasText: sessionName }).first();
      await expect(sessionCard).toBeVisible({ timeout: 10000 });
    }

    // Count total session cards (should be at least our 3)
    expect(totalCards).toBeGreaterThanOrEqual(3);
  });
});
