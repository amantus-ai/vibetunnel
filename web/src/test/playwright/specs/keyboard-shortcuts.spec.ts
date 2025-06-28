import { expect, test } from '../fixtures/test.fixture';
import { TerminalTestUtils } from '../utils/terminal-test-utils';
import { TerminalUtils, TestDataFactory, WaitUtils } from '../utils/test-utils';
import { generateTestSessionName } from '../helpers/terminal.helper';

test.describe('Keyboard Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('vibetunnel-app', { state: 'attached' });
    await WaitUtils.waitForNetworkIdle(page);
  });

  test('should open file browser with Cmd+O / Ctrl+O', async ({ page }) => {
    // Create a session first
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
    await TerminalTestUtils.waitForTerminalReady(page);

    // Press Cmd+O (Mac) or Ctrl+O (others)
    const isMac = process.platform === 'darwin';
    await page.keyboard.press(isMac ? 'Meta+o' : 'Control+o');

    // File browser should open - wait for any directory listing
    await page.waitForTimeout(500); // Give it time to open
    
    // Check for file browser by looking for common elements
    const hasParentDir = await page.locator('text=..').isVisible();
    const hasGitButtons = await page.locator('text=Git Changes').isVisible();
    const hasHiddenFiles = await page.locator('text=Hidden Files').isVisible();
    
    // At least one of these should be visible
    expect(hasParentDir || hasGitButtons || hasHiddenFiles).toBe(true);

    // Press Escape to close
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    
    // Verify file browser closed
    const isParentDirHidden = await page.locator('text=..').isHidden();
    expect(isParentDirHidden).toBe(true);
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
    await page.waitForTimeout(1000); // Give navigation time

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
    const sessionName = generateTestSessionName();
    await page.fill('input[placeholder="My Session"]', sessionName);

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

    const sessionName = generateTestSessionName();
    await page.fill('input[placeholder="My Session"]', sessionName);
    await page.click('button:has-text("Create")');
    await page.waitForURL(/\?session=/);

    // Wait for terminal to be ready
    await TerminalTestUtils.waitForTerminalReady(page);
    const terminal = page.locator('vibe-terminal');
    await terminal.click();
    await TerminalTestUtils.waitForPrompt(page);

    // Test Ctrl+C (interrupt)
    await TerminalTestUtils.executeCommand(page, 'sleep 10');
    await page.waitForTimeout(500); // Give sleep command time to start
    await page.keyboard.press('Control+c');
    await TerminalTestUtils.waitForPrompt(page);

    // Should be back at prompt - type something to verify
    await TerminalTestUtils.executeCommand(page, 'echo "interrupted"');
    await expect(page.locator('text=interrupted')).toBeVisible({ timeout: 5000 });

    // Test Ctrl+L (clear)
    await page.keyboard.press('Control+l');
    await TerminalTestUtils.waitForPrompt(page);

    // Terminal should be cleared - verify it's still functional
    await TerminalTestUtils.executeCommand(page, 'echo "after clear"');
    await expect(page.locator('text=after clear')).toBeVisible({ timeout: 5000 });

    // Test exit command
    await TerminalTestUtils.executeCommand(page, 'exit');
    await page.waitForSelector('text=/exited|EXITED|terminated/', { state: 'visible', timeout: 5000 });

    // Session should show as exited
    await expect(page.locator('text=/exited|EXITED/').first()).toBeVisible({ timeout: 5000 });
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
    // Wait for completion to process
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Complete the command
    await page.keyboard.type(' "tab completed"');
    await page.keyboard.press('Enter');

    // Should see the output
    await TerminalTestUtils.waitForText(page, 'tab completed');
    await expect(page.locator('text=tab completed').first()).toBeVisible({ timeout: 5000 });
  });

  test('should handle arrow keys for command history', async ({ page }) => {
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

    // Execute first command
    await TerminalTestUtils.executeCommand(page, 'echo "first command"');
    await TerminalTestUtils.waitForText(page, 'first command');

    // Execute second command
    await TerminalTestUtils.executeCommand(page, 'echo "second command"');
    await TerminalTestUtils.waitForText(page, 'second command');

    // Press up arrow to get previous command
    await page.keyboard.press('ArrowUp');
    // Give shell time to process history
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Execute it again
    await page.keyboard.press('Enter');
    await TerminalTestUtils.waitForPrompt(page);

    // Should see "second command" in output
    await TerminalTestUtils.waitForText(page, 'second command');

    // Press up arrow twice to get first command
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    // Give shell time to process history navigation
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Execute it
    await page.keyboard.press('Enter');
    await TerminalTestUtils.waitForPrompt(page);

    // Should see "first command" in the terminal
    const output = await TerminalTestUtils.getTerminalText(page);
    expect(output).toContain('first command');
  });
});
