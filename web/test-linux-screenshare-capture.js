#!/usr/bin/env node
const { chromium } = require('playwright');

async function testScreenCapture() {
  console.log('🚀 Starting Linux screenshare capture test...\n');
  
  // Check prerequisites
  console.log('📋 Checking prerequisites:');
  console.log(`- DISPLAY: ${process.env.DISPLAY}`);
  console.log(`- WAYLAND_DISPLAY: ${process.env.WAYLAND_DISPLAY}`);
  
  try {
    const ffmpegCheck = require('child_process').execSync('ffmpeg -version').toString();
    console.log(`- FFmpeg: ✅ Installed (${ffmpegCheck.split('\n')[0]})`);
  } catch (e) {
    console.log('- FFmpeg: ❌ Not installed');
  }
  
  console.log('\nAssuming dev server is already running on port 4020...\n');
  
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
      console.log(`❌ [Browser error] ${text}`);
    } else if (text.includes('error') || text.includes('Error')) {
      console.log(`⚠️  [Browser] ${text}`);
    }
  });
  
  page.on('pageerror', err => console.error('🔥 Page error:', err));
  
  console.log('📺 Navigating to screencap page...');
  await page.goto('http://localhost:4020/screencap', { waitUntil: 'networkidle' });
  
  // Wait for the screencap view to load
  await page.waitForSelector('screencap-view', { timeout: 10000 });
  console.log('✅ Screencap view loaded');
  
  // Wait a bit for WebSocket connection and data loading
  await page.waitForTimeout(3000);
  
  // Check the current state
  const state = await page.evaluate(() => {
    const view = document.querySelector('screencap-view');
    const sidebar = view?.shadowRoot?.querySelector('screencap-sidebar');
    
    // Get displays from sidebar
    let displays = [];
    if (sidebar?.shadowRoot) {
      const displayItems = sidebar.shadowRoot.querySelectorAll('.display-item');
      displays = Array.from(displayItems).map((item, index) => ({
        index,
        text: item.textContent?.trim() || '',
        isSelected: item.classList.contains('selected')
      }));
    }
    
    // Get error state
    const errorElement = view?.shadowRoot?.querySelector('.error');
    
    // Get start button
    const startButton = view?.shadowRoot?.querySelector('button[class*="primary"]');
    
    return {
      hasError: !!errorElement,
      errorText: errorElement?.textContent?.trim() || null,
      displays,
      hasStartButton: !!startButton,
      startButtonEnabled: startButton ? !startButton.disabled : false,
      startButtonText: startButton?.textContent?.trim() || ''
    };
  });
  
  console.log('\n📊 Current state:', JSON.stringify(state, null, 2));
  
  if (state.hasError) {
    console.error('\n❌ Error detected:', state.errorText);
    await page.screenshot({ path: 'screencap-error.png' });
    console.log('📸 Error screenshot saved: screencap-error.png');
  } else if (state.displays.length === 0) {
    console.error('\n❌ No displays found');
    await page.screenshot({ path: 'screencap-no-displays.png' });
    console.log('📸 Screenshot saved: screencap-no-displays.png');
  } else {
    console.log('\n✅ Found displays:', state.displays);
    
    // Select the first display if not already selected
    if (!state.displays.some(d => d.isSelected)) {
      console.log('\n🖱️ Selecting first display...');
      await page.evaluate(() => {
        const view = document.querySelector('screencap-view');
        const sidebar = view?.shadowRoot?.querySelector('screencap-sidebar');
        const firstDisplay = sidebar?.shadowRoot?.querySelector('.display-item');
        if (firstDisplay) {
          firstDisplay.click();
          return true;
        }
        return false;
      });
      
      await page.waitForTimeout(1000);
      console.log('✅ Display selected');
    }
    
    // Try to start capture
    if (state.startButtonEnabled) {
      console.log('\n🎬 Starting screen capture...');
      
      const started = await page.evaluate(() => {
        const view = document.querySelector('screencap-view');
        const startButton = view?.shadowRoot?.querySelector('button[class*="primary"]');
        if (startButton && !startButton.disabled) {
          startButton.click();
          return true;
        }
        return false;
      });
      
      if (started) {
        console.log('⏳ Waiting for capture to start...');
        await page.waitForTimeout(5000);
        
        // Check if video element appears
        const captureState = await page.evaluate(() => {
          const view = document.querySelector('screencap-view');
          const video = view?.shadowRoot?.querySelector('video');
          const canvas = view?.shadowRoot?.querySelector('canvas');
          const stopButton = view?.shadowRoot?.querySelector('button.danger');
          
          return {
            hasVideo: !!video,
            hasCanvas: !!canvas,
            hasStopButton: !!stopButton,
            videoSrc: video?.src || null,
            videoReady: video ? video.readyState >= 2 : false,
            videoPlaying: video ? !video.paused : false
          };
        });
        
        console.log('\n📹 Capture state:', JSON.stringify(captureState, null, 2));
        
        if (captureState.hasVideo || captureState.hasCanvas) {
          console.log('\n✅ Screen capture is working!');
          await page.screenshot({ path: 'screencap-success.png' });
          console.log('📸 Success screenshot saved: screencap-success.png');
          
          // Let it run for a few seconds
          console.log('\n⏱️ Capturing for 5 seconds...');
          await page.waitForTimeout(5000);
          
          // Stop capture
          if (captureState.hasStopButton) {
            console.log('\n🛑 Stopping capture...');
            await page.evaluate(() => {
              const view = document.querySelector('screencap-view');
              const stopButton = view?.shadowRoot?.querySelector('button.danger');
              if (stopButton) {
                stopButton.click();
              }
            });
            await page.waitForTimeout(2000);
            console.log('✅ Capture stopped');
          }
        } else {
          console.error('\n❌ No video/canvas element found after starting capture');
          await page.screenshot({ path: 'screencap-no-video.png' });
          console.log('📸 Screenshot saved: screencap-no-video.png');
        }
      } else {
        console.error('\n❌ Failed to click start button');
      }
    } else {
      console.error('\n❌ Start button is disabled or not found');
      await page.screenshot({ path: 'screencap-button-disabled.png' });
      console.log('📸 Screenshot saved: screencap-button-disabled.png');
    }
  }
  
  console.log('\n🏁 Test completed. Browser will remain open for 10 seconds...');
  await page.waitForTimeout(10000);
  
  await browser.close();
}

// Run the test
testScreenCapture().catch(err => {
  console.error('\n💥 Test failed:', err);
  process.exit(1);
});