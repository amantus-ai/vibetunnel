import type { Page } from '@playwright/test';
import { SessionListPage } from '../pages/session-list.page';

/**
 * Manages test sessions and ensures cleanup
 */
export class TestSessionManager {
  private sessions: Map<string, { id: string; spawnWindow: boolean }> = new Map();
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Creates a session and tracks it for cleanup
   */
  async createTrackedSession(
    sessionName?: string,
    spawnWindow = false,
    command?: string
  ): Promise<{ sessionName: string; sessionId: string }> {
    const sessionListPage = new SessionListPage(this.page);

    // Generate name if not provided
    const name = sessionName || this.generateSessionName();

    // Navigate to list if needed
    if (!this.page.url().endsWith('/')) {
      await sessionListPage.navigate();
    }

    try {
      // Create session - use bash by default for consistency
      await sessionListPage.createNewSession(name, spawnWindow, command || 'bash');

      // Get session ID from URL for web sessions
      let sessionId = '';
      if (!spawnWindow) {
        await this.page.waitForURL(/\?session=/, { timeout: 4000 });
        const url = this.page.url();

        if (!url.includes('?session=')) {
          throw new Error(`Failed to navigate to session after creation. Current URL: ${url}`);
        }

        sessionId = new URL(url).searchParams.get('session') || '';
        if (!sessionId) {
          throw new Error(`No session ID found in URL: ${url}`);
        }
      }

      // Track the session
      this.sessions.set(name, { id: sessionId, spawnWindow });

      return { sessionName: name, sessionId };
    } catch (error) {
      console.error(`Failed to create tracked session "${name}":`, error);
      // Still track it for cleanup attempt
      this.sessions.set(name, { id: '', spawnWindow });
      throw error;
    }
  }

  /**
   * Generates a unique session name with test context
   */
  generateSessionName(prefix = 'test'): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}-${timestamp}-${random}`;
  }

  /**
   * Cleans up a specific session
   */
  async cleanupSession(sessionName: string): Promise<void> {
    if (!this.sessions.has(sessionName)) return;

    const sessionListPage = new SessionListPage(this.page);

    // Navigate to list
    if (!this.page.url().endsWith('/')) {
      await this.page.goto('/', { waitUntil: 'domcontentloaded' });
    }

    try {
      // Wait for session cards
      await this.page.waitForSelector('session-card', { state: 'visible', timeout: 2000 });

      // Check if session exists
      const sessionCard = this.page.locator(`session-card:has-text("${sessionName}")`);
      if (await sessionCard.isVisible({ timeout: 1000 })) {
        await sessionListPage.killSession(sessionName);
      }

      // Remove from tracking
      this.sessions.delete(sessionName);
    } catch (error) {
      console.log(`Failed to cleanup session ${sessionName}:`, error);
    }
  }

  /**
   * Cleans up all tracked sessions
   */
  async cleanupAllSessions(): Promise<void> {
    if (this.sessions.size === 0) return;

    console.log(`Cleaning up ${this.sessions.size} tracked sessions`);

    // Navigate to list
    if (!this.page.url().endsWith('/')) {
      await this.page.goto('/', { waitUntil: 'domcontentloaded' });
    }

    // Try bulk cleanup first
    try {
      const killAllButton = this.page.locator('button:has-text("Kill All")');
      if (await killAllButton.isVisible({ timeout: 1000 })) {
        const [dialog] = await Promise.all([
          this.page.waitForEvent('dialog', { timeout: 5000 }).catch(() => null),
          killAllButton.click(),
        ]);
        if (dialog) {
          await dialog.accept();
        }

        // Wait for sessions to be marked as exited
        await this.page.waitForFunction(
          () => {
            const cards = document.querySelectorAll('session-card');
            return Array.from(cards).every(
              (card) =>
                card.textContent?.toLowerCase().includes('exited') ||
                card.textContent?.toLowerCase().includes('exit')
            );
          },
          { timeout: 3000 }
        );

        this.sessions.clear();
        return;
      }
    } catch (error) {
      console.log('Bulk cleanup failed, trying individual cleanup:', error);
    }

    // Fallback to individual cleanup
    const sessionNames = Array.from(this.sessions.keys());
    for (const sessionName of sessionNames) {
      await this.cleanupSession(sessionName);
    }
  }

  /**
   * Gets list of tracked sessions
   */
  getTrackedSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Checks if a session is being tracked
   */
  isTracking(sessionName: string): boolean {
    return this.sessions.has(sessionName);
  }

  /**
   * Clears tracking without cleanup (use when sessions are already cleaned)
   */
  clearTracking(): void {
    this.sessions.clear();
  }
}

/**
 * Creates test data factory for consistent test data generation
 */
export class TestDataFactory {
  private static counters: Map<string, number> = new Map();

  /**
   * Generates sequential IDs for a given prefix
   */
  static sequentialId(prefix: string): string {
    const current = TestDataFactory.counters.get(prefix) || 0;
    TestDataFactory.counters.set(prefix, current + 1);
    return `${prefix}-${current + 1}`;
  }

  /**
   * Generates session name with optional prefix
   */
  static sessionName(prefix = 'session'): string {
    const timestamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
    const counter = TestDataFactory.sequentialId(prefix);
    return `${counter}-${timestamp}`;
  }

  /**
   * Generates command for testing
   */
  static command(type: 'echo' | 'sleep' | 'env' | 'file' = 'echo'): string {
    switch (type) {
      case 'echo':
        return `echo "Test output ${Date.now()}"`;
      case 'sleep':
        return `sleep ${Math.floor(Math.random() * 3) + 1}`;
      case 'env':
        return `export TEST_VAR_${Date.now()}="test_value"`;
      case 'file':
        return `touch test-file-${Date.now()}.tmp`;
    }
  }

  /**
   * Reset all counters
   */
  static reset(): void {
    TestDataFactory.counters.clear();
  }
}

/**
 * Fixture data for common test scenarios
 */
export const TestFixtures = {
  // Common shell outputs
  prompts: {
    bash: '$ ',
    zsh: '% ',
    fish: '> ',
    generic: /[$>#%❯]\s*$/,
  },

  // Common error messages
  errors: {
    commandNotFound: 'command not found',
    permissionDenied: 'Permission denied',
    noSuchFile: 'No such file or directory',
  },

  // ANSI color codes for testing
  ansiCodes: {
    red: '\\033[31m',
    green: '\\033[32m',
    bold: '\\033[1m',
    reset: '\\033[0m',
  },

  // Common test timeouts
  timeouts: {
    quick: 1000,
    normal: 5000,
    slow: 10000,
    veryLong: 30000,
  },
};
