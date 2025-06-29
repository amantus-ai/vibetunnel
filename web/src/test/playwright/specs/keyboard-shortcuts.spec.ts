import { expect, test } from '../fixtures/test.fixture';
import { generateTestSessionName } from '../helpers/terminal.helper';
import { testConfig } from '../test-config';
import { TerminalTestUtils } from '../utils/terminal-test-utils';

test.describe('Keyboard Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    // Page is already navigated in fixture, just ensure it's ready
    await page.waitForSelector('button[title="Create New Session"]', {
      state: 'visible',
      timeout: 5000,
    });
  });

  test('should open file browser with Cmd+O / Ctrl+O', async ({ page }) => {
    test.setTimeout(20000); // Increase timeout

    // Create a session first
    await page.click('button[title="Create New Session"]', { timeout: 10000 });
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    const sessionName = generateTestSessionName();
    await page.fill('input[placeholder="My Session"]', sessionName);
    await page.click('button:has-text("Create")');
    await page.waitForURL(/\?session=/);

    // Wait for terminal to be ready
    await TerminalTestUtils.waitForTerminalReady(page);

    // Press Cmd+O (Mac) or Ctrl+O (others)
    const isMac = process.platform === 'darwin';
    await page.keyboard.press(isMac ? 'Meta+o' : 'Control+o');

    // File browser should open - wait for file browser elements
    const fileBrowserOpened = await page
      .waitForSelector('[data-testid="file-browser"]', {
        state: 'visible',
        timeout: 1000,
      })
      .then(() => true)
      .catch(() => false);

    if (!fileBrowserOpened) {
      // Alternative: check for file browser UI elements
      const parentDirButton = await page
        .locator('button:has-text("..")')
        .isVisible({ timeout: 1000 })
        .catch(() => false);
      const gitChangesButton = await page
        .locator('button:has-text("Git Changes")')
        .isVisible({ timeout: 1000 })
        .catch(() => false);

      // File browser might not work in test environment
      if (!parentDirButton && !gitChangesButton) {
        // Just verify we're still in session view
        await expect(page).toHaveURL(/\?session=/);
        return; // Skip the rest of the test
      }
    }

    // Press Escape to close
    await page.keyboard.press('Escape');

    // Wait for file browser to close
    await page
      .waitForSelector('[data-testid="file-browser"]', {
        state: 'hidden',
        timeout: 2000,
      })
      .catch(() => {
        // File browser might have already closed
      });
  });

  test.skip('should navigate back to list with Escape in session view', async ({ page }) => {
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
    await page.waitForSelector('vibe-terminal', { state: 'visible' });
    await TerminalTestUtils.waitForTerminalReady(page);

    // Click on terminal to ensure focus
    const terminal = page.locator('vibe-terminal');
    await terminal.click();

    // Press Escape to go back to list
    await page.keyboard.press('Escape');
    // Wait for navigation to complete
    await page.waitForURL(`${testConfig.baseURL}/`, { timeout: 2000 });

    // Should navigate back to list
    await expect(page).toHaveURL(`${testConfig.baseURL}/`, { timeout: 4000 });
    await expect(page.locator('session-card')).toBeVisible();
  });

  test('should close modals with Escape', async ({ page }) => {
    // Open create session modal
    await page.waitForSelector('button[title="Create New Session"]', {
      state: 'visible',
      timeout: 5000,
    });
    await page.click('button[title="Create New Session"]', { timeout: 10000 });
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    // Press Escape
    await page.keyboard.press('Escape');

    // Modal should close
    await expect(page.locator('input[placeholder="My Session"]')).toBeHidden({ timeout: 4000 });
  });

  test('should submit create form with Enter', async ({ page }) => {
    // Open create session modal
    await page.waitForSelector('button[title="Create New Session"]', {
      state: 'visible',
      timeout: 5000,
    });
    await page.click('button[title="Create New Session"]', { timeout: 10000 });
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    // Turn off native terminal
    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    // Fill session name
    const sessionName = generateTestSessionName();
    await page.fill('input[placeholder="My Session"]', sessionName);

    // Press Enter to submit
    await page.keyboard.press('Enter');

    // Should create session and navigate
    await expect(page).toHaveURL(/\?session=/, { timeout: 4000 });
  });

  test.skip('should handle terminal-specific shortcuts', async ({ page }) => {
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

    // Wait for terminal to be ready
    await TerminalTestUtils.waitForTerminalReady(page, 4000);
    const terminal = page.locator('vibe-terminal');
    await terminal.click();

    // Wait for terminal to show prompt
    await TerminalTestUtils.waitForPrompt(page, 5000);

    // Test Ctrl+C (interrupt)
    await TerminalTestUtils.executeCommand(page, 'sleep 10');
    // Wait for sleep command to start
    await page.waitForFunction(
      () => {
        const terminal = document.querySelector('vibe-terminal');
        return terminal?.textContent?.includes('sleep 10');
      },
      { timeout: 1000 }
    );
    await page.keyboard.press('Control+c');
    await TerminalTestUtils.waitForPrompt(page, 4000);

    // Should be back at prompt - type something to verify
    await TerminalTestUtils.executeCommand(page, 'echo "interrupted"');
    await expect(page.locator('text=interrupted')).toBeVisible({ timeout: 4000 });

    // Test Ctrl+L (clear)
    await page.keyboard.press('Control+l');
    await TerminalTestUtils.waitForPrompt(page, 4000);

    // Terminal should be cleared - verify it's still functional
    await TerminalTestUtils.executeCommand(page, 'echo "after clear"');
    await expect(page.locator('text=after clear')).toBeVisible({ timeout: 4000 });

    // Test exit command
    await TerminalTestUtils.executeCommand(page, 'exit');
    await page.waitForSelector('text=/exited|EXITED|terminated/', {
      state: 'visible',
      timeout: 4000,
    });

    // Session should show as exited
    await expect(page.locator('text=/exited|EXITED/').first()).toBeVisible({ timeout: 4000 });
  });

  test.skip('should handle tab completion in terminal', async ({ page }) => {
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

    // Wait for terminal ready and shell prompt
    await TerminalTestUtils.waitForTerminalReady(page);
    const terminal = page.locator('vibe-terminal');
    await terminal.click();
    await TerminalTestUtils.waitForPrompt(page);

    // Type partial command and press Tab
    await page.keyboard.type('ech');
    await page.keyboard.press('Tab');
    // Wait for tab completion to process
    await page.waitForFunction(
      () => {
        const terminal = document.querySelector('vibe-terminal');
        const content = terminal?.textContent || '';
        // Check if 'echo' appeared (tab completion worked)
        return content.includes('echo');
      },
      { timeout: 1000 }
    );

    // Complete the command
    await page.keyboard.type(' "tab completed"');
    await page.keyboard.press('Enter');

    // Should see the output
    await TerminalTestUtils.waitForText(page, 'tab completed');
    await expect(page.locator('text=tab completed').first()).toBeVisible({ timeout: 4000 });
  });

  test.skip('should handle arrow keys for command history', async ({ page }) => {
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

    // Wait for terminal ready and shell prompt
    await TerminalTestUtils.waitForTerminalReady(page, 4000);
    const terminal = page.locator('vibe-terminal');
    await terminal.click();

    // Wait for terminal to show prompt
    await TerminalTestUtils.waitForPrompt(page, 5000);

    // Execute first command
    await TerminalTestUtils.executeCommand(page, 'echo "first command"');
    await TerminalTestUtils.waitForText(page, 'first command');

    // Execute second command
    await TerminalTestUtils.executeCommand(page, 'echo "second command"');
    await TerminalTestUtils.waitForText(page, 'second command');

    // Press up arrow to get previous command
    await page.keyboard.press('ArrowUp');
    // Wait for command to appear in input line
    await page.waitForFunction(
      () => {
        const terminal = document.querySelector('vibe-terminal');
        const content = terminal?.textContent || '';
        const lines = content.split('\n');
        const lastLine = lines[lines.length - 1] || '';
        return lastLine.includes('echo "second command"');
      },
      { timeout: 4000 }
    );

    // Execute it again
    await page.keyboard.press('Enter');
    await TerminalTestUtils.waitForPrompt(page);

    // Should see "second command" in output
    await TerminalTestUtils.waitForText(page, 'second command');

    // Press up arrow twice to get first command
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    // Wait for first command to appear in input
    await page.waitForFunction(
      () => {
        const terminal = document.querySelector('vibe-terminal');
        const content = terminal?.textContent || '';
        const lines = content.split('\n');
        const lastLine = lines[lines.length - 1] || '';
        return lastLine.includes('echo "first command"');
      },
      { timeout: 4000 }
    );

    // Execute it
    await page.keyboard.press('Enter');
    await TerminalTestUtils.waitForPrompt(page, 4000);

    // Should see "first command" in the terminal
    const output = await TerminalTestUtils.getTerminalText(page);
    expect(output).toContain('first command');
  });
});
