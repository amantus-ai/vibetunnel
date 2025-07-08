import { expect, test } from '../fixtures/test.fixture';
import { assertTerminalReady } from '../helpers/assertion.helper';
import { createAndNavigateToSession } from '../helpers/session-lifecycle.helper';
import { TestSessionManager } from '../helpers/test-data-manager.helper';

// These tests create their own sessions and can run in parallel
test.describe.configure({ mode: 'parallel' });

test.describe('Activity Monitoring', () => {
  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page, 'activity-test');
  });

  test.afterEach(async () => {
    // Cleanup sessions after test completes
    await sessionManager.cleanupAllSessions();
  });

  test('should show session activity status in session list', async ({ page }) => {
    // Navigate to session list first to see initial state
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Create a tracked session with a unique name
    const sessionName = sessionManager.generateSessionName('activity-status');
    const { sessionId } = await sessionManager.createTrackedSession(sessionName);
    
    // Make sure session was created
    expect(sessionId).toBeTruthy();

    // Wait for session to be fully established
    await page.waitForTimeout(1000);

    // Go back to home page to see session list
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Wait for session cards to appear
    await page.waitForSelector('session-card', { state: 'visible', timeout: 10000 });

    // Find our specific session card by looking for our unique session name
    const sessionCard = page.locator('session-card').filter({ hasText: sessionName });
    
    // Wait for our specific card to be visible
    await expect(sessionCard).toBeVisible({ timeout: 10000 });

    // Verify the session is running
    const sessionStatus = await sessionCard.getAttribute('data-session-status');
    expect(sessionStatus).toBe('running');

    // Look for the status dot which should be visible
    // VibeTunnel shows a colored dot for running sessions
    const statusDot = sessionCard.locator('.w-2.h-2.rounded-full.bg-status-success').first();
    await expect(statusDot).toBeVisible();
  });

  test('should update activity status when user interacts with terminal', async ({ page }) => {
    // Create session and navigate to it
    const sessionName = sessionManager.generateSessionName('activity-interaction');
    await createAndNavigateToSession(page, {
      name: sessionName,
    });
    await assertTerminalReady(page, 15000);

    // Interact with terminal to generate activity
    await page.keyboard.type('echo "Testing activity monitoring"');
    await page.keyboard.press('Enter');

    // Wait for command execution and terminal to process output
    await page.waitForFunction(
      () => {
        const term = document.querySelector('vibe-terminal');
        return term?.textContent?.includes('Testing activity monitoring');
      },
      { timeout: 5000 }
    );

    // Type some more to ensure activity
    await page.keyboard.type('ls -la');
    await page.keyboard.press('Enter');

    // Wait for ls command to complete
    await page.waitForTimeout(1000);

    // Go back to session list to check activity there
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible', timeout: 10000 });

    // Find our session card
    const sessionCard = page.locator('session-card').filter({ hasText: sessionName }).first();
    await expect(sessionCard).toBeVisible();

    // Check for the activity ring around the card (active sessions have a green ring)
    const cardClasses = await sessionCard.getAttribute('class');
    const hasActivityRing = cardClasses?.includes('ring-2') && cardClasses?.includes('ring-primary');
    
    // Also check if the status dot shows activity (pulsing animation)
    const statusDot = sessionCard.locator('.animate-pulse').first();
    const hasPulsingDot = await statusDot.isVisible().catch(() => false);

    // Either the card has an activity ring or a pulsing status dot
    expect(hasActivityRing || hasPulsingDot).toBeTruthy();
  });

  test('should show idle status after period of inactivity', async ({ page }) => {
    // Create session
    const sessionName = sessionManager.generateSessionName('activity-idle');
    await createAndNavigateToSession(page, {
      name: sessionName,
    });
    await assertTerminalReady(page, 15000);

    // Perform some initial activity
    await page.keyboard.type('echo "Initial activity"');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    // Wait for activity state to clear (activity timeout is 500ms in the implementation)
    await page.waitForTimeout(1000);

    // Go to session list to check idle status
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible', timeout: 10000 });

    const sessionCard = page.locator('session-card').filter({ hasText: sessionName }).first();
    await expect(sessionCard).toBeVisible();

    // Idle sessions should NOT have the activity ring or pulsing animation
    const cardClasses = await sessionCard.getAttribute('class');
    const hasActivityRing = cardClasses?.includes('ring-2') && cardClasses?.includes('ring-primary');
    
    // Should not have pulsing animation when idle
    const pulsingElements = sessionCard.locator('.animate-pulse');
    const hasPulsingAnimation = (await pulsingElements.count()) > 0;

    // For idle sessions, we expect no activity indicators
    expect(hasActivityRing).toBeFalsy();
    expect(hasPulsingAnimation).toBeFalsy();

    // But the session should still show as running with a green dot
    const statusDot = sessionCard.locator('.w-2.h-2.rounded-full.bg-status-success').first();
    await expect(statusDot).toBeVisible();
  });

  test('should track activity across multiple sessions', async ({ page }) => {
    test.setTimeout(30000); // Increase timeout for this test
    // Create multiple sessions
    const session1Name = sessionManager.generateSessionName('multi-activity-1');
    const session2Name = sessionManager.generateSessionName('multi-activity-2');

    // Create first session
    await createAndNavigateToSession(page, { name: session1Name });
    await assertTerminalReady(page, 15000);

    // Activity in first session
    await page.keyboard.type('echo "Session 1 activity"');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Create second session
    await createAndNavigateToSession(page, { name: session2Name });
    await assertTerminalReady(page, 15000);

    // Activity in second session - this should be the most recent
    await page.keyboard.type('echo "Session 2 activity"');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Go to session list
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible', timeout: 10000 });

    // Both sessions should be visible
    const session1Card = page.locator('session-card').filter({ hasText: session1Name }).first();
    const session2Card = page.locator('session-card').filter({ hasText: session2Name }).first();

    await expect(session1Card).toBeVisible();
    await expect(session2Card).toBeVisible();

    // The second session (most recent activity) should show activity indicators
    const session2Classes = await session2Card.getAttribute('class');
    const session2HasActivityRing = session2Classes?.includes('ring-2') && session2Classes?.includes('ring-primary');
    
    // Check for pulsing animation on session 2
    const session2PulsingDot = session2Card.locator('.animate-pulse').first();
    const session2HasPulsing = await session2PulsingDot.isVisible().catch(() => false);

    // Session 2 should show recent activity
    expect(session2HasActivityRing || session2HasPulsing).toBeTruthy();

    // Both sessions should have running status dots
    const session1Dot = session1Card.locator('.w-2.h-2.rounded-full.bg-status-success').first();
    const session2Dot = session2Card.locator('.w-2.h-2.rounded-full.bg-status-success').first();
    
    await expect(session1Dot).toBeVisible();
    await expect(session2Dot).toBeVisible();
  });

  test('should handle activity monitoring for long-running commands', async ({ page }) => {
    const sessionName = sessionManager.generateSessionName('long-running-activity');
    await createAndNavigateToSession(page, {
      name: sessionName,
    });
    await assertTerminalReady(page, 15000);

    // Start a long-running command (sleep)
    await page.keyboard.type('sleep 3 && echo "Long command completed"');
    await page.keyboard.press('Enter');

    // Wait a moment for command to start
    await page.waitForTimeout(1000);

    // Go to session list to check status while command is running
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible', timeout: 10000 });

    const sessionCard = page.locator('session-card').filter({ hasText: sessionName }).first();
    await expect(sessionCard).toBeVisible();

    // During a long-running command, the session should show as active
    // Check for activity ring or pulsing animation
    const cardClasses = await sessionCard.getAttribute('class');
    const hasActivityRing = cardClasses?.includes('ring-2') && cardClasses?.includes('ring-primary');
    
    // Check for pulsing status dot
    const pulsingDot = sessionCard.locator('.animate-pulse').first();
    const hasPulsing = await pulsingDot.isVisible().catch(() => false);

    // Should show activity during command execution
    expect(hasActivityRing || hasPulsing).toBeTruthy();

    // The session should still be running
    const statusDot = sessionCard.locator('.w-2.h-2.rounded-full.bg-status-success').first();
    await expect(statusDot).toBeVisible();
  });

  test('should show last activity time for inactive sessions', async ({ page }) => {
    // Skip this test as VibeTunnel doesn't display activity timestamps
    test.skip();
    
    // The current implementation doesn't show relative time displays
    // Activity is shown through visual indicators only (colors, animations)
  });

  test('should handle activity monitoring when switching between sessions', async ({ page }) => {
    // Create two sessions
    const session1Name = sessionManager.generateSessionName('switch-activity-1');
    const session2Name = sessionManager.generateSessionName('switch-activity-2');

    // Create and use first session
    const { sessionId: session1Id } = await createAndNavigateToSession(page, { name: session1Name });
    await assertTerminalReady(page, 15000);
    await page.keyboard.type('echo "First session"');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Create and switch to second session
    const { sessionId: session2Id } = await createAndNavigateToSession(page, { name: session2Name });
    await assertTerminalReady(page, 15000);
    await page.keyboard.type('echo "Second session"');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Switch back to first session via URL
    await page.goto(`/?session=${session1Id}`);
    await assertTerminalReady(page, 15000);

    // Activity in first session again
    await page.keyboard.type('echo "Back to first"');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Check session list for activity tracking
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible', timeout: 10000 });

    // Both sessions should be visible
    const session1Card = page.locator('session-card').filter({ hasText: session1Name }).first();
    const session2Card = page.locator('session-card').filter({ hasText: session2Name }).first();

    await expect(session1Card).toBeVisible();
    await expect(session2Card).toBeVisible();

    // First session should show more recent activity
    const session1Classes = await session1Card.getAttribute('class');
    const session1HasActivityRing = session1Classes?.includes('ring-2') && session1Classes?.includes('ring-primary');
    
    // Check for pulsing animation on session 1
    const session1PulsingDot = session1Card.locator('.animate-pulse').first();
    const session1HasPulsing = await session1PulsingDot.isVisible().catch(() => false);

    // Session 1 should show recent activity since we just typed in it
    expect(session1HasActivityRing || session1HasPulsing).toBeTruthy();

    // Both sessions should still be running
    const session1Dot = session1Card.locator('.w-2.h-2.rounded-full.bg-status-success').first();
    const session2Dot = session2Card.locator('.w-2.h-2.rounded-full.bg-status-success').first();
    
    await expect(session1Dot).toBeVisible();
    await expect(session2Dot).toBeVisible();
  });

  test('should handle activity monitoring with WebSocket reconnection', async ({ page }) => {
    const sessionName = sessionManager.generateSessionName('websocket-activity');
    await createAndNavigateToSession(page, {
      name: sessionName,
    });
    await assertTerminalReady(page, 15000);

    // Perform initial activity
    await page.keyboard.type('echo "Before disconnect"');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    // Simulate WebSocket disconnection by evaluating in page context
    await page.evaluate(() => {
      // Find and close WebSocket connections
      const ws = (window as any).ws || (window as any).socket;
      if (ws && ws.close) {
        ws.close();
      }
    });

    // Wait for reconnection
    await page.waitForTimeout(2000);

    // Perform activity after reconnection
    await page.keyboard.type('echo "After reconnect"');
    await page.keyboard.press('Enter');
    
    // Wait for command to process
    await page.waitForFunction(
      () => {
        const term = document.querySelector('vibe-terminal');
        return term?.textContent?.includes('After reconnect');
      },
      { timeout: 5000 }
    );

    // Activity monitoring should still work
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible', timeout: 10000 });

    const sessionCard = page.locator('session-card').filter({ hasText: sessionName }).first();
    await expect(sessionCard).toBeVisible();

    // Check for activity indicators after reconnection
    const cardClasses = await sessionCard.getAttribute('class');
    const hasActivityRing = cardClasses?.includes('ring-2') && cardClasses?.includes('ring-primary');
    
    // Check for pulsing animation
    const pulsingDot = sessionCard.locator('.animate-pulse').first();
    const hasPulsing = await pulsingDot.isVisible().catch(() => false);

    // Should show activity after reconnection
    expect(hasActivityRing || hasPulsing).toBeTruthy();

    // Session should still be running
    const statusDot = sessionCard.locator('.w-2.h-2.rounded-full.bg-status-success').first();
    await expect(statusDot).toBeVisible();
  });

  test('should aggregate activity data correctly', async ({ page }) => {
    const sessionName = sessionManager.generateSessionName('activity-aggregation');
    await createAndNavigateToSession(page, {
      name: sessionName,
    });
    await assertTerminalReady(page, 15000);

    // Perform multiple activities in rapid sequence
    const activities = ['echo "Activity 1"', 'echo "Activity 2"', 'echo "Activity 3"', 'pwd', 'date'];

    for (const activity of activities) {
      await page.keyboard.type(activity);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200); // Small delay between commands
    }

    // The session should remain active throughout
    // Go to session list while still active
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible', timeout: 10000 });

    const sessionCard = page.locator('session-card').filter({ hasText: sessionName }).first();
    await expect(sessionCard).toBeVisible();

    // Should show aggregated activity from all the commands
    const cardClasses = await sessionCard.getAttribute('class');
    const hasActivityRing = cardClasses?.includes('ring-2') && cardClasses?.includes('ring-primary');
    
    // Check for pulsing animation
    const pulsingDot = sessionCard.locator('.animate-pulse').first();
    const hasPulsing = await pulsingDot.isVisible().catch(() => false);

    // Should show activity from the rapid sequence of commands
    expect(hasActivityRing || hasPulsing).toBeTruthy();

    // Session should be running
    const statusDot = sessionCard.locator('.w-2.h-2.rounded-full.bg-status-success').first();
    await expect(statusDot).toBeVisible();
  });
});
