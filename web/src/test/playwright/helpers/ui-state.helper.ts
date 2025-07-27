import type { Locator, Page } from '@playwright/test';
import { TIMEOUTS } from '../constants/timeouts';

/**
 * Helper function to check the visibility state of exited sessions
 * @param page - The Playwright page object
 * @returns Object with visibility state and toggle button locator
 */
export async function getExitedSessionsVisibility(page: Page): Promise<{
  visible: boolean;
  toggleButton: Locator | null;
}> {
  const hideExitedButton = page
    .locator('button')
    .filter({ hasText: /Hide Exited/i })
    .first();
  const showExitedButton = page
    .locator('button')
    .filter({ hasText: /Show Exited/i })
    .first();

  if (await hideExitedButton.isVisible({ timeout: 1000 })) {
    // "Hide Exited" button is visible, meaning exited sessions are currently shown
    return { visible: true, toggleButton: hideExitedButton };
  } else if (await showExitedButton.isVisible({ timeout: 1000 })) {
    // "Show Exited" button is visible, meaning exited sessions are currently hidden
    return { visible: false, toggleButton: showExitedButton };
  }

  // Neither button is visible - exited sessions state is indeterminate
  return { visible: false, toggleButton: null };
}

/**
 * Toggle the visibility of exited sessions
 * @param page - The Playwright page object
 * @returns The new visibility state
 */
export async function toggleExitedSessions(page: Page): Promise<boolean> {
  const { toggleButton } = await getExitedSessionsVisibility(page);

  if (toggleButton) {
    await toggleButton.click();
    // Wait for the UI to update by checking button text change
    await page.waitForFunction(
      () => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const hasHideButton = buttons.some((btn) => btn.textContent?.match(/Hide Exited/i));
        const hasShowButton = buttons.some((btn) => btn.textContent?.match(/Show Exited/i));
        return hasHideButton || hasShowButton;
      },
      { timeout: TIMEOUTS.UI_UPDATE }
    );
  }

  // Return the new state
  const newState = await getExitedSessionsVisibility(page);
  return newState.visible;
}

/**
 * Ensure exited sessions are visible
 * @param page - The Playwright page object
 */
export async function ensureExitedSessionsVisible(page: Page): Promise<void> {
  const { visible, toggleButton } = await getExitedSessionsVisibility(page);

  if (!visible && toggleButton) {
    await toggleButton.click();
    console.log('Clicked Show Exited button to make exited sessions visible');
    // Wait for the button text to change to "Hide Exited"
    await page.waitForFunction(
      () => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.some((btn) => btn.textContent?.match(/Hide Exited/i));
      },
      { timeout: TIMEOUTS.UI_UPDATE }
    );
  }
}

/**
 * Ensure exited sessions are hidden
 * @param page - The Playwright page object
 */
export async function ensureExitedSessionsHidden(page: Page): Promise<void> {
  const { visible, toggleButton } = await getExitedSessionsVisibility(page);

  if (visible && toggleButton) {
    await toggleButton.click();
    console.log('Clicked Hide Exited button to hide exited sessions');
    // Wait for the button text to change to "Show Exited"
    await page.waitForFunction(
      () => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.some((btn) => btn.textContent?.match(/Show Exited/i));
      },
      { timeout: TIMEOUTS.UI_UPDATE }
    );
  }
}

/**
 * Ensure all sessions (including exited) are visible for test assertions
 * This is useful when tests need to verify sessions that might have exited
 */
export async function ensureAllSessionsVisible(page: Page): Promise<void> {
  // First check if there's a "Show Exited" button, which indicates exited sessions are hidden
  const showExitedButton = page
    .locator('button')
    .filter({ hasText: /Show Exited/i })
    .first();

  if (await showExitedButton.isVisible({ timeout: 1000 })) {
    console.log('Found "Show Exited" button, clicking to reveal all sessions');
    await showExitedButton.click();

    // Wait for the button to change to "Hide Exited"
    await page.waitForFunction(
      () => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.some((btn) => btn.textContent?.match(/Hide Exited/i));
      },
      { timeout: TIMEOUTS.UI_UPDATE }
    );

    // Additional wait for UI to update
    await page.waitForTimeout(500);
  }
}
