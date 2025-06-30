import type { Page } from '@playwright/test';

/**
 * Modal helper functions for Playwright tests
 * Following best practices: using semantic locators and auto-waiting
 */

/**
 * Close any open modal using Escape key
 */
export async function closeModalWithEscape(page: Page): Promise<void> {
  const modal = page.locator('[role="dialog"]');

  if (await modal.isVisible()) {
    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'hidden' });
  }
}

/**
 * Close modal using the close button
 */
export async function closeModalWithButton(page: Page): Promise<void> {
  const modal = page.locator('[role="dialog"]');

  if (await modal.isVisible()) {
    // Try different close button selectors
    const closeButton = modal
      .locator('button[aria-label="Close"]')
      .or(modal.locator('button:has-text("Close")'))
      .or(modal.locator('button:has-text("Cancel")'))
      .or(modal.locator('button.close'));

    if (await closeButton.isVisible()) {
      await closeButton.click();
      await modal.waitFor({ state: 'hidden' });
    }
  }
}

/**
 * Wait for modal to be fully visible
 */
export async function waitForModal(page: Page): Promise<void> {
  await page.locator('[role="dialog"]').waitFor({ state: 'visible' });

  // Wait for any animations to complete
  await page.waitForFunction(() => {
    const modal = document.querySelector('[role="dialog"]');
    if (!modal) return false;

    const style = window.getComputedStyle(modal);
    return style.opacity === '1' && style.visibility === 'visible';
  });
}

/**
 * Ensure no modals are blocking interactions
 */
export async function ensureNoModals(page: Page): Promise<void> {
  const modal = page.locator('[role="dialog"]');

  if (await modal.isVisible()) {
    await closeModalWithEscape(page);
  }
}

/**
 * Fill and submit a form in a modal
 */
export async function fillModalForm(page: Page, fields: Record<string, string>): Promise<void> {
  await waitForModal(page);

  for (const [selector, value] of Object.entries(fields)) {
    const input = page.locator(`[role="dialog"] ${selector}`);
    await input.fill(value);
  }
}

/**
 * Click a button in the modal
 */
export async function clickModalButton(page: Page, buttonText: string): Promise<void> {
  const modal = page.locator('[role="dialog"]');
  const button = modal.locator(`button:has-text("${buttonText}")`);

  await button.click();
}

/**
 * Handle confirmation dialog
 */
export async function handleConfirmDialog(page: Page, accept = true): Promise<void> {
  const dialogPromise = page.waitForEvent('dialog');
  const dialog = await dialogPromise;

  if (accept) {
    await dialog.accept();
  } else {
    await dialog.dismiss();
  }
}
