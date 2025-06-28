import { expect, test } from '../fixtures/test.fixture';

test.describe('Keyboard Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('vibetunnel-app', { state: 'attached' });
  });

  test('should open file browser with Cmd+O / Ctrl+O', async ({ page }) => {
    // Create a session first
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    await page.fill('input[placeholder="My Session"]', `Shortcut-Test-${Date.now()}`);
    await page.click('button:has-text("Create")');
    await page.waitForURL(/\?session=/);

    // Press Cmd+O (Mac) or Ctrl+O (others)
    const isMac = process.platform === 'darwin';
    await page.keyboard.press(isMac ? 'Meta+o' : 'Control+o');

    // File browser should open
    await expect(page.locator('file-browser, [data-component="file-browser"]').first()).toBeVisible(
      { timeout: 5000 }
    );

    // Press Escape to close
    await page.keyboard.press('Escape');
    await expect(page.locator('file-browser, [data-component="file-browser"]').first()).toBeHidden({
      timeout: 5000,
    });
  });

  test('should navigate back to list with Escape in session view', async ({ page }) => {
    // Create a session
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    await page.fill('input[placeholder="My Session"]', `Escape-Test-${Date.now()}`);
    await page.click('button:has-text("Create")');
    await page.waitForURL(/\?session=/);
    await page.waitForSelector('vibe-terminal', { state: 'visible' });

    // Press Escape to go back to list
    await page.keyboard.press('Escape');

    // Should navigate back to list
    await expect(page).toHaveURL('http://localhost:4020/', { timeout: 5000 });
    await expect(page.locator('session-card')).toBeVisible();
  });

  test('should close modals with Escape', async ({ page }) => {
    // Open create session modal
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    // Press Escape
    await page.keyboard.press('Escape');

    // Modal should close
    await expect(page.locator('input[placeholder="My Session"]')).toBeHidden({ timeout: 5000 });
  });

  test('should submit create form with Enter', async ({ page }) => {
    // Open create session modal
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    // Turn off native terminal
    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    // Fill session name
    await page.fill('input[placeholder="My Session"]', `Enter-Test-${Date.now()}`);

    // Press Enter to submit
    await page.keyboard.press('Enter');

    // Should create session and navigate
    await expect(page).toHaveURL(/\?session=/, { timeout: 10000 });
  });

  test('should handle terminal-specific shortcuts', async ({ page }) => {
    // Create a session
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    await page.fill('input[placeholder="My Session"]', `Terminal-Shortcuts-${Date.now()}`);
    await page.click('button:has-text("Create")');
    await page.waitForURL(/\?session=/);

    // Click on terminal
    const terminal = page.locator('vibe-terminal');
    await terminal.click();
    await page.waitForTimeout(1000);

    // Test Ctrl+C (interrupt)
    await page.keyboard.type('sleep 10');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    await page.keyboard.press('Control+c');
    await page.waitForTimeout(500);

    // Should be back at prompt - type something to verify
    await page.keyboard.type('echo "interrupted"');
    await page.keyboard.press('Enter');
    await expect(page.locator('text=interrupted')).toBeVisible({ timeout: 5000 });

    // Test Ctrl+L (clear)
    await page.keyboard.press('Control+l');
    await page.waitForTimeout(500);

    // Terminal should be cleared (hard to verify exactly, but it should still be functional)
    await page.keyboard.type('echo "after clear"');
    await page.keyboard.press('Enter');
    await expect(page.locator('text=after clear')).toBeVisible({ timeout: 5000 });

    // Test Ctrl+D (EOF/exit) - be careful with this one
    // We'll type 'exit' instead to be safer
    await page.keyboard.type('exit');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    // Session should show as exited
    await expect(page.locator('text=/exited|EXITED/')).toBeVisible({ timeout: 5000 });
  });

  test('should handle tab completion in terminal', async ({ page }) => {
    // Create a session
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    await page.fill('input[placeholder="My Session"]', `Tab-Test-${Date.now()}`);
    await page.click('button:has-text("Create")');
    await page.waitForURL(/\?session=/);

    // Click on terminal
    const terminal = page.locator('vibe-terminal');
    await terminal.click();
    await page.waitForTimeout(1000);

    // Type partial command and press Tab
    await page.keyboard.type('ech');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);

    // Complete the command
    await page.keyboard.type(' "tab completed"');
    await page.keyboard.press('Enter');

    // Should see the output
    await expect(page.locator('text=tab completed')).toBeVisible({ timeout: 5000 });
  });

  test('should handle arrow keys for command history', async ({ page }) => {
    // Create a session
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    await page.fill('input[placeholder="My Session"]', `History-Test-${Date.now()}`);
    await page.click('button:has-text("Create")');
    await page.waitForURL(/\?session=/);

    // Click on terminal
    const terminal = page.locator('vibe-terminal');
    await terminal.click();
    await page.waitForTimeout(1000);

    // Execute a command
    await page.keyboard.type('echo "first command"');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Execute another command
    await page.keyboard.type('echo "second command"');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Press up arrow to get previous command
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(200);

    // Execute it again
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Should see "second command" output twice
    const outputs = page.locator('text=second command');
    const count = await outputs.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // Press up arrow twice to get first command
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(200);

    // Execute it
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Should see "first command" output again
    const firstOutputs = page.locator('text=first command');
    const firstCount = await firstOutputs.count();
    expect(firstCount).toBeGreaterThanOrEqual(2);
  });
});
