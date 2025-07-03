import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { TIMEOUTS } from '../constants/timeouts';
import { SessionListPage } from '../pages/session-list.page';

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
  const { timeout = 5000 } = options || {};
  await page.waitForSelector('session-card', { state: 'visible', timeout });
  return await page.locator('session-card').count();
}

/**
 * Click a session card with retry logic for reliability
 */
export async function clickSessionCardWithRetry(page: Page, sessionName: string): Promise<void> {
  const sessionCard = page.locator(`session-card:has-text("${sessionName}")`);

  // Wait for card to be stable
  await sessionCard.waitFor({ state: 'visible' });
  await sessionCard.scrollIntoViewIfNeeded();
  await page.waitForLoadState('networkidle');

  try {
    await sessionCard.click();
    await page.waitForURL(/\?session=/, { timeout: 5000 });
  } catch {
    // Retry with different approach
    const clickableArea = sessionCard.locator('div.card').first();
    await clickableArea.click();
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
      const text = terminal?.textContent || '';
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
      const text = terminal?.textContent || '';
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
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle');

  // Also wait for app-specific ready state
  await page.waitForSelector('body.ready', { state: 'attached', timeout: 5000 }).catch(() => {
    // Fallback if no ready class
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

  if (await backButton.isVisible({ timeout: 1000 })) {
    await backButton.click();
  } else if (await vibeTunnelLogo.isVisible({ timeout: 1000 })) {
    await vibeTunnelLogo.click();
  } else if (await homeButton.isVisible({ timeout: 1000 })) {
    await homeButton.click();
  } else {
    // Fallback to direct navigation
    await page.goto('/');
  }

  await page.waitForLoadState('domcontentloaded');
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
  const spawnWindowToggle = page.locator('button[role="switch"]');
  if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
    await spawnWindowToggle.click();
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
  await page.waitForFunction(
    () => {
      const cards = document.querySelectorAll('session-card');
      const noSessionsMsg = document.querySelector('.text-dark-text-muted');
      return cards.length > 0 || noSessionsMsg?.textContent?.includes('No terminal sessions');
    },
    { timeout }
  );
}

/**
 * Refresh page and verify session is still accessible
 */
export async function refreshAndVerifySession(page: Page, sessionName: string): Promise<void> {
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  const currentUrl = page.url();
  if (currentUrl.includes('?session=')) {
    await page.waitForSelector('vibe-terminal', { state: 'visible', timeout: 4000 });
  } else {
    // We got redirected to list, reconnect
    await page.waitForSelector('session-card', { state: 'visible' });
    const sessionListPage = new SessionListPage(page);
    await sessionListPage.clickSession(sessionName);
    await expect(page).toHaveURL(/\?session=/);
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
      return (
        terminal &&
        (terminal.textContent?.trim().length > 0 ||
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
