import { Page } from '@playwright/test';

export class TerminalHelper {
  static async waitForShellPrompt(page: Page, timeout = 10000) {
    // Wait for common shell prompts
    await page.waitForFunction(
      () => {
        const terminal = document.querySelector('.xterm-text-layer');
        const text = terminal?.textContent || '';
        // Match common prompts: $, >, #, or username@hostname patterns
        return /[$>#]\s*$|@.*[$>#]\s*$/m.test(text);
      },
      { timeout }
    );
  }

  static async executeCommandAndWaitForPrompt(page: Page, command: string) {
    // Type command
    await page.keyboard.type(command);
    await page.keyboard.press('Enter');
    
    // Wait for next prompt
    await this.waitForShellPrompt(page);
  }

  static async getLastCommandOutput(page: Page): Promise<string> {
    return await page.evaluate(() => {
      const terminal = document.querySelector('.xterm-text-layer');
      const fullText = terminal?.textContent || '';
      const lines = fullText.split('\n');
      
      // Find the last prompt and get everything before it
      let lastPromptIndex = -1;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (/[$>#]\s*$|@.*[$>#]\s*$/.test(lines[i])) {
          lastPromptIndex = i;
          break;
        }
      }
      
      if (lastPromptIndex > 0) {
        // Find the previous prompt
        let prevPromptIndex = -1;
        for (let i = lastPromptIndex - 1; i >= 0; i--) {
          if (/[$>#]\s*$|@.*[$>#]\s*$/.test(lines[i])) {
            prevPromptIndex = i;
            break;
          }
        }
        
        if (prevPromptIndex >= 0) {
          // Return output between prompts
          return lines.slice(prevPromptIndex + 1, lastPromptIndex).join('\n').trim();
        }
      }
      
      return '';
    });
  }

  static async waitForProcessToComplete(page: Page, processName: string, timeout = 30000) {
    await page.waitForFunction(
      (proc) => {
        const terminal = document.querySelector('.xterm-text-layer');
        const text = terminal?.textContent || '';
        // Check if process completed (usually shows exit code or returns to prompt)
        return text.includes(`${proc}: command not found`) || 
               text.includes('exit code') ||
               /[$>#]\s*$/.test(text.split('\n').pop() || '');
      },
      processName,
      { timeout }
    );
  }

  static generateTestSessionName(): string {
    return `test-session-${Date.now()}`;
  }

  static async cleanupSessions(page: Page) {
    // Navigate to session list
    await page.goto('/');
    
    // Wait for the page to load
    await page.waitForSelector('vibetunnel-app', { state: 'attached' });
    await page.waitForTimeout(1000);
    
    // Check if we're viewing a session instead of the session list
    const sessionView = await page.locator('session-view').count();
    if (sessionView > 0) {
      // We're in a session view, go back to the list
      const backButton = page.locator('button:has-text("Back")').first();
      if (await backButton.isVisible()) {
        await backButton.click();
        await page.waitForTimeout(500);
      }
    }
    
    // Now check if there are any sessions
    const sessionCards = await page.locator('session-card').count();
    
    if (sessionCards > 0) {
      // Kill all sessions
      for (let i = sessionCards - 1; i >= 0; i--) {
        const killButton = page.locator('session-card').nth(i).locator('button:has-text("Kill")');
        if (await killButton.isVisible()) {
          await killButton.click();
          // Accept confirmation dialog
          page.once('dialog', dialog => dialog.accept());
          await page.waitForTimeout(500);
        }
      }
    }
  }
}