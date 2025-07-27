import type { Page } from '@playwright/test';
import { SessionListPage } from '../pages/session-list.page';

/**
 * Common session patterns helper
 * Reduces duplication across test files
 */

/**
 * Handle spawn window toggle consistently
 */
export async function disableSpawnWindow(page: Page): Promise<void> {
  const spawnWindowToggle = page.locator('button[role="switch"][aria-label*="spawn"]');

  if (await spawnWindowToggle.isVisible()) {
    const isChecked = await spawnWindowToggle.getAttribute('aria-checked');
    if (isChecked === 'true') {
      await spawnWindowToggle.click();

      // Wait for toggle animation to complete
      await page.waitForFunction((selector) => {
        const toggle = document.querySelector(selector);
        return toggle?.getAttribute('aria-checked') === 'false';
      }, 'button[role="switch"][aria-label*="spawn"]');
    }
  }
}

/**
 * Navigate to home and wait for session list
 */
export async function navigateToSessionList(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  // Wait for session cards or empty state
  await page.waitForFunction(() => {
    const cards = document.querySelectorAll('session-card');
    const emptyState = document.querySelector('.text-dark-text-muted');
    return cards.length > 0 || emptyState?.textContent?.includes('No terminal sessions');
  });
}

/**
 * Wait for session card to appear
 */
export async function waitForSessionCard(page: Page, sessionName: string): Promise<void> {
  // First ensure all sessions are visible (including exited ones)
  const { ensureAllSessionsVisible } = await import('./ui-state.helper');
  await ensureAllSessionsVisible(page);

  await page.waitForSelector(`session-card:has-text("${sessionName}")`, {
    state: 'visible',
  });
}

/**
 * Get session status from card
 */
export async function getSessionStatus(page: Page, sessionName: string): Promise<string | null> {
  const sessionCard = page.locator(`session-card:has-text("${sessionName}")`);

  if (!(await sessionCard.isVisible())) {
    return null;
  }

  // Try data attribute first
  const statusElement = sessionCard.locator('span[data-status]');
  if (await statusElement.isVisible()) {
    return await statusElement.getAttribute('data-status');
  }

  // Fallback to text content
  const cardText = await sessionCard.textContent();
  if (cardText?.toLowerCase().includes('running')) return 'running';
  if (cardText?.toLowerCase().includes('exited')) return 'exited';
  if (cardText?.toLowerCase().includes('killed')) return 'killed';

  return null;
}

/**
 * Kill a session and wait for it to be marked as exited
 */
export async function killSessionAndWait(page: Page, sessionName: string): Promise<void> {
  const sessionListPage = new SessionListPage(page);
  await sessionListPage.killSession(sessionName);

  // Wait for session to be marked as exited
  await page.waitForFunction((name) => {
    const cards = document.querySelectorAll('session-card');
    const card = Array.from(cards).find((c) => c.textContent?.includes(name));
    if (!card) return false;

    const text = card.textContent?.toLowerCase() || '';
    return text.includes('exited') || text.includes('killed');
  }, sessionName);
}

/**
 * Click session card to navigate
 */
export async function clickSessionCard(page: Page, sessionName: string): Promise<void> {
  const sessionCard = page.locator(`session-card:has-text("${sessionName}")`);

  await sessionCard.waitFor({ state: 'visible' });
  await sessionCard.scrollIntoViewIfNeeded();

  // Ensure card is stable before clicking
  await sessionCard.waitFor({ state: 'stable' });

  await sessionCard.click();

  // Wait for navigation
  await page.waitForURL(/\/session\//);
}
