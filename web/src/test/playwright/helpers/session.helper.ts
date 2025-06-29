import type { Page } from '@playwright/test';

/**
 * Wait for sessions to be loaded and visible in the session list
 * This helper ensures the session list has had time to fetch and render sessions
 */
export async function waitForSessionsToLoad(
  page: Page,
  options?: { timeout?: number }
): Promise<void> {
  const timeout = options?.timeout || 15000;

  // First, wait for the session list container to be visible
  await page.waitForSelector('[data-testid="session-list-container"]', {
    state: 'visible',
    timeout,
  });

  // Wait for either session cards to appear OR the "no sessions" message
  await page.waitForFunction(
    () => {
      const sessionCards = document.querySelectorAll('session-card');
      const noSessionsMessage = document.querySelector('.text-dark-text-muted');

      // Either we have session cards or we have the "no sessions" message
      return (
        sessionCards.length > 0 ||
        (noSessionsMessage && noSessionsMessage.textContent?.includes('No terminal sessions'))
      );
    },
    { timeout }
  );

  // If we're expecting sessions, wait a bit more for them to fully render
  const hasSessionCards = (await page.locator('session-card').count()) > 0;
  if (hasSessionCards) {
    // Wait for session cards to be fully visible
    await page.waitForSelector('session-card', { state: 'visible', timeout: 5000 });
  }
}

/**
 * Create a session and wait for it to be fully initialized
 */
export async function createSession(
  page: Page,
  options: {
    name?: string;
    command?: string;
    workingDir?: string;
    spawnWindow?: boolean;
  } = {}
): Promise<string> {
  // Click create button
  await page.click('button[title="Create New Session"]');

  // Wait for modal to appear
  await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

  // Set spawn window option
  const spawnWindowToggle = page.locator('button[role="switch"]');
  const isSpawnWindowOn = (await spawnWindowToggle.getAttribute('aria-checked')) === 'true';

  if (options.spawnWindow === true && !isSpawnWindowOn) {
    await spawnWindowToggle.click();
  } else if (options.spawnWindow === false && isSpawnWindowOn) {
    await spawnWindowToggle.click();
  }

  // Fill in the form
  if (options.name) {
    await page.fill('input[placeholder="My Session"]', options.name);
  }

  if (options.command) {
    const commandInput = page.locator('input[placeholder*="command"]');
    await commandInput.clear();
    await commandInput.fill(options.command);
  }

  if (options.workingDir) {
    const workingDirInput = page.locator('input[placeholder*="directory"]');
    await workingDirInput.clear();
    await workingDirInput.fill(options.workingDir);
  }

  // Click create
  await page.locator('button').filter({ hasText: 'Create' }).click();

  // Wait for navigation to session
  await page.waitForURL(/\?session=/, { timeout: 10000 });

  // Extract session ID from URL
  const url = new URL(page.url());
  const sessionId = url.searchParams.get('session');
  if (!sessionId) {
    throw new Error('Session ID not found in URL after creation');
  }

  // Wait for terminal to be ready
  await page.waitForSelector('vibe-terminal', { state: 'visible', timeout: 10000 });

  // Wait a bit more to ensure session is fully initialized
  await page.waitForTimeout(1000);

  return sessionId;
}

