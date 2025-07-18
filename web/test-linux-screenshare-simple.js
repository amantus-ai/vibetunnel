#!/usr/bin/env node

import { chromium } from 'playwright';

async function testLinuxScreenshare() {
  console.log('🚀 Starting Linux screenshare test...');
  
  const browser = await chromium.launch({ 
    headless: false,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });
  
  const context = await browser.newContext({
    permissions: ['camera', 'microphone']
  });
  
  const page = await context.newPage();
  
  // Enable console logging
  page.on('console', msg => {
    if (msg.type() === 'log' || msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`[Browser ${msg.type()}]`, msg.text());
    }
  });

  try {
    console.log('📍 Navigating to screencap page...');
    await page.goto('http://localhost:4020/screencap');
    
    // Wait for page to load
    await page.waitForSelector('screencap-view', { timeout: 10000 });
    console.log('✅ Screencap view loaded');
    
    // Click on Display 1 to start capture
    console.log('🖱️ Clicking on Display 1...');
    const display1 = await page.waitForSelector('text=Display 1', { timeout: 5000 });
    await display1.click();
    
    // Wait for capture to start
    console.log('⏳ Waiting for capture to start...');
    await page.waitForTimeout(3000);
    
    // Check if video element exists and has stream
    const videoExists = await page.evaluate(() => {
      const videoElements = document.querySelectorAll('video');
      console.log(`Found ${videoElements.length} video elements`);
      
      for (const video of videoElements) {
        console.log('Video element:', {
          src: video.src,
          srcObject: video.srcObject,
          readyState: video.readyState,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          currentTime: video.currentTime,
          paused: video.paused,
          autoplay: video.autoplay
        });
      }
      
      return videoElements.length > 0;
    });
    
    console.log(`📹 Video element exists: ${videoExists}`);
    
    // Check WebSocket connection status
    const wsStatus = await page.evaluate(() => {
      const ws = window.debugWebSocket;
      if (ws) {
        return {
          readyState: ws.readyState,
          url: ws.url,
          binaryType: ws.binaryType
        };
      }
      return null;
    });
    
    console.log('🔌 WebSocket status:', wsStatus);
    
    // Check for binary frames
    const frameStats = await page.evaluate(() => {
      return window.videoFrameStats || { count: 0, totalBytes: 0 };
    });
    
    console.log('📊 Frame statistics:', frameStats);
    
    // Take a screenshot
    await page.screenshot({ path: 'linux-screenshare-test.png', fullPage: true });
    console.log('📸 Screenshot saved to linux-screenshare-test.png');
    
    // Wait a bit more to see if frames arrive
    console.log('⏳ Waiting for video frames...');
    await page.waitForTimeout(5000);
    
    // Check frame stats again
    const finalFrameStats = await page.evaluate(() => {
      return window.videoFrameStats || { count: 0, totalBytes: 0 };
    });
    
    console.log('📊 Final frame statistics:', finalFrameStats);
    
    // Keep browser open for manual inspection
    console.log('✅ Test complete. Press Ctrl+C to close browser.');
    await page.waitForTimeout(60000);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({ path: 'linux-screenshare-error.png', fullPage: true });
  }
  
  await browser.close();
}

testLinuxScreenshare().catch(console.error);