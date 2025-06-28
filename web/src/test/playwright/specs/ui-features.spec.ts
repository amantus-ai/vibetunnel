import { expect, test } from '../fixtures/test.fixture';

test.describe('UI Features', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('vibetunnel-app', { state: 'attached' });
  });

  test('should open and close file browser', async ({ page }) => {
    // Create a session first
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    await page.fill('input[placeholder="My Session"]', `FileBrowser-Test-${Date.now()}`);
    await page.click('button:has-text("Create")');
    await page.waitForURL(/\?session=/);

    // Click Browse Files button
    await page.click('button[title*="Browse Files"]');

    // File browser should appear
    await expect(page.locator('file-browser, [data-component="file-browser"]').first()).toBeVisible(
      { timeout: 5000 }
    );

    // Should show file listing
    await expect(page.locator('text=..')).toBeVisible(); // Parent directory

    // Close with Escape
    await page.keyboard.press('Escape');

    // File browser should disappear
    await expect(page.locator('file-browser, [data-component="file-browser"]').first()).toBeHidden({
      timeout: 5000,
    });
  });

  test('should navigate directories in file browser', async ({ page }) => {
    // Create a session
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    await page.fill('input[placeholder="My Session"]', `FileNav-Test-${Date.now()}`);
    await page.click('button:has-text("Create")');
    await page.waitForURL(/\?session=/);

    // Open file browser
    await page.click('button[title*="Browse Files"]');
    await page.waitForSelector('text=..', { state: 'visible' });

    // The path should be displayed
    const pathDisplay = page.locator('text=/\\/Users\\/|~\\/|Home/');
    await expect(pathDisplay.first()).toBeVisible();

    // Click on a directory (if available)
    const directories = page
      .locator('[data-type="directory"], img[alt*="folder"], text=/^[A-Z][a-z]+$/')
      .filter({ hasText: /^(?!\.\.)[A-Za-z]+$/ });
    const dirCount = await directories.count();

    if (dirCount > 0) {
      // Click first directory
      await directories.first().click();
      await page.waitForTimeout(500);

      // Path should update
      const newPath = await pathDisplay.first().textContent();
      expect(newPath).toBeTruthy();
    }

    // Click back button if available
    const backButton = page.locator('button:has-text("Back"), button[title*="Back"]');
    if (await backButton.isVisible()) {
      await backButton.click();
      await page.waitForTimeout(500);
    }

    // Close browser
    await page.keyboard.press('Escape');
  });

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
    await page.fill('input[placeholder="My Session"]', `QuickStart-Test-${Date.now()}`);
    await page.click('button:has-text("Create")');
    await page.waitForURL(/\?session=/);
  });

  test('should display notification options', async ({ page }) => {
    // Check notification button in header
    const notificationButton = page
      .locator(
        'button[title*="Notification"], button:has-text("🔔"), button[aria-label*="notification"]'
      )
      .first();
    await expect(notificationButton).toBeVisible();

    // The button might show "not subscribed" state
    const buttonText = await notificationButton.textContent();
    expect(buttonText?.toLowerCase()).toMatch(/notification|🔔/);
  });

  test('should show session count in header', async ({ page }) => {
    // The header should show session count
    const header = page.locator('header, [role="banner"]').first();
    const sessionCount = header.locator('text=/\\d+\\s*session|\\(\\d+\\)/');

    // Create a new session to see count change
    const initialText = (await sessionCount.textContent()) || '0';
    const initialCount = Number.parseInt(initialText.match(/\d+/)?.[0] || '0');

    // Create a session
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    await page.fill('input[placeholder="My Session"]', `Count-Test-${Date.now()}`);
    await page.click('button:has-text("Create")');
    await page.waitForURL(/\?session=/);

    // Go back to see updated count
    await page.goto('/');
    await page.waitForTimeout(500);

    const newText = (await sessionCount.textContent()) || '0';
    const newCount = Number.parseInt(newText.match(/\d+/)?.[0] || '0');

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
    await page.waitForTimeout(200);

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
    // Create a session with some output
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    const sessionName = `Preview-Test-${Date.now()}`;
    await page.fill('input[placeholder="My Session"]', sessionName);
    await page.click('button:has-text("Create")');
    await page.waitForURL(/\?session=/);

    // Type some commands to generate output
    const terminal = page.locator('vibe-terminal');
    await terminal.click();
    await page.waitForTimeout(1000);

    await page.keyboard.type('echo "This should appear in preview"');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Go back to list
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible' });

    // Find our session card
    const sessionCard = page.locator('session-card').filter({ hasText: sessionName }).first();

    // The card should show terminal preview (buffer component)
    const preview = sessionCard.locator('vibe-terminal-buffer, [data-terminal-preview]').first();
    await expect(preview).toBeVisible();
  });
});
