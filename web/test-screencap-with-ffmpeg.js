#!/usr/bin/env node
const { chromium } = require('playwright');

(async () => {
  console.log('Testing VibeTunnel Linux Screen Capture with FFmpeg installed...');
  
  const browser = await chromium.launch({ 
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const context = await browser.newContext({
    permissions: ['camera', 'microphone']
  });
  
  const page = await context.newPage();
  
  // Enable console logging
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    if (type === 'error') {
      console.error('Browser ERROR:', text);
    } else if (text.includes('error') || text.includes('Error') || text.includes('Failed')) {
      console.log('Browser ISSUE:', text);
    } else if (text.includes('✅') || text.includes('Success')) {
      console.log('Browser SUCCESS:', text);
    }
  });
  
  page.on('pageerror', err => console.error('Page error:', err));
  
  console.log('\nNavigating to http://localhost:4020/screencap...');
  await page.goto('http://localhost:4020/screencap');
  
  // Wait for the screencap view to load
  await page.waitForSelector('screencap-view', { timeout: 10000 });
  console.log('✓ Screencap view loaded');
  
  // Wait a bit for WebSocket connection
  await page.waitForTimeout(2000);
  
  // Check for errors
  const hasError = await page.locator('.error, [class*="error"]').count() > 0;
  const errorText = hasError ? await page.locator('.error, [class*="error"]').first().textContent() : null;
  
  if (hasError && errorText) {
    console.log(`\n❌ Error found: ${errorText}`);
  }
  
  // Check for displays
  const displays = await page.evaluate(() => {
    const sidebar = document.querySelector('screencap-sidebar');
    if (!sidebar) return null;
    // Try to get displays from the component
    return sidebar.displays || [];
  });
  
  console.log(`\n📺 Displays found: ${displays ? displays.length : 0}`);
  
  // Check for start button
  const hasStartButton = await page.locator('button:has-text("Start")').count() > 0;
  console.log(`▶️  Start button present: ${hasStartButton}`);
  
  // Take screenshot
  await page.screenshot({ 
    path: 'screencap-with-ffmpeg.png',
    fullPage: true 
  });
  console.log('\n📸 Screenshot saved: screencap-with-ffmpeg.png');
  
  // If we have a start button, try clicking it
  if (hasStartButton) {
    console.log('\n🎬 Attempting to start screen capture...');
    await page.click('button:has-text("Start")');
    
    // Wait for capture to start
    await page.waitForTimeout(3000);
    
    // Check if video element appears
    const hasVideo = await page.locator('video').count() > 0;
    console.log(`📹 Video element present: ${hasVideo}`);
    
    if (hasVideo) {
      // Take screenshot of active capture
      await page.screenshot({ 
        path: 'screencap-active.png',
        fullPage: true 
      });
      console.log('📸 Active capture screenshot saved: screencap-active.png');
      
      // Check video properties
      const videoInfo = await page.evaluate(() => {
        const video = document.querySelector('video');
        if (!video) return null;
        return {
          playing: !video.paused,
          width: video.videoWidth,
          height: video.videoHeight,
          duration: video.duration,
          readyState: video.readyState,
          currentTime: video.currentTime
        };
      });
      
      console.log('\n📊 Video info:', videoInfo);
    }
  }
  
  // Wait a bit before closing
  console.log('\n⏳ Waiting 5 seconds to observe...');
  await page.waitForTimeout(5000);
  
  await browser.close();
  console.log('\n✅ Test completed!');
})();