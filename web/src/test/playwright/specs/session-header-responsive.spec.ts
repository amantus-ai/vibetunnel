import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures/test.fixture';
import { TestSessionManager } from '../helpers/test-data-manager.helper';

const androidUserAgent =
  'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 Chrome/125.0.0.0 Mobile Safari/537.36';

async function expectInsideViewport(page: Page, locator: Locator, minimumSize = 44): Promise<void> {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();

  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!box || !viewport) return;

  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  expect(box.width).toBeGreaterThanOrEqual(minimumSize);
  expect(box.height).toBeGreaterThanOrEqual(minimumSize);
}

test.describe('mobile session header', () => {
  test.use({
    viewport: { width: 434, height: 965 },
    userAgent: androidUserAgent,
    isMobile: true,
    hasTouch: true,
  });

  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page, 'header-mobile');
    await sessionManager.createTrackedSession();
    await expect(page.locator('session-header')).toBeVisible();
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });

  test('keeps navigation, chat, menu, and keyboard controls reachable at narrow widths', async ({
    page,
  }) => {
    const headerControls = [
      page.getByRole('button', { name: 'Show sidebar', exact: true }),
      page.getByRole('button', { name: 'Switch to Chat Mode', exact: true }),
      page.getByRole('button', { name: 'More actions menu', exact: true }),
    ];

    for (const viewport of [
      { width: 700, height: 500 },
      { width: 434, height: 965 },
      { width: 390, height: 844 },
      { width: 360, height: 800 },
    ]) {
      await page.setViewportSize(viewport);

      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(viewport.width);

      for (const control of headerControls) {
        await expect(control).toBeVisible();
        await expectInsideViewport(page, control);
      }
    }

    await page.setViewportSize({ width: 434, height: 965 });
    const menuButton = page.getByRole('button', { name: 'More actions menu', exact: true });
    await menuButton.click();
    await expect(page.getByTestId('compact-new-session')).toBeVisible();
    await menuButton.click();
    await expect(page.getByTestId('compact-new-session')).toBeHidden();

    const keyboardButton = page.getByRole('button', { name: 'Keyboard', exact: true });
    await expect(keyboardButton).toBeVisible();
    await expectInsideViewport(page, keyboardButton);
    await keyboardButton.click();
    await expect(
      page.getByRole('button', { name: 'Toggle mobile keyboard', exact: true })
    ).toBeVisible();
  });
});

test.describe('desktop session header', () => {
  test.use({
    viewport: { width: 1280, height: 720 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
    isMobile: false,
    hasTouch: false,
  });

  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page, 'header-desktop');
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });

  test('preserves desktop header spacing and session details', async ({ page }) => {
    const { sessionName } = await sessionManager.createTrackedSession();
    const header = page.locator('.session-header-container');

    await expect(header).toBeVisible();
    await expect(header).toContainText(sessionName);
    await expect
      .poll(() =>
        header.evaluate((element) => {
          const styles = getComputedStyle(element);
          return {
            paddingLeft: styles.paddingLeft,
            paddingRight: styles.paddingRight,
            scrollWidth: document.documentElement.scrollWidth,
            viewportWidth: window.innerWidth,
          };
        })
      )
      .toEqual({
        paddingLeft: '16px',
        paddingRight: '16px',
        scrollWidth: 1280,
        viewportWidth: 1280,
      });
  });
});
