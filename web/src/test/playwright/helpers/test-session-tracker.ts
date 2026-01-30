/**
 * Tracks sessions created during tests to ensure we only clean up what we create
 * This prevents accidentally killing the VibeTunnel session that Claude Code is running in
 */
export class TestSessionTracker {
  private static instance: TestSessionTracker;
  private createdSessions = new Set<string>();
  private sessionNamePattern = /^test-/i;

  private constructor() {}

  static getInstance(): TestSessionTracker {
    if (!TestSessionTracker.instance) {
      TestSessionTracker.instance = new TestSessionTracker();
    }
    return TestSessionTracker.instance;
  }

  /**
   * Track a session that was created by a test
   */
  trackSession(sessionId: string): void {
    this.createdSessions.add(sessionId);
    console.log(`[TestSessionTracker] Tracking session: ${sessionId}`);
  }

  /**
   * Untrack a session (if it was manually cleaned up)
   */
  untrackSession(sessionId: string): void {
    this.createdSessions.delete(sessionId);
  }

  /**
   * Get all tracked session IDs
   */
  getTrackedSessions(): string[] {
    return Array.from(this.createdSessions);
  }

  /**
   * Check if a session should be cleaned up
   * Only clean up sessions that were explicitly tracked by tests.
   */
  shouldCleanupSession(sessionId: string, sessionName?: string): boolean {
    void sessionName;
    return this.createdSessions.has(sessionId);
  }

  /**
   * Clear all tracked sessions (for test suite cleanup)
   */
  clear(): void {
    this.createdSessions.clear();
  }

  /**
   * Get the test session naming pattern
   */
  getTestPattern(): RegExp {
    return this.sessionNamePattern;
  }
}
