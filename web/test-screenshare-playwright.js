#!/usr/bin/env node
const { chromium } = require('playwright');

async function testScreenshare() {
  console.log('🚀 Testing Linux screenshare with Playwright...\n');
  
  // Wait a bit for server to be ready
  console.log('⏳ Waiting for server to be ready...');
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  const browser = await chromium.launch({ 
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const context = await browser.newContext({
    permissions: ['camera', 'microphone'],
    // Record video for debugging
    recordVideo: {
      dir: './test-videos',
      size: { width: 1280, height: 720 }
    }
  });
  
  const page = await context.newPage();
  
  // Enable detailed logging
  page.on('console', msg => {
    const text = msg.text();
    if (!text.includes('DEBUG') && !text.includes('router')) {
      console.log(`[Browser] ${text}`);
    }
  });
  
  page.on('pageerror', err => console.error('❌ Page error:', err));
  
  try {
    console.log('\n📺 Navigating to screencap page...');
    await page.goto('http://localhost:4020/screencap', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    // Wait for the screencap view to be defined and rendered
    await page.waitForFunction(() => {
      const element = document.querySelector('screencap-view');
      return element && element.shadowRoot;
    }, { timeout: 10000 });
    
    console.log('✅ Screencap view loaded\n');
    
    // Give it time to load data
    await page.waitForTimeout(3000);
    
    // Check current state
    const initialState = await page.evaluate(() => {
      const view = document.querySelector('screencap-view');
      const sidebar = view?.shadowRoot?.querySelector('screencap-sidebar');
      const errorEl = view?.shadowRoot?.querySelector('.error');
      
      // Get all displays
      const displayElements = sidebar?.shadowRoot?.querySelectorAll('.display-item') || [];
      const displays = Array.from(displayElements).map((el, i) => ({
        index: i,
        text: el.textContent?.trim(),
        selected: el.classList.contains('selected')
      }));
      
      return {
        hasError: !!errorEl,
        errorText: errorEl?.textContent?.trim(),
        displayCount: displays.length,
        displays: displays
      };
    });
    
    console.log('📊 Initial state:', JSON.stringify(initialState, null, 2));
    
    if (initialState.hasError) {
      console.error('\n❌ Error found:', initialState.errorText);
      await page.screenshot({ path: 'screenshare-error.png' });
      return;
    }
    
    if (initialState.displayCount === 0) {
      console.error('\n❌ No displays found!');
      await page.screenshot({ path: 'screenshare-no-displays.png' });
      return;
    }
    
    // Select first display if not selected
    if (!initialState.displays.some(d => d.selected)) {
      console.log('\n🖱️ Clicking on first display...');
      
      await page.evaluate(() => {
        const view = document.querySelector('screencap-view');
        const sidebar = view?.shadowRoot?.querySelector('screencap-sidebar');
        const firstDisplay = sidebar?.shadowRoot?.querySelector('.display-item');
        if (firstDisplay) {
          firstDisplay.click();
        }
      });
      
      await page.waitForTimeout(1000);
      console.log('✅ Display selected');
    }
    
    // Take screenshot before starting
    await page.screenshot({ path: 'screenshare-before-start.png' });
    
    // Start capture
    console.log('\n🎬 Starting screen capture...');
    
    const startResult = await page.evaluate(() => {
      const view = document.querySelector('screencap-view');
      const startBtn = view?.shadowRoot?.querySelector('button.primary');
      
      if (startBtn && !startBtn.disabled) {
        console.log('Clicking start button:', startBtn.textContent);
        startBtn.click();
        return { clicked: true, buttonText: startBtn.textContent?.trim() };
      }
      
      return { 
        clicked: false, 
        buttonFound: !!startBtn,
        buttonDisabled: startBtn?.disabled,
        buttonText: startBtn?.textContent?.trim()
      };
    });
    
    console.log('Start result:', startResult);
    
    if (!startResult.clicked) {
      console.error('\n❌ Could not start capture');
      await page.screenshot({ path: 'screenshare-start-failed.png' });
      return;
    }
    
    // Wait for capture to initialize
    console.log('\n⏳ Waiting for capture to start...');
    await page.waitForTimeout(5000);
    
    // Check capture state
    const captureState = await page.evaluate(() => {
      const view = document.querySelector('screencap-view');
      const video = view?.shadowRoot?.querySelector('video');
      const canvas = view?.shadowRoot?.querySelector('canvas');
      const stopBtn = view?.shadowRoot?.querySelector('button.danger');
      const stats = view?.shadowRoot?.querySelector('.stats-overlay');
      
      let videoInfo = null;
      if (video) {
        videoInfo = {
          src: video.src,
          srcObject: !!video.srcObject,
          readyState: video.readyState,
          paused: video.paused,
          width: video.videoWidth,
          height: video.videoHeight,
          currentTime: video.currentTime
        };
      }
      
      return {
        hasVideo: !!video,
        hasCanvas: !!canvas,
        hasStopButton: !!stopBtn,
        hasStats: !!stats,
        videoInfo: videoInfo,
        isCapturing: !!video || !!canvas
      };
    });
    
    console.log('\n📹 Capture state:', JSON.stringify(captureState, null, 2));
    
    if (captureState.isCapturing) {
      console.log('\n✅ SUCCESS! Screen capture is working!');
      
      // Take screenshot of working capture
      await page.screenshot({ path: 'screenshare-success.png', fullPage: true });
      console.log('📸 Success screenshot saved: screenshare-success.png');
      
      // Let it run for a bit
      console.log('\n⏱️ Recording for 5 seconds...');
      await page.waitForTimeout(5000);
      
      // Check frame updates
      const frameCheck = await page.evaluate(() => {
        const view = document.querySelector('screencap-view');
        const video = view?.shadowRoot?.querySelector('video');
        const canvas = view?.shadowRoot?.querySelector('canvas');
        
        if (video) {
          return {
            type: 'video',
            currentTime: video.currentTime,
            playing: !video.paused
          };
        } else if (canvas) {
          // For canvas, we'd need to check if it's being updated
          return {
            type: 'canvas',
            width: canvas.width,
            height: canvas.height
          };
        }
        return null;
      });
      
      console.log('Frame check:', frameCheck);
      
      // Stop capture
      console.log('\n🛑 Stopping capture...');
      await page.evaluate(() => {
        const view = document.querySelector('screencap-view');
        const stopBtn = view?.shadowRoot?.querySelector('button.danger');
        if (stopBtn) {
          stopBtn.click();
        }
      });
      
      await page.waitForTimeout(2000);
      console.log('✅ Capture stopped');
      
    } else {
      console.error('\n❌ Screen capture did not start properly');
      await page.screenshot({ path: 'screenshare-not-capturing.png', fullPage: true });
    }
    
  } catch (error) {
    console.error('\n💥 Test error:', error);
    await page.screenshot({ path: 'screenshare-error-final.png', fullPage: true });
  } finally {
    console.log('\n🏁 Test completed. Browser will close in 5 seconds...');
    await page.waitForTimeout(5000);
    await browser.close();
  }
}

// Run test
testScreenshare().catch(err => {
  console.error('Failed to run test:', err);
  process.exit(1);
});