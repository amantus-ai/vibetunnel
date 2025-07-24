import type { Page } from '@playwright/test';
import { CLEANUP_CONFIG } from '../config/test-constants';
import type { SessionInfo } from '../types/session.types';
import { logger } from '../utils/logger';
import { extractBaseUrl } from '../utils/url.utils';
import { TestSessionTracker } from './test-session-tracker';

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
      const toDelete = sessions.filter((s: SessionInfo) => s.status === 'exited' || !s.active);

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
   * DEPRECATED: This method is dangerous as it kills ALL sessions including the one Claude Code is running in!
   * Use cleanupTestSessions() instead.
   * @deprecated
   */
  async cleanupAllSessions(): Promise<void> {
    console.warn(
      '[SessionCleanupHelper] WARNING: cleanupAllSessions() is deprecated and dangerous!'
    );
    console.warn(
      '[SessionCleanupHelper] It will kill ALL sessions including active development sessions.'
    );
    console.warn('[SessionCleanupHelper] Use cleanupTestSessions() instead.');
    // Return without doing anything to prevent accidents
    return;
  }

  /**
   * Safe cleanup - only removes sessions created by tests
   * NEVER uses Kill All button to avoid killing the VibeTunnel session running Claude Code
   */
  async cleanupTestSessions(): Promise<void> {
    try {
      const tracker = TestSessionTracker.getInstance();

      // Get all sessions via API
      const sessions = await this.page.evaluate(async (url) => {
        const response = await fetch(`${url}/api/sessions`);
        if (!response.ok) return [];
        return response.json();
      }, this.baseUrl);

      // Filter to only test sessions
      const testSessions = sessions.filter((s: SessionInfo) =>
        tracker.shouldCleanupSession(s.id, s.name)
      );

      if (testSessions.length === 0) {
        logger.debug('No test sessions to clean up');
        return;
      }

      logger.info(`Cleaning up ${testSessions.length} test sessions`);

      await this.page.evaluate(
        async ({ url, sessionIds }) => {
          const promises = sessionIds.map((id: string) =>
            fetch(`${url}/api/sessions/${id}`, { method: 'DELETE' }).catch(() => {
              // Ignore individual failures
            })
          );
          await Promise.all(promises);
        },
        { url: this.baseUrl, sessionIds: testSessions.map((s: SessionInfo) => s.id) }
      );
    } catch (error) {
      logger.error('Failed to cleanup test sessions:', error);
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
