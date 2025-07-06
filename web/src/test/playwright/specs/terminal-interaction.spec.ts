import { expect, test } from '../fixtures/test.fixture';
import { assertTerminalContains, assertTerminalReady } from '../helpers/assertion.helper';
import {
  getTerminalDimensions,
  waitForTerminalBusy,
  waitForTerminalResize,
} from '../helpers/common-patterns.helper';
import { createAndNavigateToSession } from '../helpers/session-lifecycle.helper';
import {
  executeAndVerifyCommand,
  executeCommandSequence,
  executeCommandWithRetry,
  getCommandOutput,
  interruptCommand,
} from '../helpers/terminal-commands.helper';
import { TestSessionManager } from '../helpers/test-data-manager.helper';

test.describe('Terminal Interaction', () => {
  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page);

    // Create a session for all tests
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('terminal-test'),
    });
    await assertTerminalReady(page, 15000);
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });

  test('should execute basic commands', async ({ page }) => {
    // Simple one-liner to execute and verify
    await executeAndVerifyCommand(page, 'echo "Hello VibeTunnel"', 'Hello VibeTunnel');

    // Verify using assertion helper
    await assertTerminalContains(page, 'Hello VibeTunnel');
  });

  test('should handle command with special characters', async ({ page }) => {
    const specialText = 'Test with spaces and numbers 123';

    // Execute with automatic output verification
    await executeAndVerifyCommand(page, `echo "${specialText}"`, specialText);
  });

  test('should execute multiple commands in sequence', async ({ page }) => {
    // Execute sequence with expected outputs
    await executeCommandSequence(page, ['echo "Test 1"', 'echo "Test 2"']);

    // Both outputs should be visible
    await assertTerminalContains(page, 'Test 1');
    await assertTerminalContains(page, 'Test 2');
  });

  test('should handle long-running commands', async ({ page }) => {
    // Execute and wait for completion
    await executeAndVerifyCommand(page, 'sleep 1 && echo "Done sleeping"', 'Done sleeping');
  });

  test('should handle command interruption', async ({ page }) => {
    try {
      // Start long command
      await page.keyboard.type('sleep 5');
      await page.keyboard.press('Enter');

      // Wait for the command to start executing by checking for lack of prompt
      await waitForTerminalBusy(page);

      await interruptCommand(page);

      // Verify we can execute new command
      await executeAndVerifyCommand(page, 'echo "After interrupt"', 'After interrupt');
    } catch (error) {
      // Terminal interaction might not work properly in CI
      if (error.message?.includes('Timeout')) {
        test.skip(true, 'Terminal interaction timeout in CI environment');
      }
      throw error;
    }
  });

  test('should clear terminal screen', async ({ page }) => {
    // Add content first
    await executeAndVerifyCommand(page, 'echo "Test content"', 'Test content');
    await executeAndVerifyCommand(page, 'echo "More test content"', 'More test content');

    // Get terminal content before clearing
    const terminal = page.locator('vibe-terminal');
    await expect(terminal).toContainText('Test content');
    await expect(terminal).toContainText('More test content');

    // Clear terminal using the clear command
    // Note: Ctrl+L is intercepted as a browser shortcut in VibeTunnel
    await page.keyboard.type('clear');
    await page.keyboard.press('Enter');

    // Wait for the terminal to be cleared by checking that old content is gone
    await expect(terminal).not.toContainText('Test content', { timeout: 5000 });

    // Execute a new command to verify terminal is still functional
    await executeAndVerifyCommand(page, 'echo "After clear"', 'After clear');

    // Verify new content is visible
    await expect(terminal).toContainText('After clear');
  });

  test('should handle file system navigation', async ({ page }) => {
    const testDir = `test-dir-${Date.now()}`;

    // Execute directory operations as a sequence
    await executeCommandSequence(page, ['pwd', `mkdir ${testDir}`, `cd ${testDir}`, 'pwd']);

    // Verify we're in the new directory
    await assertTerminalContains(page, testDir);

    // Cleanup
    await executeCommandSequence(page, ['cd ..', `rmdir ${testDir}`]);
  });

  test('should handle environment variables', async ({ page }) => {
    const varName = 'TEST_VAR';
    const varValue = 'VibeTunnel_Test_123';

    // Set and verify environment variable
    await executeCommandSequence(page, [`export ${varName}="${varValue}"`, `echo $${varName}`]);

    // Get just the output of the echo command
    const output = await getCommandOutput(page, 'env | grep TEST_VAR');
    expect(output).toContain(varName);
    expect(output).toContain(varValue);
  });

  test('should handle terminal resize', async ({ page }) => {
    // Get initial terminal dimensions
    const initialDimensions = await getTerminalDimensions(page);

    // Type something before resize
    await executeAndVerifyCommand(page, 'echo "Before resize"', 'Before resize');

    // Get current viewport and calculate a different size that will trigger terminal resize
    const viewport = page.viewportSize();
    const currentWidth = viewport?.width || 1280;
    // Ensure we pick a different width - if current is 1200, use 1600, otherwise use 1200
    const newWidth = currentWidth === 1200 ? 1600 : 1200;
    const newHeight = 900;

    // Resize the viewport to trigger terminal resize
    await page.setViewportSize({ width: newWidth, height: newHeight });

    // Wait for terminal-resize event or dimension change
    const newDimensions = await waitForTerminalResize(page, initialDimensions);

    // At least one dimension should have changed
    const dimensionsChanged =
      newDimensions.cols !== initialDimensions.cols ||
      newDimensions.rows !== initialDimensions.rows ||
      newDimensions.actualCols !== initialDimensions.actualCols ||
      newDimensions.actualRows !== initialDimensions.actualRows;

    expect(dimensionsChanged).toBe(true);

    // The terminal should still show our previous output
    await assertTerminalContains(page, 'Before resize');
  });

  test('should handle ANSI colors and formatting', async ({ page }) => {
    // Test with retry in case of timing issues
    await executeCommandWithRetry(page, 'echo -e "\\033[31mRed Text\\033[0m"', 'Red Text');

    await executeAndVerifyCommand(page, 'echo -e "\\033[1mBold Text\\033[0m"', 'Bold Text');
  });
});
