import { test } from '../fixtures/test.fixture';
import { TestSessionManager } from '../helpers/test-data-manager.helper';
import { TestDataFactory } from '../utils/test-utils';

const TEST_PREFIX = TestDataFactory.getTestSpecificPrefix('keyboard-input');

test.describe('Keyboard Input Tests', () => {
  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page, TEST_PREFIX);
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });

  test('should handle basic text input', async ({ sessionViewPage }) => {
    await sessionManager.createTrackedSession(
      sessionManager.generateSessionName('keyboard-cat'),
      false,
      'cat'
    );

    await sessionViewPage.waitForTerminalReady({ requirePrompt: false });
    await sessionViewPage.typeCommand('Hello Terminal');
    await sessionViewPage.waitForOutput('Hello Terminal', { timeout: 5000 });
    await sessionViewPage.sendInterrupt();
  });

  test('should handle Ctrl+C interrupt', async ({ sessionViewPage }) => {
    await sessionManager.createTrackedSession(
      sessionManager.generateSessionName('keyboard-bash'),
      false,
      'bash'
    );

    await sessionViewPage.waitForTerminalReady();
    await sessionViewPage.typeCommand('sleep 5');
    await sessionViewPage.sendInterrupt();
    await sessionViewPage.typeCommand('echo "Interrupted"');
    await sessionViewPage.waitForOutput('Interrupted', { timeout: 5000 });
    await sessionViewPage.typeCommand('exit');
  });

  test('should handle tab key', async ({ page, sessionViewPage }) => {
    await sessionManager.createTrackedSession(
      sessionManager.generateSessionName('keyboard-tab'),
      false,
      'bash'
    );

    await sessionViewPage.waitForTerminalReady();
    await sessionViewPage.clickTerminal();

    await page.keyboard.type('ec');
    await page.keyboard.press('Tab');
    await page.keyboard.type('ho "Tab OK"');
    await page.keyboard.press('Enter');

    await sessionViewPage.waitForOutput('Tab OK', { timeout: 5000 });
    await sessionViewPage.typeCommand('exit');
  });

  test('should handle paste', async ({ page, sessionViewPage }) => {
    await sessionManager.createTrackedSession(
      sessionManager.generateSessionName('keyboard-paste'),
      false,
      'cat'
    );

    await sessionViewPage.waitForTerminalReady({ requirePrompt: false });
    await sessionViewPage.clickTerminal();
    await sessionViewPage.pasteText('Pasted text');
    await page.keyboard.press('Enter');

    await sessionViewPage.waitForOutput('Pasted text', { timeout: 5000 });
    await sessionViewPage.sendInterrupt();
  });

  test('should handle a 600-line paste without hanging', async ({ page, sessionViewPage }) => {
    await sessionManager.createTrackedSession(
      sessionManager.generateSessionName('keyboard-large-paste'),
      false,
      'bash --noprofile --norc'
    );

    await sessionViewPage.waitForTerminalReady();
    await sessionViewPage.typeCommand(
      `python3 -c 'import sys; data=sys.stdin.read(); print("VT_PASTE_LINES="+str(len(data.splitlines())), flush=True)'`
    );

    const pastedText = `${Array.from(
      { length: 600 },
      (_, index) => `line-${String(index + 1).padStart(4, '0')}`
    ).join('\n')}\n`;
    // Dispatch on the rendered paste target to exercise the app handler deterministically.
    await page.evaluate((text) => {
      const pasteInput = document.querySelector(
        'vibe-terminal .terminal-paste-input'
      ) as HTMLTextAreaElement | null;
      if (!pasteInput) throw new Error('Terminal paste input is unavailable');

      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', text);
      pasteInput.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData,
          bubbles: true,
          cancelable: true,
        })
      );
    }, pastedText);
    await page.keyboard.press('Control+d');

    await sessionViewPage.waitForOutput('VT_PASTE_LINES=600', { timeout: 15000 });
    await sessionViewPage.typeCommand('echo "VT_STILL_RESPONSIVE"');
    await sessionViewPage.waitForOutput('VT_STILL_RESPONSIVE', { timeout: 5000 });
    await sessionViewPage.typeCommand('exit');
  });

  test('should handle arrow key editing', async ({ page, sessionViewPage }) => {
    await sessionManager.createTrackedSession(
      sessionManager.generateSessionName('keyboard-arrows'),
      false,
      'bash'
    );

    await sessionViewPage.waitForTerminalReady();
    await sessionViewPage.clickTerminal();

    await page.keyboard.type('echo "abc"');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type('X');
    await page.keyboard.press('Enter');

    await sessionViewPage.waitForOutput('abXc', { timeout: 5000 });
    await sessionViewPage.typeCommand('exit');
  });
});
