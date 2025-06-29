import { expect, test } from '../fixtures/test.fixture';
import { createSession, waitForSessionsToLoad } from '../helpers/session.helper';
import { navigateToHome } from '../helpers/navigation.helper';
import { generateTestSessionName } from '../helpers/terminal.helper';

test.describe('Session Persistence Tests', () => {
  test('should create and find a long-running session', async ({ page }) => {
    // Wait for page to be ready
    await page.waitForSelector('button[title="Create New Session"]', {
      state: 'visible',
      timeout: 5000,
    });

    // Create a session with a command that runs longer
    const sessionName = generateTestSessionName();
    const sessionId = await createSession(page, {
      name: sessionName,
      command: 'bash -c "sleep 30"', // Sleep for 30 seconds to keep session running
      spawnWindow: false,
    });

    console.log(`Created session ${sessionId} with name: ${sessionName}`);

    // Navigate back to home
    await navigateToHome(page);

    // Wait for sessions to load
    await waitForSessionsToLoad(page);

    // Check the session list
    const sessionCards = await page.locator('session-card').count();
    console.log(`Found ${sessionCards} session cards`);

    // Look for our specific session
    const ourSession = page.locator('session-card').filter({ hasText: sessionName });
    const isVisible = await ourSession.isVisible();
    console.log(`Our session card is visible: ${isVisible}`);

    // If not visible, check what's in the session list
    if (!isVisible) {
      const allSessionTexts = await page.locator('session-card').allTextContents();
      console.log('All session cards:', allSessionTexts);

      // Check if the API returns our session
      const apiSessions = await page.evaluate(async () => {
        const response = await fetch('/api/sessions');
        return await response.json();
      });

      const ourApiSession = apiSessions.find((s: any) => s.name === sessionName);
      console.log('Our session from API:', ourApiSession);
    }

    // Verify our session is visible
    await expect(ourSession.first()).toBeVisible({ timeout: 5000 });
  });

  test('should handle session with error gracefully', async ({ page }) => {
    // Wait for page to be ready
    await page.waitForSelector('button[title="Create New Session"]', {
      state: 'visible',
      timeout: 5000,
    });

    // Create a session with a command that will fail
    const sessionName = generateTestSessionName();
    const sessionId = await createSession(page, {
      name: sessionName,
      command: 'this-command-does-not-exist',
      spawnWindow: false,
    });

    console.log(`Created session ${sessionId} with name: ${sessionName}`);

    // Navigate back to home
    await navigateToHome(page);

    // Wait for sessions to load
    await waitForSessionsToLoad(page);

    // With hideExitedSessions=false, we should see the exited session
    const sessionCards = await page.locator('session-card').count();
    console.log(`Found ${sessionCards} session cards (including exited)`);

    const ourSession = page.locator('session-card').filter({ hasText: sessionName });
    await expect(ourSession.first()).toBeVisible({ timeout: 5000 });

    // Check if it shows as exited
    const sessionText = await ourSession.first().textContent();
    console.log('Session card text:', sessionText);
    expect(sessionText).toContain('exited');
  });
});

