import { expect, test } from '../fixtures/test.fixture';
import { TestSessionManager } from '../helpers/test-data-manager.helper';
import { TestDataFactory } from '../utils/test-utils';

const TEST_PREFIX = TestDataFactory.getTestSpecificPrefix('terminal-output');

test.describe('Terminal Output Tests', () => {
  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page, TEST_PREFIX);
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });

  test('should display command output correctly', async ({ sessionViewPage }) => {
    await sessionManager.createTrackedSession(
      sessionManager.generateSessionName('termout-echo'),
      false,
      'bash'
    );

    await sessionViewPage.waitForTerminalReady();
    await sessionViewPage.typeCommand('echo "Hello, World!"');
    await sessionViewPage.waitForOutput('Hello, World!', { timeout: 5000 });
  });

  test('should handle multiline output', async ({ sessionViewPage }) => {
    await sessionManager.createTrackedSession(
      sessionManager.generateSessionName('termout-multiline'),
      false,
      'bash'
    );

    await sessionViewPage.waitForTerminalReady();
    await sessionViewPage.typeCommand('printf "Line 1\\nLine 2\\nLine 3\\n"');
    await sessionViewPage.waitForOutput('Line 1', { timeout: 5000 });
    await sessionViewPage.waitForOutput('Line 2', { timeout: 5000 });
    await sessionViewPage.waitForOutput('Line 3', { timeout: 5000 });
  });

  test('should handle large output', async ({ sessionViewPage }) => {
    await sessionManager.createTrackedSession(
      sessionManager.generateSessionName('termout-large'),
      false,
      'bash'
    );

    await sessionViewPage.waitForTerminalReady();
    await sessionViewPage.typeCommand('seq 1 100');
    await sessionViewPage.waitForOutput('1', { timeout: 5000 });
    await sessionViewPage.waitForOutput('100', { timeout: 5000 });
  });

  test('should render ANSI output', async ({ sessionViewPage }) => {
    await sessionManager.createTrackedSession(
      sessionManager.generateSessionName('termout-ansi'),
      false,
      'bash'
    );

    await sessionViewPage.waitForTerminalReady();
    await sessionViewPage.typeCommand(
      'printf "\\033[31mRed text\\033[0m \\033[32mGreen text\\033[0m\\n"'
    );
    await sessionViewPage.waitForOutput('Red text', { timeout: 5000 });
    await sessionViewPage.waitForOutput('Green text', { timeout: 5000 });

    const output = await sessionViewPage.getTerminalOutput();
    expect(output).toContain('Red text');
    expect(output).toContain('Green text');
  });

  test('should keep terminal responsive with output', async ({ sessionViewPage }) => {
    await sessionManager.createTrackedSession(
      sessionManager.generateSessionName('termout-scroll'),
      false,
      'bash'
    );

    await sessionViewPage.waitForTerminalReady();
    await sessionViewPage.typeCommand('for i in {1..50}; do echo "Line $i"; done');
    await sessionViewPage.waitForOutput('Line 1', { timeout: 5000 });
    await sessionViewPage.waitForOutput('Line 50', { timeout: 5000 });
  });
});
