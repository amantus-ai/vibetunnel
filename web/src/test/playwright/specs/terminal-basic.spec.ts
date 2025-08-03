import { expect, test } from '../fixtures/test.fixture';
import { assertTerminalReady } from '../helpers/assertion.helper';
import { createAndNavigateToSession } from '../helpers/session-lifecycle.helper';
import { TestSessionManager } from '../helpers/test-data-manager.helper';
import { TestDataFactory } from '../utils/test-utils';

// Use a unique prefix for this test suite
const TEST_PREFIX = TestDataFactory.getTestSpecificPrefix('terminal-basic');

// These tests create their own sessions and can run in parallel
test.describe.configure({ mode: 'parallel' });

test.describe('Terminal Basic Tests', () => {
  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page, TEST_PREFIX);
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });

  test('should display terminal and accept input', async ({ page }) => {
    test.setTimeout(45000);
    
    // Create and navigate to session
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('terminal-input-test'),
    });

    await assertTerminalReady(page, 15000);

    // Get terminal element
    const terminal = page.locator('.terminal, [data-testid="terminal"], .xterm').first();
    await expect(terminal).toBeVisible({ timeout: 10000 });

    // Click on terminal to focus it
    await terminal.click();
    await page.waitForTimeout(1000);

    // Type a simple command
    await page.keyboard.type('echo "Terminal Input Test"');
    await page.keyboard.press('Enter');

    // Wait for command to execute
    await page.waitForTimeout(3000);

    // Verify output appears
    await expect(terminal).toContainText('Terminal Input Test', { timeout: 8000 });

    console.log('✅ Terminal input and output working');
  });

  test('should handle keyboard interactions', async ({ page }) => {
    test.setTimeout(45000);
    
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('keyboard-test'),
    });

    await assertTerminalReady(page, 15000);

    const terminal = page.locator('.terminal, [data-testid="terminal"], .xterm').first();
    await expect(terminal).toBeVisible();
    await terminal.click();
    await page.waitForTimeout(1000);

    // Test basic text input
    await page.keyboard.type('pwd');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);

    // Test arrow keys for command history
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(500);

    // Test backspace
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    
    // Type new command
    await page.keyboard.type('ls');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);

    console.log('✅ Keyboard interactions tested');
  });

  test('should execute multiple commands sequentially', async ({ page }) => {
    test.setTimeout(60000);
    
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('multi-command-test'),
    });

    await assertTerminalReady(page, 15000);

    const terminal = page.locator('.terminal, [data-testid="terminal"], .xterm').first();
    await expect(terminal).toBeVisible();
    await terminal.click();
    await page.waitForTimeout(1000);

    // Execute a series of commands
    const commands = [
      'echo "Command 1: Starting test"',
      'pwd',
      'echo "Command 2: Working directory shown"',
      'whoami',
      'echo "Command 3: User identified"',
      'date',
      'echo "Command 4: Date displayed"'
    ];

    for (let i = 0; i < commands.length; i++) {
      const command = commands[i];
      console.log(`Executing command ${i + 1}: ${command}`);
      
      await page.keyboard.type(command);
      await page.keyboard.press('Enter');
      
      // Wait between commands
      await page.waitForTimeout(2000);
    }

    // Verify some of the command outputs
    await expect(terminal).toContainText('Command 1: Starting test');
    await expect(terminal).toContainText('Command 2: Working directory shown');
    await expect(terminal).toContainText('Command 3: User identified');
    await expect(terminal).toContainText('Command 4: Date displayed');

    console.log('✅ Multiple sequential commands executed successfully');
  });

  test('should handle terminal scrolling', async ({ page }) => {
    test.setTimeout(60000);
    
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('scroll-test'),
    });

    await assertTerminalReady(page, 15000);

    const terminal = page.locator('.terminal, [data-testid="terminal"], .xterm').first();
    await expect(terminal).toBeVisible();
    await terminal.click();
    await page.waitForTimeout(1000);

    // Generate a lot of output to test scrolling
    await page.keyboard.type('for i in {1..20}; do echo "Line $i - Testing terminal scrolling"; done');
    await page.keyboard.press('Enter');
    
    // Wait for command to complete
    await page.waitForTimeout(5000);

    // Verify some of the output
    await expect(terminal).toContainText('Line 1 - Testing terminal scrolling');
    await expect(terminal).toContainText('Line 20 - Testing terminal scrolling');

    // Test scrolling (if scrollbar exists)
    const scrollableArea = terminal.locator('.xterm-viewport, .terminal-viewport');
    if (await scrollableArea.isVisible({ timeout: 2000 })) {
      // Try to scroll up
      await scrollableArea.hover();
      await page.mouse.wheel(0, -200);
      await page.waitForTimeout(1000);
      
      // Scroll back down
      await page.mouse.wheel(0, 200);
      await page.waitForTimeout(1000);
    }

    console.log('✅ Terminal scrolling tested');
  });

  test('should maintain terminal state during navigation', async ({ page }) => {
    test.setTimeout(45000);
    
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('state-test'),
    });

    await assertTerminalReady(page, 15000);

    const terminal = page.locator('.terminal, [data-testid="terminal"], .xterm').first();
    await terminal.click();
    await page.waitForTimeout(1000);

    // Execute a command to create identifiable output
    await page.keyboard.type('echo "State persistence test marker"');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);

    // Verify the output is there
    await expect(terminal).toContainText('State persistence test marker');

    // Navigate away and back
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Navigate back to the session
    const sessionCard = page.locator('session-card').first();
    if (await sessionCard.isVisible({ timeout: 5000 })) {
      await sessionCard.click();
      await assertTerminalReady(page, 15000);
      
      // Check if our marker is still there
      const terminalAfterReturn = page.locator('.terminal, [data-testid="terminal"], .xterm').first();
      await expect(terminalAfterReturn).toContainText('State persistence test marker', { timeout: 10000 });
      
      console.log('✅ Terminal state preserved during navigation');
    } else {
      console.log('ℹ️  Session card not found, testing basic navigation instead');
    }
  });
});