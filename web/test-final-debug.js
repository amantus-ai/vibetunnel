#!/usr/bin/env node

import { chromium } from 'playwright';

async function testDebug() {
  console.log('🚀 Final debug test...');
  
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  // Track all logs
  const logs = [];
  page.on('console', msg => {
    const text = msg.text();
    logs.push(text);
    console.log(`[Browser] ${text}`);
  });

  try {
    await page.goto('http://localhost:4020/screencap');
    await page.waitForSelector('screencap-view', { timeout: 5000 });
    
    // Click Display 1
    await page.click('text=Display 1');
    await page.waitForTimeout(500);
    
    // Click Start
    await page.click('button:has-text("Start")');
    
    // Wait for capture
    await page.waitForTimeout(5000);
    
    // Check for duplicate start-capture messages
    const startCaptureCount = logs.filter(log => 
      log.includes('capture-started') || log.includes('start-capture')
    ).length;
    
    const streamEndedCount = logs.filter(log => 
      log.includes('stream-ended')
    ).length;
    
    const binaryFrameCount = logs.filter(log => 
      log.includes('Binary frame')
    ).length;
    
    console.log('\n📊 Summary:');
    console.log(`- Start capture messages: ${startCaptureCount}`);
    console.log(`- Stream ended messages: ${streamEndedCount}`);
    console.log(`- Binary frames received: ${binaryFrameCount}`);
    
    // Get final state
    const result = await page.evaluate(() => {
      const screencapView = document.querySelector('screencap-view');
      const videoElements = document.querySelectorAll('video');
      
      return {
        isCapturing: screencapView?.isCapturing,
        videoCount: videoElements.length,
        hasVideoWithSource: Array.from(videoElements).some(v => !!v.srcObject || !!v.src)
      };
    });
    
    console.log('\n📊 Final state:', result);
    
    await page.screenshot({ path: 'final-debug.png' });
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
  
  await browser.close();
}

testDebug().catch(console.error);