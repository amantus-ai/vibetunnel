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
  console.log('🚀 Starting Linux screenshare test...\n');
  
  // Start the dev server
  console.log('📦 Starting development server...');
  const server = spawn('pnpm', ['run', 'dev'], {
    cwd: process.cwd(),
    env: { 
      ...process.env,
      DEBUG: 'screencap*,desktop-capture*,ffmpeg*,linux*'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  
  let serverOutput = '';
  server.stdout.on('data', (data) => {
    const output = data.toString();
    serverOutput += output;
    if (output.includes('error') || output.includes('Error')) {
      console.log('Server:', output.trim());
    }
  });
  
  server.stderr.on('data', (data) => {
    const output = data.toString();
    serverOutput += output;
    console.log('Server Error:', output.trim());
  });
  
  try {
    // Wait for server to be ready
    await waitForServer('http://localhost:4020');
    console.log('');
    
    // Launch browser
    console.log('🌐 Launching Chromium browser...');
    const browser = await chromium.launch({ 
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const context = await browser.newContext({
      permissions: ['camera', 'microphone']
    });
    
    const page = await context.newPage();
    
    // Enable detailed console logging
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('Failed') || text.includes('error') || text.includes('Error')) {
        console.log('❌ Browser:', text);
      } else if (text.includes('✅') || text.includes('Success') || text.includes('ready')) {
        console.log('✅ Browser:', text);
      } else if (text.includes('displays') || text.includes('Displays')) {
        console.log('🖥️ Browser:', text);
      }
    });
    
    page.on('pageerror', err => console.error('Page error:', err));
    
    // Navigate to screencap
    console.log('\n📺 Navigating to screencap page...');
    await page.goto('http://localhost:4020/screencap');
    await page.waitForSelector('screencap-view', { timeout: 10000 });
    
    // Wait for WebSocket connection
    await page.waitForTimeout(3000);
    
    // Check UI state
    console.log('\n🔍 Checking UI state...');
    
    // Check for errors
    const errorElement = await page.$('.error, [class*="error"]');
    if (errorElement) {
      const errorText = await errorElement.textContent();
      console.log(`❌ Error in UI: ${errorText}`);
    }
    
    // Get displays using page evaluation
    const displayInfo = await page.evaluate(() => {
      const sidebar = document.querySelector('screencap-sidebar');
      if (sidebar && sidebar.shadowRoot) {
        const displayElements = sidebar.shadowRoot.querySelectorAll('.display-item');
        return {
          count: displayElements.length,
          hasDisplays: displayElements.length > 0
        };
      }
      return { count: 0, hasDisplays: false };
    });
    
    console.log(`\n📊 Display info: ${displayInfo.count} displays found`);
    
    // Try to find and click start button
    const startButton = await page.$('button:has-text("Start")');
    if (startButton) {
      console.log('\n🎬 Found Start button, attempting to start capture...');
      
      // Take before screenshot
      await page.screenshot({ path: 'before-capture.png', fullPage: true });
      
      await startButton.click();
      await page.waitForTimeout(5000);
      
      // Check for video element
      const videoElement = await page.$('video');
      if (videoElement) {
        console.log('✅ Video element appeared!');
        
        const videoInfo = await page.evaluate(() => {
          const video = document.querySelector('video');
          return video ? {
            playing: !video.paused,
            width: video.videoWidth,
            height: video.videoHeight,
            readyState: video.readyState,
            src: video.src || 'No src',
            srcObject: video.srcObject ? 'Has srcObject' : 'No srcObject'
          } : null;
        });
        
        console.log('\n📹 Video info:', JSON.stringify(videoInfo, null, 2));
        
        // Take screenshot with video
        await page.screenshot({ path: 'with-capture.png', fullPage: true });
        console.log('📸 Screenshots saved: before-capture.png, with-capture.png');
      } else {
        console.log('❌ No video element found after clicking Start');
        
        // Check console for errors
        const logs = await page.evaluate(() => {
          return window.consoleLogs || [];
        });
        console.log('Recent console logs:', logs.slice(-10));
      }
    } else {
      console.log('❌ No Start button found');
      await page.screenshot({ path: 'no-start-button.png', fullPage: true });
    }
    
    // Keep browser open for observation
    console.log('\n⏳ Keeping browser open for 10 seconds...');
    await page.waitForTimeout(10000);
    
    await browser.close();
    
  } finally {
    console.log('\n🛑 Stopping dev server...');
    server.kill();
    
    // Show server output if there were issues
    if (serverOutput.includes('error') || serverOutput.includes('Error')) {
      console.log('\n📋 Server output contained errors:');
      const errorLines = serverOutput.split('\n').filter(line => 
        line.includes('error') || line.includes('Error') || line.includes('ERROR')
      );
      errorLines.slice(-10).forEach(line => console.log(line));
    }
  }
  
  console.log('\n✅ Test completed!');
}

// Run the test
testScreenShare().catch(console.error);