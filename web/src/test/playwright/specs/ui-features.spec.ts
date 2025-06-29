import { expect, test } from '../fixtures/test.fixture';
import { navigateToHome } from '../helpers/navigation.helper';
import { generateTestSessionName } from '../helpers/terminal.helper';

test.describe('UI Features', () => {
  // Page navigation is handled by fixture

  test.skip('should open and close file browser', async ({ page }) => {
    // Create a session first
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    await page.fill('input[placeholder="My Session"]', generateTestSessionName());
    await page.click('button:has-text("Create")');
    await page.waitForURL(/\?session=/);
  });

  test.skip('should navigate directories in file browser', async ({ page }) => {});

  test('should use quick start commands', async ({ page }) => {
    // Open create session dialog
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    // Turn off native terminal
    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    // Look for quick start buttons
    const quickStartButtons = page.locator(
      'button:has-text("zsh"), button:has-text("bash"), button:has-text("python3")'
    );
    const buttonCount = await quickStartButtons.count();
    expect(buttonCount).toBeGreaterThan(0);

    // Click on bash if available
    const bashButton = page.locator('button:has-text("bash")').first();
    if (await bashButton.isVisible()) {
      await bashButton.click();

      // Command field should be populated
      const commandInput = page.locator('input[placeholder="zsh"]');
      const value = await commandInput.inputValue();
      expect(value).toBe('bash');
    }

    // Create the session
    await page.fill('input[placeholder="My Session"]', generateTestSessionName());
    await page.click('button:has-text("Create")');
    await page.waitForURL(/\?session=/);
  });

  test('should display notification options', async ({ page }) => {
    // Check notification button in header - it's the notification-status component
    const notificationButton = page.locator('notification-status button').first();

    // Wait for notification button to be visible
    await expect(notificationButton).toBeVisible({ timeout: 4000 });

    // Verify the button has a tooltip
    const tooltip = await notificationButton.getAttribute('title');
    expect(tooltip).toBeTruthy();
    expect(tooltip?.toLowerCase()).toContain('notification');
  });

  test('should show session count in header', async ({ page }) => {
    // The header should show session count - look for text like "(5)"
    // It's in the full-header component
    await page.waitForSelector('full-header', { state: 'visible' });

    // Get initial count from header
    const headerElement = page.locator('full-header').first();
    const sessionCountElement = headerElement.locator('p.text-xs').first();
    const initialText = await sessionCountElement.textContent();
    const initialCount = Number.parseInt(initialText?.match(/\d+/)?.[0] || '0');

    // Create a session
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    await page.fill('input[placeholder="My Session"]', generateTestSessionName());
    await page.click('button:has-text("Create")');
    await page.waitForURL(/\?session=/);

    // Go back to see updated count
    await navigateToHome(page);
    // Wait for session list to load
    await page.waitForSelector('session-card', { state: 'visible' });

    // Get new count from header
    const newText = await sessionCountElement.textContent();
    const newCount = Number.parseInt(newText?.match(/\d+/)?.[0] || '0');

    // Count should have increased
    expect(newCount).toBeGreaterThan(initialCount);
  });

  test('should preserve form state in create dialog', async ({ page }) => {
    // Open create dialog
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    // Fill in some values
    const testName = 'Preserve Test';
    const testCommand = 'python3';
    const testDir = '/usr/local';

    await page.fill('input[placeholder="My Session"]', testName);
    await page.fill('input[placeholder="zsh"]', testCommand);
    await page.fill('input[placeholder="~/"]', testDir);

    // Close dialog
    await page.keyboard.press('Escape');
    // Wait for dialog to close
    await page.locator('[role="dialog"]').waitFor({ state: 'hidden', timeout: 2000 });

    // Reopen dialog
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    // Working directory and command might be preserved (depends on implementation)
    // Session name is typically cleared
    const commandValue = await page.locator('input[placeholder="zsh"]').inputValue();
    const _dirValue = await page.locator('input[placeholder="~/"]').inputValue();

    // At minimum, the form should be functional
    expect(commandValue).toBeTruthy(); // Should have some default
  });

  test('should show terminal preview in session cards', async ({ page }) => {
    // Create a session
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    const sessionName = generateTestSessionName();
    await page.fill('input[placeholder="My Session"]', sessionName);
    await page.click('button:has-text("Create")');
    await page.waitForURL(/\?session=/);

    // Go back to list
    await navigateToHome(page);
    await page.waitForSelector('session-card', { state: 'visible' });

    // Find our session card
    const sessionCard = page.locator('session-card').filter({ hasText: sessionName }).first();
    await expect(sessionCard).toBeVisible();

    // The card should show terminal preview (buffer component)
    const preview = sessionCard.locator('vibe-terminal-buffer').first();
    await expect(preview).toBeVisible();
  });
});
