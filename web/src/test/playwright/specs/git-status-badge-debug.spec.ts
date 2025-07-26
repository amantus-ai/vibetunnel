import { expect, test } from '@playwright/test';

test.describe('Git Status Badge Debugging', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app (test server runs on 4022)
    await page.goto('http://localhost:4022');
    await page.waitForLoadState('domcontentloaded');
  });

  test('investigate Git status badge flashing and disappearing', async ({ page }) => {
    test.setTimeout(60000); // 60 seconds

    // Enable debug mode for detailed logging
    // debugMode.enable();

    // Set up console log capturing
    const consoleLogs: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      // Capture all logs, especially those with GitStatusBadge
      if (text.includes('GitStatusBadge') || text.includes('git') || text.includes('Git')) {
        consoleLogs.push(`[${msg.type()}] ${text}`);
        console.log(`Console: ${text}`);
      }
    });

    // Set up network request monitoring
    const networkRequests: { url: string; method: string; response?: unknown }[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/api/sessions') || url.includes('git-status')) {
        const req = {
          url,
          method: request.method(),
        };
        networkRequests.push(req);
        console.log(`Request: ${request.method()} ${url}`);
      }
    });

    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/api/sessions') || url.includes('git-status')) {
        try {
          const body = await response.json().catch(() => null);
          const req = networkRequests.find((r) => r.url === url && !r.response);
          if (req && body) {
            req.response = body;
            console.log(`Response: ${url}`, JSON.stringify(body, null, 2));
          }
        } catch (_e) {
          // Ignore errors parsing response
        }
      }
    });

    console.log('Creating session in VibeTunnel git repository...');

    // Create a session in the VibeTunnel git repository
    // Click the create session button
    await page.click('[data-testid="create-session-button"]');

    // Fill in the session dialog
    await page.waitForSelector('[data-testid="session-create-modal"]');

    // Set working directory - use the parent directory which should be the git repo
    const workingDirInput = page.locator('input[placeholder*="working directory"]');
    const gitRepoPath = process.env.CI
      ? '/home/runner/_work/vibetunnel/vibetunnel'
      : process.cwd().includes('/web')
        ? process.cwd().replace('/web', '')
        : process.cwd();
    await workingDirInput.fill(gitRepoPath);

    // Set command
    const commandInput = page.locator('input[placeholder*="command to run"]');
    await commandInput.fill('bash');

    // Click create button
    await page.click('button:has-text("Create Session")');

    // Wait for session to be created and terminal to be ready
    await page.waitForSelector('[data-testid="terminal-container"]', {
      state: 'visible',
      timeout: 10000,
    });

    // Take initial screenshot
    await page.screenshot({
      path: 'git-badge-initial.png',
      fullPage: true,
    });
    console.log('Initial screenshot saved: git-badge-initial.png');

    // Wait a moment to see if badge appears
    console.log('Waiting to see if Git badge appears...');
    await page.waitForTimeout(2000);

    // Check for Git status badge with various selectors
    const gitBadgeSelectors = [
      'git-status-badge',
      '[data-testid="git-status-badge"]',
      '.git-status-badge',
      '[class*="git-status"]',
      // Check in session header specifically
      '.session-header-container git-status-badge',
      'session-header git-status-badge',
    ];

    let badgeFound = false;
    let badgeSelector = '';

    for (const selector of gitBadgeSelectors) {
      const element = await page.$(selector);
      if (element) {
        badgeFound = true;
        badgeSelector = selector;
        console.log(`Git badge found with selector: ${selector}`);

        // Check if it's visible
        const isVisible = await element.isVisible();
        console.log(`Badge visibility: ${isVisible}`);

        // Get computed styles
        const styles = await element.evaluate((el) => {
          const computed = window.getComputedStyle(el);
          return {
            display: computed.display,
            visibility: computed.visibility,
            opacity: computed.opacity,
            width: computed.width,
            height: computed.height,
          };
        });
        console.log('Badge styles:', styles);

        // Get badge content/attributes
        const attributes = await element.evaluate((el) => {
          const attrs: Record<string, string> = {};
          for (const attr of el.attributes) {
            attrs[attr.name] = attr.value;
          }
          return attrs;
        });
        console.log('Badge attributes:', attributes);

        break;
      }
    }

    if (!badgeFound) {
      console.log('Git badge not found with any selector');
    }

    // Check session data structure
    const sessionData = await page.evaluate(() => {
      // Try to access session data from the page
      const sessionView = document.querySelector('session-view');
      const sessionElement = sessionView as HTMLElement & { session?: unknown };
      if (sessionElement?.session) {
        return sessionElement.session;
      }
      return null;
    });

    if (sessionData) {
      console.log('Session data:', JSON.stringify(sessionData, null, 2));
      console.log('Git repo path:', sessionData.gitRepoPath);
      console.log('Has git repo:', !!sessionData.gitRepoPath);
    }

    // Take screenshot after waiting
    await page.screenshot({
      path: 'git-badge-after-wait.png',
      fullPage: true,
    });
    console.log('After-wait screenshot saved: git-badge-after-wait.png');

    // Try to observe the badge appearing and disappearing
    if (badgeFound && badgeSelector) {
      console.log('Monitoring badge visibility changes...');

      // Set up mutation observer to track changes
      await page.evaluate((selector) => {
        const badge = document.querySelector(selector);
        if (badge) {
          const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
              console.log('[GitStatusBadge] DOM Mutation:', {
                type: mutation.type,
                attributeName: mutation.attributeName,
                oldValue: mutation.oldValue,
                target: mutation.target,
              });
            });
          });

          observer.observe(badge, {
            attributes: true,
            attributeOldValue: true,
            childList: true,
            subtree: true,
          });

          // Also observe the parent
          if (badge.parentElement) {
            observer.observe(badge.parentElement, {
              childList: true,
              subtree: true,
            });
          }
        }
      }, badgeSelector);
    }

    // Wait and capture any changes
    console.log('Waiting to capture any badge visibility changes...');
    await page.waitForTimeout(5000);

    // Final screenshot
    await page.screenshot({
      path: 'git-badge-final.png',
      fullPage: true,
    });
    console.log('Final screenshot saved: git-badge-final.png');

    // Print all captured console logs
    console.log('\n=== All GitStatusBadge Console Logs ===');
    consoleLogs.forEach((log) => console.log(log));

    // Print network requests summary
    console.log('\n=== Network Requests Summary ===');
    networkRequests.forEach((req) => {
      console.log(`${req.method} ${req.url}`);
      if (req.response) {
        console.log('Response:', JSON.stringify(req.response, null, 2));
      }
    });

    // Try different approach - check for git-status endpoint
    console.log('\n=== Checking for git-status API calls ===');
    const gitStatusRequests = networkRequests.filter((r) => r.url.includes('git-status'));
    console.log(`Found ${gitStatusRequests.length} git-status API calls`);

    // Force a git status check
    const sessionId = sessionData?.id;
    if (sessionId) {
      console.log(`\nManually fetching git status for session ${sessionId}...`);
      const gitStatusResponse = await page.evaluate(async (id) => {
        try {
          const response = await fetch(`/api/sessions/${id}/git-status`);
          return await response.json();
        } catch (e) {
          return { error: e.toString() };
        }
      }, sessionId);
      console.log('Manual git status response:', gitStatusResponse);
    }

    // The test will fail to make sure we see the output
    expect(true).toBe(false);
  });
});
