import { expect, test } from '../fixtures/test.fixture';
import { generateTestSessionName, waitForShellPrompt } from '../helpers/terminal.helper';

test.describe.skip('Terminal Interaction', () => {
  // Skip cleanup - tests run too slow

  test.beforeEach(async ({ page, sessionListPage, sessionViewPage }) => {
    // Create a new session with spawn window = false (server-side terminal)
    await sessionListPage.navigate();
    await sessionListPage.createNewSession(generateTestSessionName(), false);
    await expect(sessionViewPage.page).toHaveURL(/\?session=/);

    // Wait for terminal to be ready
    await sessionViewPage.waitForTerminalReady();
    // Wait for shell prompt to appear
    await waitForShellPrompt(page);
  });

  test('should execute basic commands', async ({ sessionViewPage }) => {
    // Execute echo command
    await sessionViewPage.typeCommand('echo "Hello VibeTunnel"');
    await sessionViewPage.waitForOutput('Hello VibeTunnel');

    // Verify output
    const output = await sessionViewPage.getTerminalOutput();
    expect(output).toContain('Hello VibeTunnel');
  });

  test('should handle command with special characters', async ({ sessionViewPage }) => {
    // Test command with special characters - use simpler set to avoid typing issues
    const specialText = 'Test with spaces and numbers 123';
    await sessionViewPage.typeCommand(`echo "${specialText}"`);
    await sessionViewPage.waitForOutput(specialText, { timeout: 2000 });

    // Verify output
    const output = await sessionViewPage.getTerminalOutput();
    expect(output).toContain(specialText);
  });

  test('should execute multiple commands in sequence', async ({ sessionViewPage, page }) => {
    // Execute a simple sequence
    await sessionViewPage.typeCommand('echo "Test 1"');
    await sessionViewPage.waitForOutput('Test 1', { timeout: 2000 });

    await sessionViewPage.typeCommand('echo "Test 2"');
    await sessionViewPage.waitForOutput('Test 2', { timeout: 2000 });

    // Verify outputs
    const output = await sessionViewPage.getTerminalOutput();
    expect(output).toContain('Test 1');
    expect(output).toContain('Test 2');
  });

  test('should handle long-running commands', async ({ sessionViewPage, page }) => {
    // Execute a command that takes some time
    await sessionViewPage.typeCommand('sleep 1 && echo "Done sleeping"');

    // Wait for completion
    await sessionViewPage.waitForOutput('Done sleeping', { timeout: 3000 });

    // Verify we're back at prompt
    await waitForShellPrompt(page);
  });

  test('should handle command interruption', async ({ sessionViewPage, page }) => {
    // Start a long-running command
    await sessionViewPage.typeCommand('sleep 5');
    // Wait for command to start executing (cursor should move)
    await page.waitForFunction(
      () => {
        const terminal = document.querySelector('vibe-terminal');
        const content = terminal?.textContent || '';
        return content.includes('sleep 5');
      },
      { timeout: 1000 }
    );

    // Send interrupt signal
    await sessionViewPage.sendInterrupt();
    // Wait for interrupt to be processed
    await page.waitForFunction(
      () => {
        const terminal = document.querySelector('vibe-terminal');
        const content = terminal?.textContent || '';
        // Look for interrupt indicators like ^C or new prompt
        return content.includes('^C') || /[$>#%❯]\s*$/.test(content);
      },
      { timeout: 2000 }
    );

    // Verify we can execute another command
    await sessionViewPage.typeCommand('echo "After interrupt"');
    await sessionViewPage.waitForOutput('After interrupt', { timeout: 2000 });
  });

  test('should clear terminal screen', async ({ sessionViewPage, page }) => {
    // Add some content
    await sessionViewPage.typeCommand('echo "Test content"');
    await sessionViewPage.waitForOutput('Test content', { timeout: 2000 });

    // Clear the terminal
    await sessionViewPage.clearTerminal();
    // Wait for terminal to be cleared
    await page.waitForFunction(
      () => {
        const terminal = document.querySelector('vibe-terminal');
        const content = terminal?.textContent || '';
        // Terminal should be mostly empty after clear
        return content.trim().split('\n').length < 3;
      },
      { timeout: 2000 }
    );

    // Get output after clear
    const outputAfter = await sessionViewPage.getTerminalOutput();

    // The terminal should be cleared
    expect(outputAfter).not.toContain('Test content');
  });

  test('should handle file system navigation', async ({ sessionViewPage, page }) => {
    // Get current directory
    await sessionViewPage.typeCommand('pwd');
    await waitForShellPrompt(page);

    // Create a test directory
    const testDir = `test-dir-${Date.now()}`;
    await sessionViewPage.typeCommand(`mkdir ${testDir}`);
    await waitForShellPrompt(page);

    // Navigate into directory
    await sessionViewPage.typeCommand(`cd ${testDir}`);
    await waitForShellPrompt(page);

    // Verify we're in the new directory
    await sessionViewPage.typeCommand('pwd');
    await sessionViewPage.waitForOutput(testDir);

    // Clean up
    await sessionViewPage.typeCommand('cd ..');
    await waitForShellPrompt(page);
    await sessionViewPage.typeCommand(`rmdir ${testDir}`);
    await waitForShellPrompt(page);
  });

  test('should handle environment variables', async ({ sessionViewPage, page }) => {
    // Set an environment variable
    const varName = 'TEST_VAR';
    const varValue = 'VibeTunnel_Test_123';

    await sessionViewPage.typeCommand(`export ${varName}="${varValue}"`);
    await waitForShellPrompt(page);

    // Echo the variable
    await sessionViewPage.typeCommand(`echo $${varName}`);
    await sessionViewPage.waitForOutput(varValue);

    // Verify it's in the environment
    await sessionViewPage.typeCommand('env | grep TEST_VAR');
    await waitForShellPrompt(page);

    // Just verify the output contains the variable name
    const output = await sessionViewPage.getTerminalOutput();
    expect(output).toContain(varName);
    expect(output).toContain(varValue);
  });

  test('should handle terminal resize', async ({ sessionViewPage, page }) => {
    // Get initial viewport size
    const initialViewport = page.viewportSize();
    expect(initialViewport).toBeTruthy();
    const initialWidth = initialViewport?.width || 1280;
    const _initialHeight = initialViewport?.height || 720;

    // Type something before resize
    await sessionViewPage.typeCommand('echo "Before resize"');
    await sessionViewPage.waitForOutput('Before resize');

    // Resize the terminal to a different size
    const newWidth = initialWidth === 1280 ? 1600 : 1200;
    const newHeight = 800;
    await sessionViewPage.resizeTerminal(newWidth, newHeight);

    // Verify viewport actually changed
    const newViewport = page.viewportSize();
    expect(newViewport).toBeTruthy();
    expect(newViewport?.width).toBe(newWidth);
    expect(newViewport?.height).toBe(newHeight);
    expect(newViewport?.width).not.toBe(initialWidth);

    // Verify the terminal element still exists after resize
    const terminalExists = await page.locator('vibe-terminal').isVisible();
    expect(terminalExists).toBe(true);

    // The terminal should still show our previous output
    const output = await sessionViewPage.getTerminalOutput();
    expect(output).toContain('Before resize');
  });

  test('should handle ANSI colors and formatting', async ({ sessionViewPage }) => {
    // Test color output
    await sessionViewPage.typeCommand('echo -e "\\033[31mRed Text\\033[0m"');
    await sessionViewPage.waitForOutput('Red Text');

    // Test bold text
    await sessionViewPage.typeCommand('echo -e "\\033[1mBold Text\\033[0m"');
    await sessionViewPage.waitForOutput('Bold Text');

    // The actual rendering verification would require checking computed styles
    // For now, we just verify the commands execute without error
    const output = await sessionViewPage.getTerminalOutput();
    expect(output).toContain('Red Text');
    expect(output).toContain('Bold Text');
  });
});
