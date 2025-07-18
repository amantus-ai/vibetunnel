#!/usr/bin/env node
const { chromium } = require('playwright');
const { spawn } = require('child_process');

async function waitForServer(url, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        console.log('✅ Server is ready');
        return true;
      }
    } catch (e) {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Server failed to start within timeout');
}

async function testScreenShare() {
  console.log('🚀 Starting Linux screenshare debug test...\n');
  
  // Check prerequisites
  console.log('📋 Checking prerequisites:');
  console.log(`- DISPLAY: ${process.env.DISPLAY}`);
  console.log(`- WAYLAND_DISPLAY: ${process.env.WAYLAND_DISPLAY}`);
  console.log(`- FFmpeg installed: ${require('child_process').execSync('which ffmpeg || echo "NOT FOUND"').toString().trim()}`);
  console.log('');
  
  // Start the dev server
  console.log('📦 Starting development server with full debug logging...');
  const server = spawn('pnpm', ['run', 'dev'], {
    cwd: process.cwd(),
    env: { 
      ...process.env,
      DEBUG: '*', // Enable ALL debug logs to see what's happening
      NODE_ENV: 'development'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  
  // Capture all server output
  let serverOutput = '';
  server.stdout.on('data', (data) => {
    const output = data.toString();
    serverOutput += output;
    // Show all server logs during startup
    if (output.includes('screencap') || output.includes('desktop-capture') || output.includes('ffmpeg')) {
      process.stdout.write(`[SERVER] ${output}`);
    }
  });
  
  server.stderr.on('data', (data) => {
    const output = data.toString();
    serverOutput += output;
    process.stderr.write(`[SERVER ERROR] ${output}`);
  });
  
  try {
    // Wait for server to be ready
    await waitForServer('http://localhost:4020');
    console.log('');
    
    // Launch browser
    console.log('🌐 Launching Chromium browser...');
    const browser = await chromium.launch({ 
      headless: false,
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--enable-logging',
        '--v=1'
      ]
    });
    
    const context = await browser.newContext({
      permissions: ['camera', 'microphone'],
      // Record video of the test
      recordVideo: {
        dir: './test-videos',
        size: { width: 1280, height: 720 }
      }
    });
    
    const page = await context.newPage();
    
    // Inject console log interceptor
    await page.addInitScript(() => {
      window.consoleLogs = [];
      const originalLog = console.log;
      const originalError = console.error;
      const originalWarn = console.warn;
      
      console.log = (...args) => {
        window.consoleLogs.push({ type: 'log', args, time: new Date() });
        originalLog(...args);
      };
      console.error = (...args) => {
        window.consoleLogs.push({ type: 'error', args, time: new Date() });
        originalError(...args);
      };
      console.warn = (...args) => {
        window.consoleLogs.push({ type: 'warn', args, time: new Date() });
        originalWarn(...args);
      };
    });
    
    // Enable detailed console logging
    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      const location = msg.location();
      
      // Color code by type
      if (type === 'error') {
        console.log(`❌ [Browser ${type}] ${text}`);
        if (location.url) {
          console.log(`   at ${location.url}:${location.lineNumber}`);
        }
      } else if (type === 'warning') {
        console.log(`⚠️  [Browser ${type}] ${text}`);
      } else {
        console.log(`📝 [Browser ${type}] ${text}`);
      }
    });
    
    page.on('pageerror', err => {
      console.error('🔥 Page error:', err);
      console.error('Stack:', err.stack);
    });
    
    // Listen for WebSocket frames
    page.on('websocket', ws => {
      console.log(`🔌 WebSocket created: ${ws.url()}`);
      ws.on('framesent', ({ payload }) => {
        if (payload.includes('api-request') || payload.includes('webrtc')) {
          console.log(`📤 WS sent: ${payload.substring(0, 200)}...`);
        }
      });
      ws.on('framereceived', ({ payload }) => {
        if (payload.includes('api-response') || payload.includes('webrtc')) {
          console.log(`📥 WS received: ${payload.substring(0, 200)}...`);
        }
      });
      ws.on('error', err => console.error('🔌 WebSocket error:', err));
      ws.on('close', () => console.log('🔌 WebSocket closed'));
    });
    
    // Navigate to screencap
    console.log('\n📺 Navigating to screencap page...');
    const response = await page.goto('http://localhost:4020/screencap', {
      waitUntil: 'networkidle'
    });
    
    console.log(`Response status: ${response.status()}`);
    
    // Wait for the custom element to be defined
    await page.waitForFunction(() => customElements.get('screencap-view'), { timeout: 10000 });
    console.log('✅ screencap-view element is defined');
    
    // Wait for element to be rendered
    await page.waitForSelector('screencap-view', { state: 'attached' });
    console.log('✅ screencap-view element is attached to DOM');
    
    // Give it time to initialize WebSocket
    console.log('\n⏳ Waiting for WebSocket initialization...');
    await page.waitForTimeout(5000);
    
    // Check UI state and WebSocket status
    console.log('\n🔍 Checking component state...');
    const componentState = await page.evaluate(() => {
      const view = document.querySelector('screencap-view');
      const sidebar = document.querySelector('screencap-sidebar');
      
      // Try to access shadow DOM
      let sidebarInfo = {};
      if (sidebar && sidebar.shadowRoot) {
        const displayElements = sidebar.shadowRoot.querySelectorAll('.display-item');
        const errorElement = sidebar.shadowRoot.querySelector('.error, [class*="error"]');
        const startButton = sidebar.shadowRoot.querySelector('button:has-text("Start"), button:has-text("start")');
        
        sidebarInfo = {
          hasDisplays: displayElements.length > 0,
          displayCount: displayElements.length,
          hasError: !!errorElement,
          errorText: errorElement?.textContent || null,
          hasStartButton: !!startButton,
          startButtonDisabled: startButton?.disabled
        };
      }
      
      return {
        viewExists: !!view,
        sidebarExists: !!sidebar,
        sidebarInfo,
        // Get all console logs
        logs: window.consoleLogs || []
      };
    });
    
    console.log('Component state:', JSON.stringify(componentState, null, 2));
    
    // Show recent console logs
    if (componentState.logs.length > 0) {
      console.log('\n📋 Recent console logs from page:');
      componentState.logs.slice(-20).forEach(log => {
        console.log(`  [${log.type}] ${JSON.stringify(log.args)}`);
      });
    }
    
    // Take diagnostic screenshot
    await page.screenshot({ path: 'screencap-state.png', fullPage: true });
    console.log('📸 Screenshot saved: screencap-state.png');
    
    // If there's an error, let's dig deeper
    if (componentState.sidebarInfo.hasError) {
      console.log('\n❌ Error detected in UI:', componentState.sidebarInfo.errorText);
      
      // Check network requests
      const failedRequests = [];
      page.on('requestfailed', request => {
        failedRequests.push({
          url: request.url(),
          failure: request.failure()
        });
      });
      
      // Try to manually trigger display enumeration
      console.log('\n🔄 Attempting manual display enumeration...');
      const manualEnumResult = await page.evaluate(async () => {
        try {
          const response = await fetch('/api/server-capture/displays');
          const data = await response.json();
          return { success: true, data };
        } catch (error) {
          return { success: false, error: error.message };
        }
      });
      
      console.log('Manual enumeration result:', JSON.stringify(manualEnumResult, null, 2));
    }
    
    // If we have displays, try to start capture
    if (componentState.sidebarInfo.hasDisplays && componentState.sidebarInfo.hasStartButton) {
      console.log('\n🎬 Attempting to start screen capture...');
      
      // Click start button
      await page.evaluate(() => {
        const sidebar = document.querySelector('screencap-sidebar');
        const startButton = sidebar.shadowRoot.querySelector('button');
        if (startButton && !startButton.disabled) {
          startButton.click();
          return true;
        }
        return false;
      });
      
      // Wait for capture to start
      await page.waitForTimeout(5000);
      
      // Check for video element
      const captureState = await page.evaluate(() => {
        const video = document.querySelector('video');
        const screencapView = document.querySelector('screencap-view');
        const videoInShadow = screencapView?.shadowRoot?.querySelector('video');
        
        const checkVideo = (v) => {
          if (!v) return null;
          return {
            exists: true,
            playing: !v.paused,
            width: v.videoWidth,
            height: v.videoHeight,
            readyState: v.readyState,
            readyStateText: ['HAVE_NOTHING', 'HAVE_METADATA', 'HAVE_CURRENT_DATA', 'HAVE_FUTURE_DATA', 'HAVE_ENOUGH_DATA'][v.readyState],
            src: v.src || 'No src',
            srcObject: v.srcObject ? 'Has srcObject' : 'No srcObject',
            currentTime: v.currentTime,
            duration: v.duration
          };
        };
        
        return {
          mainVideo: checkVideo(video),
          shadowVideo: checkVideo(videoInShadow),
          logs: window.consoleLogs?.slice(-10) || []
        };
      });
      
      console.log('\n📹 Capture state:', JSON.stringify(captureState, null, 2));
      
      // Take screenshot with capture
      await page.screenshot({ path: 'with-capture-attempt.png', fullPage: true });
      console.log('📸 Screenshot saved: with-capture-attempt.png');
    }
    
    // Keep browser open for manual inspection
    console.log('\n⏳ Keeping browser open for 15 seconds for manual inspection...');
    console.log('You can interact with the page to debug further.');
    await page.waitForTimeout(15000);
    
    // Get final logs
    const finalLogs = await page.evaluate(() => window.consoleLogs || []);
    if (finalLogs.length > componentState.logs.length) {
      console.log('\n📋 Additional console logs:');
      finalLogs.slice(componentState.logs.length).forEach(log => {
        console.log(`  [${log.type}] ${JSON.stringify(log.args)}`);
      });
    }
    
    await browser.close();
    
  } finally {
    console.log('\n🛑 Stopping dev server...');
    server.kill();
    
    // Save full server output for debugging
    require('fs').writeFileSync('server-output.log', serverOutput);
    console.log('📄 Full server output saved to: server-output.log');
    
    // Show any server errors
    const errorLines = serverOutput.split('\n').filter(line => 
      line.toLowerCase().includes('error') || 
      line.includes('ERROR') ||
      line.includes('failed') ||
      line.includes('Failed')
    );
    
    if (errorLines.length > 0) {
      console.log('\n📋 Server errors detected:');
      errorLines.slice(-20).forEach(line => console.log(line));
    }
  }
  
  console.log('\n✅ Test completed!');
}

// Run the test
testScreenShare().catch(err => {
  console.error('\n💥 Test failed:', err);
  process.exit(1);
});