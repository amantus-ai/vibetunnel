import { expect, test } from '../fixtures/test.fixture';
import { TestSessionManager } from '../helpers/test-data-manager.helper';
import { TestDataFactory } from '../utils/test-utils';

// Use a unique prefix for this test suite
const TEST_PREFIX = TestDataFactory.getTestSpecificPrefix('debug-session');

// These tests create their own sessions and can run in parallel
test.describe.configure({ mode: 'parallel' });

test.describe('Debug Session Tests', () => {
  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page, TEST_PREFIX);
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });
  test('debug session creation and listing', async ({ page }) => {
    // Simple test that creates a session and verifies it exists
    const { sessionName } = await sessionManager.createTrackedSession('debug');

    // Navigate back to list
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check if session exists in the API
    const sessions = await page.evaluate(async () => {
      const response = await fetch('/api/sessions');
      return response.json();
    });

    const sessionExists = sessions.some((s: { name: string }) => s.name === sessionName);
    expect(sessionExists).toBe(true);

    // Log some debug info
    console.log(`Created session: ${sessionName}`);
    console.log(`Total sessions: ${sessions.length}`);
    console.log(
      `Session statuses: ${sessions.map((s: { status: string }) => s.status).join(', ')}`
    );
  });
});
