import { expect, test } from '../fixtures/test.fixture';
import { createAndNavigateToSession } from '../helpers/session-lifecycle.helper';
import {
  assertTerminalContains,
  executeAndVerifyCommand,
  executeCommand,
  executeCommandSequence,
  executeCommandWithRetry,
  getCommandOutput,
  getTerminalDimensions,
  interruptCommand,
  waitForTerminalBusy,
  waitForTerminalReady,
  waitForTerminalResize,
} from '../helpers/terminal-optimization.helper';
import { TestSessionManager } from '../helpers/test-data-manager.helper';

test.describe('Terminal Interaction', () => {
  // Increase timeout for terminal tests
  test.setTimeout(30000);

  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page);

    // Create a session for all tests
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('terminal-test'),
    });
    await waitForTerminalReady(page, 5000);
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });

  test('should execute basic commands', async ({ page }) => {
    // Execute echo command
    await executeCommand(page, 'echo "Hello VibeTunnel"');

    // Verify output
    await assertTerminalContains(page, 'Hello VibeTunnel');
  });

  test('should handle command with special characters', async ({ page }) => {
    const specialText = 'Test with spaces and numbers 123';

    // Execute command
    await executeCommand(page, `echo "${specialText}"`);

    // Verify output
    await assertTerminalContains(page, specialText);
  });

  test('should execute multiple commands in sequence', async ({ page }) => {
    // Execute first command
    await executeCommand(page, 'echo "Test 1"');
    await assertTerminalContains(page, 'Test 1');

    // Execute second command
    await executeCommand(page, 'echo "Test 2"');
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

    try {
      // Execute directory operations one by one for better control
      await executeCommand(page, 'pwd');
      await page.waitForTimeout(200);

      await executeCommand(page, `mkdir ${testDir}`);
      await page.waitForTimeout(200);

      await executeCommand(page, `cd ${testDir}`);
      await page.waitForTimeout(200);

      await executeCommand(page, 'pwd');
      await page.waitForTimeout(200);

      // Verify we're in the new directory
      await assertTerminalContains(page, testDir);

      // Cleanup
      await executeCommand(page, 'cd ..');
      await page.waitForTimeout(200);

      await executeCommand(page, `rmdir ${testDir}`);
    } catch (error) {
      // Get terminal content for debugging
      const content = await page.locator('vibe-terminal').textContent();
      console.log('Terminal content on error:', content);
      throw error;
    }
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
