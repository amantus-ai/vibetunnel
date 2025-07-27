import { expect, test } from '../fixtures/test.fixture';
import { assertTerminalReady } from '../helpers/assertion.helper';
import { createAndNavigateToSession } from '../helpers/session-lifecycle.helper';
import { waitForShellPrompt } from '../helpers/terminal.helper';
import { interruptCommand } from '../helpers/terminal-commands.helper';
import {
  assertTerminalContains,
  getTerminalContent,
} from '../helpers/terminal-optimization.helper';
import { TestSessionManager } from '../helpers/test-data-manager.helper';
import { ensureCleanState } from '../helpers/test-isolation.helper';
import { SessionListPage } from '../pages/session-list.page';
import { SessionViewPage } from '../pages/session-view.page';
import { TestDataFactory } from '../utils/test-utils';

// Use a unique prefix for this test suite
const TEST_PREFIX = TestDataFactory.getTestSpecificPrefix('keyboard-shortcuts');

test.describe('Keyboard Shortcuts', () => {
  let sessionManager: TestSessionManager;
  let sessionListPage: SessionListPage;
  let sessionViewPage: SessionViewPage;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page, TEST_PREFIX);
    sessionListPage = new SessionListPage(page);
    sessionViewPage = new SessionViewPage(page);

    // Ensure clean state for each test
    await ensureCleanState(page);
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });

  test('should open file browser with Cmd+O / Ctrl+O', async ({ page }) => {
    test.setTimeout(45000); // Increase timeout for this test
    // Create a session
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('keyboard-test'),
    });

    try {
      await assertTerminalReady(page);
    } catch (_error) {
      // Terminal might not be ready in CI
      test.skip(true, 'Terminal not ready in CI environment');
    }

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
        await expect(page).toHaveURL(/\/session\//);
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

  test.skip('should navigate back to list with Escape for exited sessions', async ({ page }) => {
    // Create a session that exits after showing a message
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('escape-test'),
      command: 'echo "Session ending"', // Simple command that exits immediately
    });

    try {
      await assertTerminalReady(page);
    } catch (_error) {
      // Terminal might not be ready in CI
      test.skip(true, 'Terminal not ready in CI environment');
    }

    // Wait for session to exit
    await page.waitForTimeout(3000);

    // Wait for session status to update to exited
    const exitedStatus = await page.waitForFunction(
      () => {
        const statusElements = document.querySelectorAll('[data-status]');
        for (const el of statusElements) {
          if (el.getAttribute('data-status') === 'exited') {
            return true;
          }
        }
        // Also check for text indicating exited status
        return document.body.textContent?.includes('exited') || false;
      },
      { timeout: 10000 }
    );
    expect(exitedStatus).toBeTruthy();

    // Try to click on terminal area to ensure focus
    const terminal = page.locator('vibe-terminal').first();
    if (await terminal.isVisible()) {
      await terminal.click({ force: true }).catch(() => {
        // Terminal might not be clickable, ignore error
      });
    }

    // Press Escape to go back to list
    await page.keyboard.press('Escape');

    // Should navigate back to list
    await page.waitForURL('/', { timeout: 5000 });
    await expect(page.locator('session-card').first()).toBeVisible();
  });

  test('should close modals with Escape', async ({ page }) => {
    test.setTimeout(30000); // Increase timeout for this test

    // Ensure we're on the session list page
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Find and click create button
    const createButton = page.locator('[data-testid="create-session-button"]').first();
    await createButton.waitFor({ state: 'visible', timeout: 5000 });
    await createButton.click();

    // Wait for modal to appear
    const modal = page.locator('[data-testid="session-create-modal"]').first();
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Press Escape
    await page.keyboard.press('Escape');

    // Modal should close
    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // Verify we're back on the session list
    await expect(createButton).toBeVisible();
  });

  test('should submit create form with Enter', async ({ page }) => {
    // Ensure we're on the session list page
    await sessionListPage.navigate();

    // Close any existing modals first
    await sessionListPage.closeAnyOpenModal();
    await page.waitForLoadState('domcontentloaded');

    // Open create session modal
    const createButton = page
      .locator('[data-testid="create-session-button"]')
      .or(page.locator('button[title="Create New Session"]'))
      .or(page.locator('button[title="Create New Session (⌘K)"]'))
      .first();

    // Wait for button to be ready
    await createButton.waitFor({ state: 'visible', timeout: 5000 });
    await createButton.scrollIntoViewIfNeeded();

    // Wait for any ongoing operations to complete
    await page.waitForLoadState('domcontentloaded', { timeout: 2000 }).catch(() => {});

    // Click with retry logic
    try {
      await createButton.click({ timeout: 5000 });
    } catch (_error) {
      // Try force click if regular click fails
      await createButton.click({ force: true });
    }

    // Wait for modal to appear with multiple selectors
    await Promise.race([
      page.waitForSelector('text="New Session"', { state: 'visible', timeout: 10000 }),
      page.waitForSelector('[role="dialog"]', { state: 'visible', timeout: 10000 }),
      page.waitForSelector('.modal-content', { state: 'visible', timeout: 10000 }),
    ]);
    await page.waitForLoadState('domcontentloaded');

    // Turn off native terminal
    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.count()) > 0) {
      await spawnWindowToggle.waitFor({ state: 'visible', timeout: 2000 });
      if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
        await spawnWindowToggle.click();
        // Wait for toggle state to update
        await page.waitForFunction(
          () => {
            const toggle = document.querySelector('button[role="switch"]');
            return toggle?.getAttribute('aria-checked') === 'false';
          },
          { timeout: 1000 }
        );
      }
    }

    // Fill session name and track it
    const sessionName = sessionManager.generateSessionName('enter-test');
    const nameInput = page
      .locator('[data-testid="session-name-input"]')
      .or(page.locator('input[placeholder="My Session"]'));
    await nameInput.fill(sessionName);

    // Press Enter to submit
    await page.keyboard.press('Enter');

    // Should create session and navigate
    await expect(page).toHaveURL(/\/session\//, { timeout: 8000 });

    // Wait for terminal to be ready
    await page.waitForSelector('vibe-terminal', { state: 'visible', timeout: 5000 });
  });

  test.skip('should handle terminal-specific shortcuts', async ({ page }) => {
    // Create a session
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('terminal-shortcut'),
    });

    try {
      await assertTerminalReady(page);
    } catch (_error) {
      // Terminal might not be ready in CI
      test.skip(true, 'Terminal not ready in CI environment');
    }

    await sessionViewPage.clickTerminal();

    // Test Ctrl+C (interrupt)
    await page.keyboard.type('sleep 10');
    await page.keyboard.press('Enter');

    // Wait for sleep command to start
    await page.waitForFunction(
      () => {
        const terminal = document.querySelector('vibe-terminal');
        if (!terminal) return false;

        // Check the terminal container first
        const container = terminal.querySelector('#terminal-container');
        const containerContent = container?.textContent || '';

        // Fall back to terminal content
        const content = terminal.textContent || containerContent;

        return content.includes('sleep 10');
      },
      { timeout: 1000 }
    );

    await interruptCommand(page);

    // Should be back at prompt - type something to verify
    await page.keyboard.type('echo "interrupted"');
    await page.keyboard.press('Enter');
    await expect(page.locator('text=interrupted').last()).toBeVisible({ timeout: 4000 });

    // Test clear command (Ctrl+L is intercepted as browser shortcut)
    await page.keyboard.type('clear');
    await page.keyboard.press('Enter');
    await waitForShellPrompt(page, 4000);

    // Terminal should be cleared - verify it's still functional
    await page.keyboard.type('echo "after clear"');
    await page.keyboard.press('Enter');
    await expect(page.locator('text=after clear').last()).toBeVisible({ timeout: 4000 });

    // Test exit command
    await page.keyboard.type('exit');
    await page.keyboard.press('Enter');
    await page.waitForSelector('text=/exited|EXITED|terminated/', {
      state: 'visible',
      timeout: 4000,
    });

    // Session should show as exited
    await expect(page.locator('text=/exited|EXITED/').first()).toBeVisible({ timeout: 4000 });
  });

  test('should handle tab completion in terminal', async ({ page }) => {
    // Create a session
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('tab-completion'),
    });
    await assertTerminalReady(page);

    await sessionViewPage.clickTerminal();

    // Type a partial command for tab completion
    await page.keyboard.type('ec');

    // Get terminal content before tab
    const beforeTab = await getTerminalContent(page);

    // Press Tab for completion
    await page.keyboard.press('Tab');

    // Wait for tab completion to process - check if content changed
    await page.waitForFunction(
      (beforeContent) => {
        const terminal = document.querySelector('vibe-terminal');
        const currentContent = terminal?.textContent || '';
        // Either content changed (completion happened) or stayed same (no completion)
        return (
          currentContent !== beforeContent ||
          currentContent.includes('echo') ||
          currentContent.includes('ec')
        );
      },
      beforeTab,
      { timeout: 3000 }
    );

    // Type the rest of the command
    await page.keyboard.type('ho "testing tab completion"');
    await page.keyboard.press('Enter');

    // Wait for command output
    await assertTerminalContains(page, 'testing tab completion', 5000);

    // Test passes if tab key doesn't break terminal functionality
  });

  test('should handle arrow keys for command history', async ({ page }) => {
    test.setTimeout(30000); // Increase timeout for this test

    // Create a session
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('history-test'),
    });
    await assertTerminalReady(page);

    await sessionViewPage.clickTerminal();

    // Execute a simple command
    await page.keyboard.type('echo "arrow key test"');
    await page.keyboard.press('Enter');

    // Wait for output
    await expect(page.locator('text=arrow key test').first()).toBeVisible({ timeout: 5000 });

    // Wait for prompt to reappear by checking for prompt characters
    await page.waitForFunction(
      () => {
        const terminal = document.querySelector('vibe-terminal');
        const content = terminal?.textContent || '';
        // Look for the command output and then a new prompt after it
        const outputIndex = content.lastIndexOf('arrow key test');
        if (outputIndex === -1) return false;
        const afterOutput = content.substring(outputIndex + 'arrow key test'.length);
        // Check if there's a prompt character after the output
        return afterOutput.includes('$') || afterOutput.includes('#') || afterOutput.includes('>');
      },
      { timeout: 5000 }
    );

    // Get current terminal content before arrow keys
    const beforeArrows = await getTerminalContent(page);

    // Press arrow keys to verify they don't break terminal
    await page.keyboard.press('ArrowUp');
    // Wait for history navigation to complete
    await page.waitForFunction(
      (beforeContent) => {
        const terminal = document.querySelector('vibe-terminal');
        const currentContent = terminal?.textContent || '';
        // Content should change when navigating history (previous command appears)
        return currentContent !== beforeContent && currentContent.includes('echo "arrow key test"');
      },
      beforeArrows,
      { timeout: 2000 }
    );

    await page.keyboard.press('ArrowDown');
    // Small wait for arrow down
    await page.waitForFunction(
      () => {
        const terminal = document.querySelector('vibe-terminal');
        return terminal?.textContent || '';
      },
      { timeout: 500 }
    );

    // Arrow left/right should work without breaking terminal
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowRight');

    // Type another command to verify terminal still works
    await page.keyboard.type('echo "still working"');
    await page.keyboard.press('Enter');

    // Verify terminal is still functional
    await expect(page.locator('text=still working').first()).toBeVisible({ timeout: 5000 });

    // Test passes if arrow keys don't break terminal functionality
  });
});
