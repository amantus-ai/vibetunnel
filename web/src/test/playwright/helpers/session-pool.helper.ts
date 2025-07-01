import type { Page } from '@playwright/test';
import { POOL_CONFIG } from '../config/test-constants';
import { SessionListPage } from '../pages/session-list.page';

export interface PooledSession {
  name: string;
  id: string;
  inUse: boolean;
  createdAt: number;
}

/**
 * Session pool for pre-creating and reusing sessions
 * This dramatically speeds up tests by avoiding session creation overhead
 */
export class SessionPool {
  private sessions: PooledSession[] = [];
  private page: Page;
  private sessionListPage: SessionListPage;
  private initPromise: Promise<void> | null = null;

  constructor(page: Page) {
    this.page = page;
    this.sessionListPage = new SessionListPage(page);
  }

  /**
   * Initialize the pool with pre-created sessions
   */
  async initialize(size: number = POOL_CONFIG.DEFAULT_SIZE): Promise<void> {
    // Avoid duplicate initialization
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this._doInitialize(size);
    return this.initPromise;
  }

  private async _doInitialize(size: number): Promise<void> {
    console.log(`Initializing session pool with ${size} sessions...`);
    const startTime = Date.now();

    // Navigate to session list
    await this.sessionListPage.navigate();

    // Create sessions in parallel batches for speed
    const batchSize = 3;
    for (let i = 0; i < size; i += batchSize) {
      const batch = [];
      for (let j = 0; j < batchSize && i + j < size; j++) {
        const sessionName = `pool-session-${Date.now()}-${i + j}`;
        batch.push(this.createPoolSession(sessionName));
      }

      // Wait for batch to complete
      const createdSessions = await Promise.all(batch);
      this.sessions.push(...(createdSessions.filter((s) => s !== null) as PooledSession[]));

      // Small delay between batches to avoid overwhelming the system
      if (i + batchSize < size) {
        await this.page.waitForTimeout(500);
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`Session pool initialized with ${this.sessions.length} sessions in ${elapsed}ms`);
  }

  private async createPoolSession(sessionName: string): Promise<PooledSession | null> {
    try {
      // Click create button
      await this.page.click('button[title="Create New Session"]', { timeout: 3000 });

      // Wait for dialog
      await this.page.waitForSelector('input[placeholder="My Session"]', {
        state: 'visible',
        timeout: 2000,
      });

      // Disable spawn window for pool sessions
      const spawnWindowToggle = this.page.locator('button[role="switch"]');
      if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
        await spawnWindowToggle.click();
      }

      // Fill session details
      await this.page.fill('input[placeholder="My Session"]', sessionName);
      await this.page.fill('input[placeholder="zsh"]', POOL_CONFIG.DEFAULT_COMMAND);

      // Create session
      await this.page.locator('button').filter({ hasText: 'Create' }).first().click();

      // Wait for navigation
      await this.page.waitForURL(/\?session=/, { timeout: 3000 });

      // Extract session ID
      const url = this.page.url();
      const sessionId = new URL(url).searchParams.get('session') || '';

      // Navigate back to list immediately
      await this.page.goto('/', { waitUntil: 'domcontentloaded' });

      return {
        name: sessionName,
        id: sessionId,
        inUse: false,
        createdAt: Date.now(),
      };
    } catch (error) {
      console.error(`Failed to create pool session ${sessionName}:`, error);
      return null;
    }
  }

  /**
   * Acquire a session from the pool
   */
  async acquire(): Promise<PooledSession> {
    // Initialize pool if not already done
    if (this.sessions.length === 0) {
      await this.initialize();
    }

    // Find available session
    const available = this.sessions.find((s) => !s.inUse);
    if (!available) {
      // Create new session if pool is exhausted
      console.log('Session pool exhausted, creating new session...');
      const newSession = await this.createPoolSession(`pool-overflow-${Date.now()}`);
      if (!newSession) {
        throw new Error('Failed to create overflow session');
      }
      this.sessions.push(newSession);
      newSession.inUse = true;
      return newSession;
    }

    available.inUse = true;
    return available;
  }

  /**
   * Release a session back to the pool
   */
  async release(session: PooledSession): Promise<void> {
    const poolSession = this.sessions.find((s) => s.id === session.id);
    if (poolSession) {
      poolSession.inUse = false;

      // Optional: Clear session state
      if (this.page.url().includes(`session=${session.id}`)) {
        // Send clear command to reset terminal
        await this.page.keyboard.press('Control+l');
        await this.page.waitForTimeout(POOL_CONFIG.CLEAR_DELAY_MS);
      }
    }
  }

  /**
   * Clean up all pool sessions
   */
  async cleanup(): Promise<void> {
    if (this.sessions.length === 0) return;

    console.log(`Cleaning up ${this.sessions.length} pool sessions...`);

    // Navigate to list
    await this.page.goto('/', { waitUntil: 'domcontentloaded' });

    // Kill all pool sessions
    for (const session of this.sessions) {
      try {
        const sessionCard = this.page.locator(`session-card:has-text("${session.name}")`).first();
        if (await sessionCard.isVisible({ timeout: 1000 })) {
          await sessionCard.hover();
          const killButton = sessionCard.locator('button[title*="Kill session"]');
          if (await killButton.isVisible({ timeout: 500 })) {
            await killButton.click();
            await this.page.waitForTimeout(200); // Small delay between kills
          }
        }
      } catch (error) {
        console.error(`Failed to kill pool session ${session.name}:`, error);
      }
    }

    this.sessions = [];
    this.initPromise = null;
  }

  /**
   * Get pool statistics
   */
  getStats(): { total: number; available: number; inUse: number } {
    const available = this.sessions.filter((s) => !s.inUse).length;
    const inUse = this.sessions.filter((s) => s.inUse).length;

    return {
      total: this.sessions.length,
      available,
      inUse,
    };
  }
}
