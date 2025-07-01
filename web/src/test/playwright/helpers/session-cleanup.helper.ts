import type { Page } from '@playwright/test';
import { CLEANUP_CONFIG } from '../config/test-constants';
import type { SessionInfo } from '../types/session.types';
import { logger } from '../utils/logger';
import { extractBaseUrl } from '../utils/url.utils';

/**
 * Smart session cleanup helper that efficiently removes test sessions
 * Optimized for sequential test execution
 */
export class SessionCleanupHelper {
  private page: Page;
  private baseUrl: string;

  constructor(page: Page) {
    this.page = page;
    this.baseUrl = extractBaseUrl(page.url());
  }

  /**
   * Clean up all sessions matching a pattern
   * Uses API for efficiency
   */
  async cleanupByPattern(pattern: string | RegExp): Promise<number> {
    try {
      // Get all sessions via API
      const sessions = await this.page.evaluate(async (url) => {
        const response = await fetch(`${url}/api/sessions`);
        if (!response.ok) return [];
        return response.json();
      }, this.baseUrl);

      // Filter sessions matching pattern
      const toDelete = sessions.filter((s: SessionInfo) => {
        if (typeof pattern === 'string') {
          return s.name.includes(pattern);
        }
        return pattern.test(s.name);
      });

      if (toDelete.length === 0) return 0;

      // Delete in parallel via API
      await this.page.evaluate(
        async ({ url, sessionIds }) => {
          const promises = sessionIds.map((id: string) =>
            fetch(`${url}/api/sessions/${id}`, { method: 'DELETE' }).catch(() => {
              // Ignore individual failures
            })
          );
          await Promise.all(promises);
        },
        { url: this.baseUrl, sessionIds: toDelete.map((s: SessionInfo) => s.id) }
      );

      return toDelete.length;
    } catch (error) {
      logger.error('Failed to cleanup sessions by pattern:', error);
      return 0;
    }
  }

  /**
   * Clean up old sessions (older than specified minutes)
   */
  async cleanupOldSessions(olderThanMinutes = CLEANUP_CONFIG.DEFAULT_AGE_MINUTES): Promise<number> {
    try {
      const cutoffTime = Date.now() - olderThanMinutes * 60 * 1000;

      // Get all sessions via API
      const sessions = await this.page.evaluate(async (url) => {
        const response = await fetch(`${url}/api/sessions`);
        if (!response.ok) return [];
        return response.json();
      }, this.baseUrl);

      // Filter old sessions
      const toDelete = sessions.filter((s: SessionInfo) => {
        const timestamp = s.created || s.startTime;

        // If no timestamp exists, consider it old and clean it up
        if (!timestamp) {
          console.log(`Session ${s.id} has no timestamp, marking for cleanup`);
          return true;
        }

        const created = new Date(timestamp).getTime();

        // Handle invalid dates (NaN) - treat as old sessions
        if (Number.isNaN(created)) {
          console.log(`Session ${s.id} has invalid timestamp: ${timestamp}`);
          return true;
        }

        const isOld = created < cutoffTime;
        if (isOld) {
          const age = Date.now() - created;
          console.log(`Session ${s.id} is ${Math.round(age / 1000)}s old, marking for cleanup`);
        }

        return isOld;
      });

      if (toDelete.length === 0) return 0;

      // Delete old sessions
      await this.page.evaluate(
        async ({ url, sessionIds }) => {
          const promises = sessionIds.map((id: string) =>
            fetch(`${url}/api/sessions/${id}`, { method: 'DELETE' }).catch(() => {
              // Ignore individual failures
            })
          );
          await Promise.all(promises);
        },
        { url: this.baseUrl, sessionIds: toDelete.map((s: SessionInfo) => s.id) }
      );

      return toDelete.length;
    } catch (error) {
      logger.error('Failed to cleanup old sessions:', error);
      return 0;
    }
  }

  /**
   * Clean up exited sessions only
   */
  async cleanupExitedSessions(): Promise<number> {
    try {
      const sessions = await this.page.evaluate(async (url) => {
        const response = await fetch(`${url}/api/sessions`);
        if (!response.ok) return [];
        return response.json();
      }, this.baseUrl);

      // Filter exited sessions
      const toDelete = sessions.filter(
        (s: SessionInfo) => s.status === 'EXITED' || s.status === 'EXIT' || !s.active
      );

      if (toDelete.length === 0) return 0;

      // Delete exited sessions
      await this.page.evaluate(
        async ({ url, sessionIds }) => {
          const promises = sessionIds.map((id: string) =>
            fetch(`${url}/api/sessions/${id}`, { method: 'DELETE' }).catch(() => {
              // Ignore individual failures
            })
          );
          await Promise.all(promises);
        },
        { url: this.baseUrl, sessionIds: toDelete.map((s: SessionInfo) => s.id) }
      );

      return toDelete.length;
    } catch (error) {
      logger.error('Failed to cleanup exited sessions:', error);
      return 0;
    }
  }

  /**
   * Fast cleanup all sessions (for test teardown)
   */
  async cleanupAllSessions(): Promise<void> {
    try {
      // First try the UI Kill All button if available
      if (this.page.url().endsWith('/')) {
        const killAllButton = this.page.locator('button:has-text("Kill All")');
        if (await killAllButton.isVisible({ timeout: 500 })) {
          try {
            const [dialog] = await Promise.all([
              this.page.waitForEvent('dialog', { timeout: 1000 }),
              killAllButton.click(),
            ]);
            await dialog.accept();
          } catch {
            // Dialog didn't appear, continue with cleanup
            logger.debug('No dialog appeared for Kill All button');
          }

          // Wait briefly for sessions to exit
          await this.page.waitForTimeout(500);
          return;
        }
      }

      // Fallback to API cleanup
      const sessions = await this.page.evaluate(async (url) => {
        const response = await fetch(`${url}/api/sessions`);
        if (!response.ok) return [];
        return response.json();
      }, this.baseUrl);

      if (sessions.length > 0) {
        await this.page.evaluate(
          async ({ url, sessionIds }) => {
            const promises = sessionIds.map((id: string) =>
              fetch(`${url}/api/sessions/${id}`, { method: 'DELETE' }).catch(() => {
                // Ignore individual failures
              })
            );
            await Promise.all(promises);
          },
          { url: this.baseUrl, sessionIds: sessions.map((s: SessionInfo) => s.id) }
        );
      }
    } catch (error) {
      logger.error('Failed to cleanup all sessions:', error);
    }
  }

  /**
   * Get session count for verification
   */
  async getSessionCount(): Promise<number> {
    try {
      const sessions = await this.page.evaluate(async (url) => {
        const response = await fetch(`${url}/api/sessions`);
        if (!response.ok) return [];
        return response.json();
      }, this.baseUrl);
      return sessions.length;
    } catch {
      return 0;
    }
  }
}
