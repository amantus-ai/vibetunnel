import type { Page } from '@playwright/test';
import { POOL_CONFIG } from '../config/test-constants';
import type { SessionInfo } from '../types/session.types';
import { logger } from '../utils/logger';
import { extractBaseUrl } from '../utils/url.utils';
import { validateCommand, validateSessionName } from '../utils/validation.utils';
import { BatchOperations } from './batch-operations.helper';

interface SessionPoolInfo {
  id: string;
  name: string;
  created: number;
  command: string;
  status: string;
}

/**
 * Session pool for reusing sessions across tests
 * Reduces session creation overhead in sequential tests
 */
export class SessionPool {
  private page: Page;
  private baseUrl: string;
  private availableSessions: Map<string, SessionPoolInfo> = new Map();
  private usedSessions: Set<string> = new Set();
  private sessionPrefix: string;

  constructor(page: Page, prefix = 'pool') {
    this.page = page;
    this.baseUrl = extractBaseUrl(page.url());
    this.sessionPrefix = prefix;
  }

  /**
   * Update the page reference (useful for global pools)
   */
  updatePage(page: Page): void {
    this.page = page;
    this.baseUrl = extractBaseUrl(page.url());
  }

  /**
   * Pre-create a pool of sessions for test use
   */
  async initialize(
    poolSize = POOL_CONFIG.DEFAULT_SIZE,
    command = POOL_CONFIG.DEFAULT_COMMAND
  ): Promise<void> {
    logger.info(`Initializing session pool with ${poolSize} sessions`);

    const batchOps = new BatchOperations(this.page);
    const sessionRequests = Array(poolSize)
      .fill(0)
      .map((_, i) => ({
        name: `${this.sessionPrefix}-${Date.now()}-${i}`,
        command,
      }));

    const results = await batchOps.createSessions(sessionRequests);

    results.forEach((result) => {
      if (result.success) {
        this.availableSessions.set(result.id, {
          id: result.id,
          name: result.name,
          created: Date.now(),
          command,
          status: 'available',
        });
      } else {
        logger.error(`Failed to create pool session ${result.name}:`, result.error);
      }
    });

    logger.info(`Session pool initialized with ${this.availableSessions.size} sessions`);
  }

  /**
   * Get a session from the pool
   */
  async acquire(preferredCommand = POOL_CONFIG.DEFAULT_COMMAND): Promise<SessionPoolInfo | null> {
    // Find an available session with matching command
    for (const [id, session] of this.availableSessions) {
      if (session.command === preferredCommand && !this.usedSessions.has(id)) {
        this.usedSessions.add(id);
        session.status = 'in-use';

        // Verify session is still active
        const isActive = await this.verifySession(id);
        if (isActive) {
          return session;
        } else {
          // Remove dead session
          this.availableSessions.delete(id);
          this.usedSessions.delete(id);
        }
      }
    }

    // No available session, create a new one
    const name = `${this.sessionPrefix}-${Date.now()}-new`;
    try {
      const session = await this.createSession(name, preferredCommand);
      const sessionInfo = {
        ...session,
        created: Date.now(),
        command: preferredCommand,
        status: 'in-use',
      };
      this.availableSessions.set(session.id, sessionInfo);
      this.usedSessions.add(session.id);
      return sessionInfo;
    } catch (error) {
      logger.error('Failed to create new pool session:', error);
      return null;
    }
  }

  /**
   * Return a session to the pool
   */
  async release(sessionId: string): Promise<void> {
    if (this.availableSessions.has(sessionId)) {
      this.usedSessions.delete(sessionId);
      const session = this.availableSessions.get(sessionId);
      if (session) {
        session.status = 'available';
      }

      // Clear terminal output for reuse
      await this.clearSession(sessionId);
    }
  }

  /**
   * Clean up all pool sessions
   */
  async cleanup(): Promise<void> {
    const sessionIds = Array.from(this.availableSessions.keys());

    if (sessionIds.length > 0) {
      await this.page.evaluate(
        async ({ url, ids }) => {
          const promises = ids.map((id) =>
            fetch(`${url}/api/sessions/${id}`, { method: 'DELETE' }).catch(() => {
              // Ignore individual failures
            })
          );
          await Promise.all(promises);
        },
        { url: this.baseUrl, ids: sessionIds }
      );
    }

    this.availableSessions.clear();
    this.usedSessions.clear();
  }

  /**
   * Get pool statistics
   */
  getStats(): { total: number; available: number; used: number } {
    const available = Array.from(this.availableSessions.values()).filter(
      (s) => !this.usedSessions.has(s.id)
    ).length;

    return {
      total: this.availableSessions.size,
      available,
      used: this.usedSessions.size,
    };
  }

  private async createSession(name: string, command: string): Promise<SessionInfo> {
    // Validate inputs
    validateSessionName(name);
    validateCommand(command);

    return this.page.evaluate(
      async ({ url, name, command }) => {
        const response = await fetch(`${url}/api/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, command }),
        });
        if (!response.ok) {
          throw new Error(`Failed to create session: ${response.statusText}`);
        }
        return response.json();
      },
      { url: this.baseUrl, name, command }
    );
  }

  private async verifySession(sessionId: string): Promise<boolean> {
    try {
      const sessions: SessionInfo[] = await this.page.evaluate(
        async ({ url, id }) => {
          const response = await fetch(`${url}/api/sessions`);
          if (!response.ok) return [];
          const data = await response.json();
          return data.filter((s: SessionInfo) => s.id === id);
        },
        { url: this.baseUrl, id: sessionId }
      );

      // Treat sessions as inactive if active is explicitly false or undefined/missing
      // This aligns with session-cleanup.helper.ts which treats !s.active as inactive
      return sessions.length > 0 && sessions[0].active === true;
    } catch {
      return false;
    }
  }

  private async clearSession(sessionId: string): Promise<void> {
    try {
      // Send clear command to terminal
      await this.page.evaluate(
        async ({ url, id }) => {
          await fetch(`${url}/api/sessions/${id}/input`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: 'clear\r' }),
          });
        },
        { url: this.baseUrl, id: sessionId }
      );

      // Brief wait for clear to execute
      await this.page.waitForTimeout(POOL_CONFIG.CLEAR_DELAY_MS);
    } catch {
      // Ignore clear failures - session may already be gone
    }
  }
}

// Global session pool instance for test suite
let globalPool: SessionPool | null = null;
let globalPoolPage: Page | null = null;

export function getGlobalSessionPool(page: Page): SessionPool {
  if (!globalPool) {
    globalPool = new SessionPool(page, 'global-pool');
    globalPoolPage = page;
  } else if (globalPoolPage !== page) {
    // Update the page reference instead of recreating the pool
    logger.debug('Updating global pool page reference');
    globalPool.updatePage(page);
    globalPoolPage = page;
  }
  return globalPool;
}

export async function cleanupGlobalPool(): Promise<void> {
  if (globalPool) {
    await globalPool.cleanup();
    globalPool = null;
    globalPoolPage = null;
  }
}
