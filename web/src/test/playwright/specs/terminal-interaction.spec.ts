import { expect, test } from '../fixtures/test.fixture';
import {
  cleanupSessions,
  generateTestSessionName,
  waitForShellPrompt,
} from '../helpers/terminal.helper';

test.describe('Terminal Interaction', () => {
  // Clean up once before all tests
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await cleanupSessions(page);
    await page.close();
  });

  test.beforeEach(async ({ page, sessionListPage, sessionViewPage }) => {
    // Create a new session
    await sessionListPage.navigate();
    await sessionListPage.createNewSession(generateTestSessionName(), false);
    await sessionViewPage.waitForTerminalReady();
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
    // Test command with special characters
    const specialText = 'Test!@#$%^&*()_+-=[]{}|;:,.<>?';
    await sessionViewPage.typeCommand(`echo "${specialText}"`);
    await sessionViewPage.waitForOutput(specialText);

    // Verify output
    const output = await sessionViewPage.getTerminalOutput();
    expect(output).toContain(specialText);
  });

  test('should execute multiple commands in sequence', async ({ sessionViewPage, page }) => {
    // Execute multiple commands
    const commands = ['echo "First command"', 'echo "Second command"', 'echo "Third command"'];

    for (const cmd of commands) {
      await sessionViewPage.typeCommand(cmd);
      await waitForShellPrompt(page);
    }

    // Verify all outputs are present
    const output = await sessionViewPage.getTerminalOutput();
    expect(output).toContain('First command');
    expect(output).toContain('Second command');
    expect(output).toContain('Third command');
  });

  test('should handle long-running commands', async ({ sessionViewPage, page }) => {
    // Execute a command that takes some time
    await sessionViewPage.typeCommand('sleep 2 && echo "Done sleeping"');

    // Wait for completion
    await sessionViewPage.waitForOutput('Done sleeping', { timeout: 5000 });

    // Verify we're back at prompt
    await waitForShellPrompt(page);
  });

  test('should handle command interruption', async ({ sessionViewPage, page }) => {
    // Start a long-running command
    await sessionViewPage.typeCommand('sleep 30');

    // Wait a moment
    await page.waitForTimeout(1000);

    // Send interrupt signal
    await sessionViewPage.sendInterrupt();

    // Wait for prompt to return
    await waitForShellPrompt(page);

    // Verify we can execute another command
    await sessionViewPage.typeCommand('echo "After interrupt"');
    await sessionViewPage.waitForOutput('After interrupt');
  });

  test('should clear terminal screen', async ({ sessionViewPage, page }) => {
    // Execute some commands to fill the screen
    for (let i = 0; i < 5; i++) {
      await sessionViewPage.typeCommand(`echo "Line ${i}"`);
      await waitForShellPrompt(page);
    }

    // Get output before clear
    const outputBefore = await sessionViewPage.getTerminalOutput();
    expect(outputBefore).toContain('Line 0');
    expect(outputBefore).toContain('Line 4');

    // Clear the terminal
    await sessionViewPage.clearTerminal();
    await page.waitForTimeout(500);

    // Get output after clear
    const outputAfter = await sessionViewPage.getTerminalOutput();

    // The terminal should be cleared - check that the "Line" outputs are gone
    expect(outputAfter).not.toContain('Line 0');
    expect(outputAfter).not.toContain('Line 4');

    // But should still have a prompt
    expect(outputAfter).toMatch(/[$>#%❯]/);

    // And should be significantly shorter
    expect(outputAfter.trim().split('\n').length).toBeLessThan(5);
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
