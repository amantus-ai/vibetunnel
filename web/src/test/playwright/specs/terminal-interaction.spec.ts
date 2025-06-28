import { test, expect } from '../fixtures/test.fixture';
import { TerminalHelper } from '../helpers/terminal.helper';

test.describe('Terminal Interaction', () => {
  test.beforeEach(async ({ page, sessionListPage, sessionViewPage }) => {
    // Clean up and create a new session
    await TerminalHelper.cleanupSessions(page);
    await sessionListPage.navigate();
    await sessionListPage.createNewSession('Terminal Test');
    await sessionViewPage.waitForTerminalReady();
    await TerminalHelper.waitForShellPrompt(page);
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
    const commands = [
      'echo "First command"',
      'echo "Second command"',
      'echo "Third command"',
    ];
    
    for (const cmd of commands) {
      await sessionViewPage.typeCommand(cmd);
      await TerminalHelper.waitForShellPrompt(page);
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
    await TerminalHelper.waitForShellPrompt(page);
  });

  test('should handle command interruption', async ({ sessionViewPage, page }) => {
    // Start a long-running command
    await sessionViewPage.typeCommand('sleep 30');
    
    // Wait a moment
    await page.waitForTimeout(1000);
    
    // Send interrupt signal
    await sessionViewPage.sendInterrupt();
    
    // Wait for prompt to return
    await TerminalHelper.waitForShellPrompt(page);
    
    // Verify we can execute another command
    await sessionViewPage.typeCommand('echo "After interrupt"');
    await sessionViewPage.waitForOutput('After interrupt');
  });

  test('should clear terminal screen', async ({ sessionViewPage, page }) => {
    // Execute some commands to fill the screen
    for (let i = 0; i < 5; i++) {
      await sessionViewPage.typeCommand(`echo "Line ${i}"`);
      await TerminalHelper.waitForShellPrompt(page);
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
    
    // The terminal should be mostly empty (might still have prompt)
    expect(outputAfter.length).toBeLessThan(outputBefore.length / 2);
  });

  test('should handle file system navigation', async ({ sessionViewPage, page }) => {
    // Get current directory
    await sessionViewPage.typeCommand('pwd');
    await TerminalHelper.waitForShellPrompt(page);
    
    // Create a test directory
    const testDir = `test-dir-${Date.now()}`;
    await sessionViewPage.typeCommand(`mkdir ${testDir}`);
    await TerminalHelper.waitForShellPrompt(page);
    
    // Navigate into directory
    await sessionViewPage.typeCommand(`cd ${testDir}`);
    await TerminalHelper.waitForShellPrompt(page);
    
    // Verify we're in the new directory
    await sessionViewPage.typeCommand('pwd');
    await sessionViewPage.waitForOutput(testDir);
    
    // Clean up
    await sessionViewPage.typeCommand('cd ..');
    await TerminalHelper.waitForShellPrompt(page);
    await sessionViewPage.typeCommand(`rmdir ${testDir}`);
    await TerminalHelper.waitForShellPrompt(page);
  });

  test('should handle environment variables', async ({ sessionViewPage, page }) => {
    // Set an environment variable
    const varName = 'TEST_VAR';
    const varValue = 'VibeTunnel_Test_123';
    
    await sessionViewPage.typeCommand(`export ${varName}="${varValue}"`);
    await TerminalHelper.waitForShellPrompt(page);
    
    // Echo the variable
    await sessionViewPage.typeCommand(`echo $${varName}`);
    await sessionViewPage.waitForOutput(varValue);
    
    // Verify it's in the environment
    await sessionViewPage.typeCommand('env | grep TEST_VAR');
    await sessionViewPage.waitForOutput(`${varName}=${varValue}`);
  });

  test('should handle terminal resize', async ({ sessionViewPage, page }) => {
    // Get initial size indication
    await sessionViewPage.typeCommand('tput cols');
    await TerminalHelper.waitForShellPrompt(page);
    const initialOutput = await TerminalHelper.getLastCommandOutput(page);
    const initialCols = parseInt(initialOutput.trim());
    
    // Resize the terminal
    await sessionViewPage.resizeTerminal(1200, 800);
    
    // Get new size
    await sessionViewPage.typeCommand('tput cols');
    await TerminalHelper.waitForShellPrompt(page);
    const resizedOutput = await TerminalHelper.getLastCommandOutput(page);
    const resizedCols = parseInt(resizedOutput.trim());
    
    // Verify size changed
    expect(resizedCols).toBeGreaterThan(initialCols);
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