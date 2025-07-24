const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  // Capture console logs
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('GitStatusBadge') || text.includes('git')) {
      console.log(`[Console] ${msg.type()}: ${text}`);
    }
  });
  
  // Monitor network requests
  page.on('request', request => {
    const url = request.url();
    if (url.includes('/api/sessions') || url.includes('git-status')) {
      console.log(`[Request] ${request.method()} ${url}`);
    }
  });
  
  page.on('response', async response => {
    const url = response.url();
    if (url.includes('/api/sessions') || url.includes('git-status')) {
      try {
        const body = await response.json().catch(() => null);
        if (body) {
          console.log(`[Response] ${url}:`, JSON.stringify(body, null, 2));
        }
      } catch (e) {
        // Ignore
      }
    }
  });
  
  console.log('Navigating to VibeTunnel...');
  await page.goto('http://localhost:4020');
  await page.waitForLoadState('networkidle');
  
  console.log('Creating session...');
  // Click create session button
  await page.click('[data-testid="create-session-button"]');
  
  // Wait for dialog
  await page.waitForSelector('[data-testid="session-dialog"]');
  
  // Fill in working directory
  await page.fill('input[placeholder*="working directory"]', '/Users/steipete/Projects/vibetunnel');
  
  // Fill in command
  await page.fill('input[placeholder*="command to run"]', 'bash');
  
  // Click create
  await page.click('button:has-text("Create Session")');
  
  // Wait for terminal
  await page.waitForSelector('[data-testid="terminal-container"]', { timeout: 10000 });
  
  console.log('Waiting for Git badge...');
  await page.waitForTimeout(3000);
  
  // Check for git badge
  const badgeSelectors = [
    'git-status-badge',
    '[data-testid="git-status-badge"]',
    '.git-status-badge',
    'session-header git-status-badge'
  ];
  
  for (const selector of badgeSelectors) {
    const element = await page.$(selector);
    if (element) {
      console.log(`Git badge found with selector: ${selector}`);
      const isVisible = await element.isVisible();
      console.log(`Badge visible: ${isVisible}`);
      
      // Get session data
      const sessionData = await page.evaluate(() => {
        const sessionView = document.querySelector('session-view');
        return sessionView?.session || null;
      });
      
      if (sessionData) {
        console.log('Session gitRepoPath:', sessionData.gitRepoPath);
      }
      break;
    }
  }
  
  // Take screenshot
  await page.screenshot({ path: 'manual-git-badge-test.png', fullPage: true });
  console.log('Screenshot saved to manual-git-badge-test.png');
  
  // Keep browser open for manual inspection
  console.log('Browser will stay open for manual inspection. Press Ctrl+C to exit.');
  
  // Prevent script from exiting
  await new Promise(() => {});
})();