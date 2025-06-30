import { expect, test, testGroups } from '../fixtures/sequential-test.fixture';

/**
 * Example of optimized session management tests
 * Using sequential execution with performance optimizations
 */

testGroups.critical('Optimized Session Management', () => {
  test('should efficiently create and manage sessions', async ({
    page,
    batchOps,
    waitUtils,
    cleanupHelper,
  }) => {
    // Navigate to home
    await page.goto('/');
    await waitUtils.waitForAppReady(page);

    // Create multiple sessions efficiently
    const sessions = await batchOps.createSessions([
      { name: 'test-session-1' },
      { name: 'test-session-2' },
      { name: 'test-session-3' },
    ]);

    // Verify all created successfully
    expect(sessions.filter((s) => s.success)).toHaveLength(3);

    // Quick visibility check
    for (const session of sessions) {
      if (session.success) {
        await waitUtils.waitForSessionCard(page, session.name, 2000);
      }
    }

    // Test will auto-cleanup via fixture
  });

  test('should reuse sessions from pool', async ({ page, sessionPool, waitUtils }) => {
    // Get a session from the pool
    const session1 = await sessionPool.acquire();
    expect(session1).toBeTruthy();

    // Navigate to the session
    if (!session1) throw new Error('Failed to acquire session from pool');
    await page.goto(`/sessions/${session1.id}`);
    await waitUtils.waitForTerminalReady(page);

    // Return session to pool
    await sessionPool.release(session1.id);

    // Get another session (might be the same one)
    const session2 = await sessionPool.acquire();
    expect(session2).toBeTruthy();

    // Check pool stats
    const stats = sessionPool.getStats();
    console.log(`Pool stats: ${JSON.stringify(stats)}`);
  });
});

testGroups.light('Fast Session Operations', () => {
  test('should handle session state changes efficiently', async ({ page, batchOps, waitUtils }) => {
    await page.goto('/');
    await waitUtils.waitForAppReady(page);

    // Create a session that will exit quickly
    const [session] = await batchOps.createSessions([{ name: 'exit-test', command: 'exit 0' }]);

    expect(session.success).toBe(true);

    // Wait for session to exit
    const exited = await waitUtils.waitForSessionState(page, session.name, 'EXITED', 3000);
    expect(exited).toBe(true);

    // Verify in API
    const exitedSessions = await batchOps.getSessionsByStatus('EXITED');
    expect(exitedSessions.some((s) => s.name === session.name)).toBe(true);
  });

  test('should batch delete sessions', async ({ page, batchOps, cleanupHelper }) => {
    // Create test sessions
    const sessions = await batchOps.createSessions([
      { name: 'batch-delete-1' },
      { name: 'batch-delete-2' },
      { name: 'batch-delete-3' },
    ]);

    const ids = sessions.filter((s) => s.success).map((s) => s.id);
    expect(ids).toHaveLength(3);

    // Batch delete
    const result = await batchOps.deleteSessions(ids);
    expect(result.deleted).toBe(3);
    expect(result.failed).toBe(0);

    // Verify cleanup
    const _remaining = await cleanupHelper.getSessionCount();
    const allSessions = await batchOps.getSessionsByStatus('all');
    const testSessions = allSessions.filter((s) => s.name.startsWith('batch-delete'));
    expect(testSessions).toHaveLength(0);
  });
});

testGroups.heavy('Stress Test with Optimizations', () => {
  test('should handle many sessions efficiently', async ({
    page,
    batchOps,
    cleanupHelper,
    waitUtils,
  }) => {
    await page.goto('/');
    await waitUtils.waitForAppReady(page);

    // Create 10 sessions in batch
    const sessionData = Array(10)
      .fill(0)
      .map((_, i) => ({
        name: `stress-test-${i}`,
        command: 'echo "Ready"',
      }));

    console.time('Create 10 sessions');
    const sessions = await batchOps.createSessions(sessionData);
    console.timeEnd('Create 10 sessions');

    const successful = sessions.filter((s) => s.success);
    expect(successful.length).toBeGreaterThanOrEqual(8); // Allow some failures

    // Wait for network quiet
    await waitUtils.waitForNetworkQuiet(page);

    // Check element count
    await waitUtils.waitForElementCount(page, 'session-card', successful.length, {
      operator: 'minimum',
      timeout: 5000,
    });

    // Batch cleanup
    console.time('Cleanup sessions');
    const cleaned = await cleanupHelper.cleanupByPattern(/^stress-test-/);
    console.timeEnd('Cleanup sessions');

    expect(cleaned).toBeGreaterThanOrEqual(successful.length);
  });
});
