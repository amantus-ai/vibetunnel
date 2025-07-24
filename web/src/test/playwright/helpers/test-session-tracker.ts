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
   * Only clean up sessions that:
   * 1. Were explicitly tracked by tests, OR
   * 2. Match our test naming pattern (as a safety fallback)
   */
  shouldCleanupSession(sessionId: string, sessionName?: string): boolean {
    // Always clean up explicitly tracked sessions
    if (this.createdSessions.has(sessionId)) {
      return true;
    }

    // As a fallback, clean up sessions with test naming pattern
    // This helps clean up orphaned test sessions from previous runs
    if (sessionName && this.sessionNamePattern.test(sessionName)) {
      console.log(
        `[TestSessionTracker] Session "${sessionName}" matches test pattern, will clean up`
      );
      return true;
    }

    return false;
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
