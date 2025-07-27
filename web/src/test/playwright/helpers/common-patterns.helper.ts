import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { TIMEOUTS } from '../constants/timeouts';
import { SessionListPage } from '../pages/session-list.page';
import { ensureAllSessionsVisible } from './ui-state.helper';

/**
 * Terminal-related interfaces
 */
export interface TerminalDimensions {
  cols: number;
  rows: number;
  actualCols: number;
  actualRows: number;
}

/**
 * Wait for session cards to be visible and return count
 */
export async function waitForSessionCards(
  page: Page,
  options?: { timeout?: number }
): Promise<number> {
  const { timeout = process.env.CI ? 15000 : 5000 } = options || {};

  // First ensure the app is loaded
  await page.waitForSelector('vibetunnel-app', { state: 'attached', timeout: 5000 });

  // Wait for either session cards or "no sessions" message
  await page.waitForFunction(
    () => {
      const cards = document.querySelectorAll('session-card');
      const noSessionsMsg = document.querySelector('.text-dark-text-muted');
      return cards.length > 0 || noSessionsMsg?.textContent?.includes('No terminal sessions');
    },
    { timeout }
  );

  // Give a moment for DOM to stabilize
  await page.waitForTimeout(500);

  return await page.locator('session-card').count();
}

/**
 * Click a session card with retry logic for reliability
 */
export async function clickSessionCardWithRetry(page: Page, sessionName: string): Promise<void> {
  // First ensure all sessions are visible (including exited ones)
  await ensureAllSessionsVisible(page);

  // Then ensure the session list is loaded
  await page.waitForSelector('session-card', { state: 'visible', timeout: 10000 });

  // Give the session list time to fully render
  await page.waitForTimeout(500);

  const sessionCard = page.locator(`session-card:has-text("${sessionName}")`);

  // Wait for card to be stable with longer timeout
  await sessionCard.waitFor({ state: 'visible', timeout: 10000 });
  await sessionCard.scrollIntoViewIfNeeded();

  // Skip networkidle wait - it's causing timeouts in CI
  // The session list should already be loaded at this point

  try {
    await sessionCard.click({ timeout: 10000 });
    await page.waitForURL(/\/session\//, { timeout: 10000 });
  } catch (_error) {
    console.log(`First click attempt failed for session ${sessionName}, retrying...`);

    // Retry with different approach - click the card content area
    const clickableArea = sessionCard.locator('div.card').first();
    await clickableArea.waitFor({ state: 'visible', timeout: 5000 });
    await clickableArea.click({ force: true });

    // If URL still doesn't change, try one more time with the session name link
    if (!page.url().includes('/session/')) {
      const sessionLink = sessionCard.locator(`text="${sessionName}"`).first();
      await sessionLink.click({ force: true });
    }
  }
}

/**
 * Wait for a button to be fully ready (visible, enabled, not loading)
 */
export async function waitForButtonReady(
  page: Page,
  selector: string,
  options?: { timeout?: number }
): Promise<void> {
  const { timeout = TIMEOUTS.BUTTON_VISIBILITY } = options || {};

  await page.waitForFunction(
    (sel) => {
      const button = document.querySelector(sel);
      // Check if button is not only visible but also enabled and not in loading state
      return (
        button &&
        !button.hasAttribute('disabled') &&
        !button.classList.contains('loading') &&
        !button.classList.contains('opacity-50') &&
        getComputedStyle(button).display !== 'none' &&
        getComputedStyle(button).visibility !== 'hidden'
      );
    },
    selector,
    { timeout }
  );
}

/**
 * Wait for terminal to show a command prompt
 */
export async function waitForTerminalPrompt(page: Page, timeout = 5000): Promise<void> {
  await page.waitForFunction(
    () => {
      const terminal = document.querySelector('vibe-terminal');
      if (!terminal) return false;

      // Check the terminal container first
      const container = terminal.querySelector('#terminal-container');
      const containerText = container?.textContent || '';

      // Fall back to terminal content
      const text = terminal?.textContent || containerText;

      // Terminal is ready when it ends with a prompt character
      return text.trim().endsWith('$') || text.trim().endsWith('>') || text.trim().endsWith('#');
    },
    { timeout }
  );
}

/**
 * Wait for terminal to be busy (not showing prompt)
 */
export async function waitForTerminalBusy(page: Page, timeout = 2000): Promise<void> {
  await page.waitForFunction(
    () => {
      const terminal = document.querySelector('vibe-terminal');
      if (!terminal) return false;

      // Check the terminal container first
      const container = terminal.querySelector('#terminal-container');
      const containerText = container?.textContent || '';

      // Fall back to terminal content
      const text = terminal?.textContent || containerText;

      // Terminal is busy when it doesn't end with prompt
      return !text.trim().endsWith('$') && !text.trim().endsWith('>') && !text.trim().endsWith('#');
    },
    { timeout }
  );
}

/**
 * Wait for page to be fully ready including app-specific indicators
 */
export async function waitForPageReady(page: Page): Promise<void> {
  // Wait for basic DOM content to be loaded
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 });
  } catch (_error) {
    console.warn('waitForLoadState domcontentloaded timed out, continuing...');
  }

  // Wait for the main app component to be attached
  try {
    await page.waitForSelector('vibetunnel-app', { state: 'attached', timeout: 5000 });
  } catch (_error) {
    console.warn('vibetunnel-app selector not found, continuing...');
  }

  // Also wait for app-specific ready state if available
  await page.waitForSelector('body.ready', { state: 'attached', timeout: 2000 }).catch(() => {
    // Fallback if no ready class - this is okay
  });
}

/**
 * Navigate to home page using available methods
 */
export async function navigateToHome(page: Page): Promise<void> {
  // Try multiple methods to navigate home
  const backButton = page.locator('button:has-text("Back")');
  const vibeTunnelLogo = page.locator('button:has(h1:has-text("VibeTunnel"))').first();
  const homeButton = page.locator('button').filter({ hasText: 'VibeTunnel' }).first();

  try {
    if (await backButton.isVisible({ timeout: 1000 })) {
      await backButton.click();
    } else if (await vibeTunnelLogo.isVisible({ timeout: 1000 })) {
      await vibeTunnelLogo.click();
    } else if (await homeButton.isVisible({ timeout: 1000 })) {
      await homeButton.click();
    } else {
      // Fallback to direct navigation with test flag
      await page.goto('/?test=true', { waitUntil: 'domcontentloaded', timeout: 10000 });
      return; // Skip the additional wait since goto already waits
    }

    // Wait for navigation to complete after clicking
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {
      console.warn('Navigation load state timeout, continuing...');
    });
  } catch (error) {
    console.warn('Error during navigation to home, using direct navigation:', error);
    await page.goto('/?test=true', { waitUntil: 'domcontentloaded', timeout: 10000 });
  }
}

/**
 * Close modal if it's open
 */
export async function closeModalIfOpen(page: Page): Promise<void> {
  const modalVisible = await page.locator('.modal-content').isVisible();
  if (modalVisible) {
    await page.keyboard.press('Escape');
    await waitForModalClosed(page);
  }
}

/**
 * Wait for modal to be closed
 */
export async function waitForModalClosed(page: Page, timeout = 2000): Promise<void> {
  await page.waitForSelector('.modal-content', { state: 'hidden', timeout });
}

/**
 * Open create session dialog
 */
export async function openCreateSessionDialog(
  page: Page,
  options?: { disableSpawnWindow?: boolean }
): Promise<void> {
  await page.click('button[title="Create New Session"]');
  await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

  if (options?.disableSpawnWindow) {
    await disableSpawnWindow(page);
  }
}

/**
 * Disable spawn window toggle in create session dialog
 */
export async function disableSpawnWindow(page: Page): Promise<void> {
  // First expand the options section where spawn window toggle is located
  const optionsButton = page.locator('#session-options-button');

  // Options button should always exist in current UI
  await optionsButton.waitFor({ state: 'visible', timeout: 3000 });
  await optionsButton.click();
  await page.waitForTimeout(300); // Wait for expansion animation

  // Now look for the spawn window toggle with specific data-testid
  const spawnWindowToggle = page.locator('[data-testid="spawn-window-toggle"]');

  // Only try to disable if the toggle exists (Mac app connected)
  if ((await spawnWindowToggle.count()) > 0) {
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }
  }
}

/**
 * Get current terminal dimensions
 */
export async function getTerminalDimensions(page: Page): Promise<TerminalDimensions> {
  return await page.evaluate(() => {
    const terminal = document.querySelector('vibe-terminal') as HTMLElement & {
      cols?: number;
      rows?: number;
      actualCols?: number;
      actualRows?: number;
    };
    return {
      cols: terminal?.cols || 80,
      rows: terminal?.rows || 24,
      actualCols: terminal?.actualCols || terminal?.cols || 80,
      actualRows: terminal?.actualRows || terminal?.rows || 24,
    };
  });
}

/**
 * Wait for terminal dimensions to change
 */
export async function waitForTerminalResize(
  page: Page,
  initialDimensions: TerminalDimensions,
  timeout = 2000
): Promise<TerminalDimensions> {
  await page.waitForFunction(
    ({ initial }) => {
      const terminal = document.querySelector('vibe-terminal') as HTMLElement & {
        cols?: number;
        rows?: number;
        actualCols?: number;
        actualRows?: number;
      };
      const currentCols = terminal?.cols || 80;
      const currentRows = terminal?.rows || 24;
      const currentActualCols = terminal?.actualCols || currentCols;
      const currentActualRows = terminal?.actualRows || currentRows;

      return (
        currentCols !== initial.cols ||
        currentRows !== initial.rows ||
        currentActualCols !== initial.actualCols ||
        currentActualRows !== initial.actualRows
      );
    },
    { initial: initialDimensions },
    { timeout }
  );

  return await getTerminalDimensions(page);
}

/**
 * Wait for session list to be ready
 */
export async function waitForSessionListReady(page: Page, timeout = 10000): Promise<void> {
  try {
    await page.waitForFunction(
      () => {
        // Check if the page has the main app component
        const app = document.querySelector('vibetunnel-app');
        if (!app) return false;

        // Check for session cards or "no sessions" message
        const cards = document.querySelectorAll('session-card');
        const noSessionsMsg = document.querySelector('.text-dark-text-muted');
        const emptyMessage = document.querySelector('[data-testid="no-sessions-message"]');

        return (
          cards.length > 0 ||
          noSessionsMsg?.textContent?.includes('No terminal sessions') ||
          noSessionsMsg?.textContent?.includes('No running sessions') ||
          emptyMessage !== null
        );
      },
      { timeout }
    );
  } catch (error) {
    console.warn('waitForSessionListReady timed out, checking current state...');
    // Log current page state for debugging
    const pageContent = await page.evaluate(() => {
      return {
        hasApp: !!document.querySelector('vibetunnel-app'),
        sessionCards: document.querySelectorAll('session-card').length,
        bodyText: document.body.innerText.substring(0, 200),
      };
    });
    console.log('Page state:', pageContent);
    throw error;
  }
}

/**
 * Refresh page and verify session is still accessible
 */
export async function refreshAndVerifySession(page: Page, sessionName: string): Promise<void> {
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  const currentUrl = page.url();
  if (currentUrl.includes('/session/')) {
    await page.waitForSelector('vibe-terminal', { state: 'visible', timeout: 4000 });
  } else {
    // We got redirected to list, reconnect
    await page.waitForSelector('session-card', { state: 'visible' });
    const sessionListPage = new SessionListPage(page);
    await sessionListPage.clickSession(sessionName);
    await expect(page).toHaveURL(/\/session\//);
  }
}

/**
 * Verify multiple sessions are in the list
 */
export async function verifyMultipleSessionsInList(
  page: Page,
  sessionNames: string[]
): Promise<void> {
  // Import assertion helpers
  const { assertSessionCount, assertSessionInList } = await import('./assertion.helper');

  await assertSessionCount(page, sessionNames.length, { operator: 'minimum' });
  for (const sessionName of sessionNames) {
    await assertSessionInList(page, sessionName);
  }
}

/**
 * Wait for specific text in terminal output
 */
export async function waitForTerminalText(
  page: Page,
  searchText: string,
  timeout = 5000
): Promise<void> {
  await page.waitForFunction(
    (text) => {
      const terminal = document.querySelector('vibe-terminal');
      if (!terminal) return false;

      // Check the terminal container first
      const container = terminal.querySelector('#terminal-container');
      if (container?.textContent?.includes(text)) {
        return true;
      }

      // Fall back to terminal content
      return terminal?.textContent?.includes(text);
    },
    searchText,
    { timeout }
  );
}

/**
 * Wait for terminal to be visible and ready
 */
export async function waitForTerminalReady(page: Page, timeout = 4000): Promise<void> {
  await page.waitForSelector('vibe-terminal', { state: 'visible', timeout });

  // Additional check for terminal content or structure
  await page.waitForFunction(
    () => {
      const terminal = document.querySelector('vibe-terminal');
      if (!terminal) return false;

      // Check the terminal container for content
      const container = terminal.querySelector('#terminal-container');
      return (
        terminal &&
        ((container?.textContent?.trim().length || 0) > 0 ||
          terminal.textContent?.trim().length > 0 ||
          !!terminal.shadowRoot ||
          !!terminal.querySelector('.xterm'))
      );
    },
    { timeout: 2000 }
  );
}

/**
 * Wait for kill operation to complete on a session
 */
export async function waitForKillComplete(
  page: Page,
  sessionName: string,
  timeout = 10000
): Promise<void> {
  await page.waitForFunction(
    (name) => {
      const cards = document.querySelectorAll('session-card');
      const sessionCard = Array.from(cards).find((card) => card.textContent?.includes(name));

      // If the card is not found, it was likely hidden after being killed
      if (!sessionCard) return true;

      // If found, check data attributes for status
      const status = sessionCard.getAttribute('data-session-status');
      const isKilling = sessionCard.getAttribute('data-is-killing') === 'true';
      return status === 'exited' || !isKilling;
    },
    sessionName,
    { timeout }
  );
}
