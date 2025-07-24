import type { PtyManager } from '../../server/pty/pty-manager.js';

/**
 * Helper class for managing sessions in tests.
 *
 * CRITICAL: This helper ensures tests only kill sessions they create!
 * Never use sessionManager.listSessions() to kill all sessions
 * as this would kill sessions from other VibeTunnel instances.
 */
export class SessionTestHelper {
  private createdSessionIds = new Set<string>();

  constructor(private ptyManager: PtyManager) {}

  /**
   * Track a session ID that was created by this test
   */
  trackSession(sessionId: string): void {
    this.createdSessionIds.add(sessionId);
  }

  /**
   * Create a session and automatically track it
   */
  async createTrackedSession(
    command: string[],
    options: Parameters<typeof PtyManager.prototype.createSession>[1]
  ) {
    const result = await this.ptyManager.createSession(command, options);
    this.trackSession(result.sessionId);
    return result;
  }

  /**
   * Kill all sessions created by this test
   */
  async killTrackedSessions(): Promise<void> {
    for (const sessionId of this.createdSessionIds) {
      try {
        await this.ptyManager.killSession(sessionId);
      } catch (_error) {
        // Session might already be dead or not exist
      }
    }
    this.createdSessionIds.clear();
  }

  /**
   * Get the number of tracked sessions
   */
  getTrackedCount(): number {
    return this.createdSessionIds.size;
  }

  /**
   * Check if a session is tracked
   */
  isTracked(sessionId: string): boolean {
    return this.createdSessionIds.has(sessionId);
  }

  /**
   * Clear tracked sessions without killing them
   * (useful when sessions are killed by other means)
   */
  clearTracked(): void {
    this.createdSessionIds.clear();
  }
}
