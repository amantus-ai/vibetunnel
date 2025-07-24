const { chromium } = require('playwright');

(async () => {
  // Launch browser in non-headless mode
  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 100 // Slow down actions to make them visible
  });
  
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // Track console logs
  const renderLogs = [];
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('App render()')) {
      renderLogs.push({
        time: Date.now(),
        text: text
      });
    }
  });
  
  console.log('🚀 Starting Git badge stability test...');
  
  // Navigate to the app
  await page.goto('http://localhost:4020');
  
  // Handle auth if needed
  const noAuthButton = page.locator('button:has-text("Continue without authentication")');
  if (await noAuthButton.isVisible({ timeout: 2000 })) {
    await noAuthButton.click();
    console.log('✅ Clicked no-auth button');
  }
  
  // Wait for session list to load
  await page.waitForSelector('session-card', { timeout: 10000 });
  console.log('✅ Session list loaded');
  
  // Click on the first session with a Git badge
  const sessionWithGit = page.locator('session-card').filter({ has: page.locator('git-status-badge') }).first();
  
  if (await sessionWithGit.count() === 0) {
    console.log('❌ No sessions with Git badges found!');
    await browser.close();
    return;
  }
  
  await sessionWithGit.click();
  console.log('✅ Clicked on session with Git badge');
  
  // Wait for session view to load
  await page.waitForSelector('session-view', { timeout: 5000 });
  console.log('✅ Session view loaded');
  
  // Clear render logs from initial load
  renderLogs.length = 0;
  
  // Test stability over 30 seconds
  console.log('🔍 Monitoring Git badge stability for 30 seconds...');
  
  const testDuration = 30000; // 30 seconds
  const checkInterval = 3000; // Check every 3 seconds
  const checks = testDuration / checkInterval;
  
  let allChecksPass = true;
  
  for (let i = 1; i <= checks; i++) {
    await page.waitForTimeout(checkInterval);
    
    // Check if Git badge is visible
    const badgeVisible = await page.locator('git-status-badge').isVisible();
    
    // Calculate renders in the last interval
    const now = Date.now();
    const recentRenders = renderLogs.filter(log => now - log.time < checkInterval).length;
    
    console.log(`Check ${i}/${checks}:`);
    console.log(`  - Git badge: ${badgeVisible ? '✅ Visible' : '❌ Missing'}`);
    console.log(`  - Renders in last ${checkInterval/1000}s: ${recentRenders}`);
    
    if (!badgeVisible) {
      console.log('❌ Git badge disappeared!');
      await page.screenshot({ path: `git-badge-missing-check-${i}.png` });
      allChecksPass = false;
    }
    
    if (recentRenders > 5) {
      console.log(`⚠️  Excessive re-renders detected: ${recentRenders} in ${checkInterval/1000}s`);
      allChecksPass = false;
    }
    
    // Take screenshot every 3rd check
    if (i % 3 === 0) {
      await page.screenshot({ path: `git-badge-check-${i}.png` });
    }
  }
  
  // Final summary
  console.log('\n📊 Test Summary:');
  console.log(`Total renders during test: ${renderLogs.length}`);
  console.log(`Average renders per second: ${(renderLogs.length / (testDuration / 1000)).toFixed(2)}`);
  console.log(`Test result: ${allChecksPass ? '✅ PASSED' : '❌ FAILED'}`);
  
  // Log cache hit information if available
  const cacheHitLogs = renderLogs.filter(log => log.text.includes('cacheHit'));
  if (cacheHitLogs.length > 0) {
    const cacheHits = cacheHitLogs.filter(log => log.text.includes('cacheHit: true')).length;
    console.log(`Cache hits: ${cacheHits}/${cacheHitLogs.length} (${((cacheHits/cacheHitLogs.length)*100).toFixed(1)}%)`);
  }
  
  await browser.close();
})();