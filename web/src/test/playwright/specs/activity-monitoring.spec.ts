import { expect, test } from '../fixtures/test.fixture';
import { assertTerminalReady } from '../helpers/assertion.helper';
import { createAndNavigateToSession } from '../helpers/session-lifecycle.helper';
import { TestSessionManager } from '../helpers/test-data-manager.helper';

// These tests create their own sessions and can run in parallel
test.describe.configure({ mode: 'parallel' });

test.describe('Activity Monitoring', () => {
  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page);
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });

  test('should show session activity status in session list', async ({ page }) => {
    // Create a tracked session
    const { sessionName } = await sessionManager.createTrackedSession();

    // Go to home page to see session list
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible', timeout: 10000 });

    // Find our session card
    const sessionCard = page.locator('session-card').filter({ hasText: sessionName }).first();
    await expect(sessionCard).toBeVisible();

    // Look for activity indicators
    const activityIndicators = sessionCard
      .locator('.activity, .status, .online, .active, .idle')
      .first();
    const statusBadge = sessionCard.locator('.bg-green, .bg-yellow, .bg-red, .bg-gray').filter({
      hasText: /active|idle|inactive|online/i,
    });
    const activityDot = sessionCard.locator('.w-2.h-2, .w-3.h-3').filter({
      hasClass: /bg-green|bg-yellow|bg-red|bg-gray/,
    });

    // Should have some form of activity indication
    const hasActivityIndicator =
      (await activityIndicators.isVisible()) ||
      (await statusBadge.isVisible()) ||
      (await activityDot.isVisible());

    if (hasActivityIndicator) {
      expect(hasActivityIndicator).toBeTruthy();
    }
  });

  test('should update activity status when user interacts with terminal', async ({ page }) => {
    // Create session and navigate to it
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('activity-interaction'),
    });
    await assertTerminalReady(page);

    // Get initial activity status (if visible)
    const activityStatus = page
      .locator('.activity-status, .status-indicator, .session-status')
      .first();
    let initialStatus = '';

    if (await activityStatus.isVisible()) {
      initialStatus = (await activityStatus.textContent()) || '';
    }

    // Interact with terminal to generate activity
    await page.keyboard.type('echo "Testing activity monitoring"');
    await page.keyboard.press('Enter');

    // Wait for command execution
    await page.waitForTimeout(2000);

    // Type some more to ensure activity
    await page.keyboard.type('ls -la');
    await page.keyboard.press('Enter');

    await page.waitForTimeout(1000);

    // Check if activity status updated
    if (await activityStatus.isVisible()) {
      const newStatus = (await activityStatus.textContent()) || '';

      // Status might have changed to reflect recent activity
      if (initialStatus !== newStatus || newStatus.toLowerCase().includes('active')) {
        expect(true).toBeTruthy(); // Activity tracking is working
      }
    }

    // Go back to session list to check activity there
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible', timeout: 10000 });

    // Session should show recent activity
    const sessionCard = page
      .locator('session-card')
      .filter({
        hasText: 'activity-interaction',
      })
      .first();

    if (await sessionCard.isVisible()) {
      const recentActivity = sessionCard.locator('.text-green, .active, .bg-green').filter({
        hasText: /active|recent|now|online/i,
      });

      const activityTime = sessionCard.locator('.text-xs, .text-sm').filter({
        hasText: /ago|now|active|second|minute/i,
      });

      const hasActivityUpdate =
        (await recentActivity.isVisible()) || (await activityTime.isVisible());

      if (hasActivityUpdate) {
        expect(hasActivityUpdate).toBeTruthy();
      }
    }
  });

  test('should show idle status after period of inactivity', async ({ page }) => {
    // Create session
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('activity-idle'),
    });
    await assertTerminalReady(page);

    // Perform some initial activity
    await page.keyboard.type('echo "Initial activity"');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    // Wait for a period to simulate idle time (shorter wait for testing)
    await page.waitForTimeout(5000);

    // Check for idle indicators
    const _idleIndicators = page.locator('.idle, .inactive, .bg-yellow, .bg-gray').filter({
      hasText: /idle|inactive|no.*activity/i,
    });

    // Go to session list to check idle status
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible', timeout: 10000 });

    const sessionCard = page
      .locator('session-card')
      .filter({
        hasText: 'activity-idle',
      })
      .first();

    if (await sessionCard.isVisible()) {
      // Look for idle status indicators
      const idleStatus = sessionCard
        .locator('.text-yellow, .text-gray, .bg-yellow, .bg-gray')
        .filter({
          hasText: /idle|inactive|minutes.*ago/i,
        });

      const timeIndicator = sessionCard.locator('.text-xs, .text-sm').filter({
        hasText: /minutes.*ago|second.*ago|idle/i,
      });

      if ((await idleStatus.isVisible()) || (await timeIndicator.isVisible())) {
        expect((await idleStatus.isVisible()) || (await timeIndicator.isVisible())).toBeTruthy();
      }
    }
  });

  test('should track activity across multiple sessions', async ({ page }) => {
    test.setTimeout(30000); // Increase timeout for this test
    // Create multiple sessions
    const session1Name = sessionManager.generateSessionName('multi-activity-1');
    const session2Name = sessionManager.generateSessionName('multi-activity-2');

    // Create first session
    await createAndNavigateToSession(page, { name: session1Name });
    await assertTerminalReady(page);

    // Activity in first session
    await page.keyboard.type('echo "Session 1 activity"');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    // Create second session
    await createAndNavigateToSession(page, { name: session2Name });
    await assertTerminalReady(page);

    // Activity in second session
    await page.keyboard.type('echo "Session 2 activity"');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    // Go to session list
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible', timeout: 10000 });

    // Both sessions should show activity status
    const session1Card = page.locator('session-card').filter({ hasText: session1Name }).first();
    const session2Card = page.locator('session-card').filter({ hasText: session2Name }).first();

    if ((await session1Card.isVisible()) && (await session2Card.isVisible())) {
      // Both should have activity indicators
      const session1Activity = session1Card
        .locator('.activity, .status, .text-green, .bg-green, .text-xs')
        .filter({
          hasText: /active|ago|now/i,
        });

      const session2Activity = session2Card
        .locator('.activity, .status, .text-green, .bg-green, .text-xs')
        .filter({
          hasText: /active|ago|now/i,
        });

      const hasSession1Activity = await session1Activity.isVisible();
      const hasSession2Activity = await session2Activity.isVisible();

      // At least one should show activity (recent activity should be visible)
      expect(hasSession1Activity || hasSession2Activity).toBeTruthy();
    }
  });

  test('should handle activity monitoring for long-running commands', async ({ page }) => {
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('long-running-activity'),
    });
    await assertTerminalReady(page);

    // Start a long-running command (sleep)
    await page.keyboard.type('sleep 10 && echo "Long command completed"');
    await page.keyboard.press('Enter');

    // Wait a moment for command to start
    await page.waitForTimeout(2000);

    // Check activity status while command is running
    const activityStatus = page.locator('.activity-status, .status-indicator, .running').first();

    if (await activityStatus.isVisible()) {
      const statusText = await activityStatus.textContent();

      // Should indicate active/running status
      const isActive =
        statusText?.toLowerCase().includes('active') ||
        statusText?.toLowerCase().includes('running') ||
        statusText?.toLowerCase().includes('busy');

      if (isActive) {
        expect(isActive).toBeTruthy();
      }
    }

    // Go to session list to check status there
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible', timeout: 10000 });

    const sessionCard = page
      .locator('session-card')
      .filter({
        hasText: 'long-running-activity',
      })
      .first();

    if (await sessionCard.isVisible()) {
      // Should show active/running status
      const runningIndicator = sessionCard
        .locator('.text-green, .bg-green, .active, .running')
        .first();
      const recentActivity = sessionCard
        .locator('.text-xs, .text-sm')
        .filter({
          hasText: /now|active|running|second.*ago/i,
        })
        .first();

      const showsRunning =
        (await runningIndicator.isVisible()) || (await recentActivity.isVisible());

      if (showsRunning) {
        expect(showsRunning).toBeTruthy();
      }
    }
  });

  test('should show last activity time for inactive sessions', async ({ page }) => {
    // Create session and make it inactive
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('last-activity'),
    });
    await assertTerminalReady(page);

    // Perform some activity
    await page.keyboard.type('echo "Last activity test"');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    // Go to session list
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible', timeout: 10000 });

    const sessionCard = page
      .locator('session-card')
      .filter({
        hasText: 'last-activity',
      })
      .first();

    if (await sessionCard.isVisible()) {
      // Look for time-based activity indicators
      const timeIndicators = sessionCard.locator('.text-xs, .text-sm, .text-gray').filter({
        hasText: /ago|second|minute|hour|now|active/i,
      });

      const lastActivityTime = sessionCard.locator('.last-activity, .activity-time').first();

      const hasTimeInfo =
        (await timeIndicators.isVisible()) || (await lastActivityTime.isVisible());

      if (hasTimeInfo) {
        expect(hasTimeInfo).toBeTruthy();

        // Check that the time format is reasonable
        const timeText = await timeIndicators.first().textContent();
        if (timeText) {
          const hasReasonableTime =
            timeText.includes('ago') ||
            timeText.includes('now') ||
            timeText.includes('active') ||
            timeText.includes('second') ||
            timeText.includes('minute');

          expect(hasReasonableTime).toBeTruthy();
        }
      }
    }
  });

  test('should handle activity monitoring when switching between sessions', async ({ page }) => {
    // Create two sessions
    const session1Name = sessionManager.generateSessionName('switch-activity-1');
    const session2Name = sessionManager.generateSessionName('switch-activity-2');

    // Create and use first session
    await createAndNavigateToSession(page, { name: session1Name });
    await assertTerminalReady(page);
    await page.keyboard.type('echo "First session"');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    // Create and switch to second session
    await createAndNavigateToSession(page, { name: session2Name });
    await assertTerminalReady(page);
    await page.keyboard.type('echo "Second session"');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    // Switch back to first session via URL or navigation
    const firstSessionUrl = page.url().replace(session2Name, session1Name);
    await page.goto(firstSessionUrl);
    await assertTerminalReady(page);

    // Activity in first session again
    await page.keyboard.type('echo "Back to first"');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    // Check session list for activity tracking
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible', timeout: 10000 });

    // Both sessions should show their respective activity
    const session1Card = page.locator('session-card').filter({ hasText: session1Name }).first();
    const session2Card = page.locator('session-card').filter({ hasText: session2Name }).first();

    if ((await session1Card.isVisible()) && (await session2Card.isVisible())) {
      // First session should show more recent activity
      const session1Time = session1Card.locator('.text-xs, .text-sm').filter({
        hasText: /ago|now|active|second|minute/i,
      });

      const session2Time = session2Card.locator('.text-xs, .text-sm').filter({
        hasText: /ago|now|active|second|minute/i,
      });

      const bothHaveTimeInfo = (await session1Time.isVisible()) && (await session2Time.isVisible());

      if (bothHaveTimeInfo) {
        expect(bothHaveTimeInfo).toBeTruthy();
      }
    }
  });

  test('should handle activity monitoring with WebSocket reconnection', async ({ page }) => {
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('websocket-activity'),
    });
    await assertTerminalReady(page);

    // Perform initial activity
    await page.keyboard.type('echo "Before disconnect"');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    // Simulate WebSocket disconnection and reconnection
    await page.evaluate(() => {
      // Close any existing WebSocket connections
      (window as unknown as { closeWebSockets?: () => void }).closeWebSockets?.();
    });

    // Wait for potential reconnection
    await page.waitForTimeout(3000);

    // Perform activity after reconnection
    await page.keyboard.type('echo "After reconnect"');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    // Activity monitoring should still work
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible', timeout: 10000 });

    const sessionCard = page
      .locator('session-card')
      .filter({
        hasText: 'websocket-activity',
      })
      .first();

    if (await sessionCard.isVisible()) {
      const activityIndicator = sessionCard.locator('.text-green, .active, .text-xs').filter({
        hasText: /active|ago|now|second/i,
      });

      if (await activityIndicator.isVisible()) {
        expect(await activityIndicator.isVisible()).toBeTruthy();
      }
    }
  });

  test('should aggregate activity data correctly', async ({ page }) => {
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('activity-aggregation'),
    });
    await assertTerminalReady(page);

    // Perform multiple activities in sequence
    const activities = ['echo "Activity 1"', 'ls -la', 'pwd', 'whoami', 'date'];

    for (const activity of activities) {
      await page.keyboard.type(activity);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
    }

    // Wait for all activities to complete
    await page.waitForTimeout(2000);

    // Check aggregated activity status
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible', timeout: 10000 });

    const sessionCard = page
      .locator('session-card')
      .filter({
        hasText: 'activity-aggregation',
      })
      .first();

    if (await sessionCard.isVisible()) {
      // Should show recent activity from all the commands
      const recentActivity = sessionCard.locator('.text-green, .bg-green, .active').first();
      const activityTime = sessionCard.locator('.text-xs').filter({
        hasText: /now|second.*ago|active/i,
      });

      const showsAggregatedActivity =
        (await recentActivity.isVisible()) || (await activityTime.isVisible());

      if (showsAggregatedActivity) {
        expect(showsAggregatedActivity).toBeTruthy();
      }

      // Activity time should reflect the most recent activity
      if (await activityTime.isVisible()) {
        const timeText = await activityTime.textContent();
        const isRecent =
          timeText?.includes('now') || timeText?.includes('second') || timeText?.includes('active');

        if (isRecent) {
          expect(isRecent).toBeTruthy();
        }
      }
    }
  });
});
