#!/usr/bin/env node

import { chromium } from 'playwright';

async function testWebRTC() {
  console.log('🚀 Testing Linux WebRTC setup...');
  
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  // Enable console logging
  page.on('console', msg => {
    const text = msg.text();
    // Filter for relevant logs
    if (text.includes('WebSocket') || text.includes('WebRTC') || 
        text.includes('video') || text.includes('stream') || 
        text.includes('FFmpeg') || text.includes('frame')) {
      console.log(`[Browser] ${text}`);
    }
  });

  try {
    await page.goto('http://localhost:4020/screencap');
    await page.waitForSelector('screencap-view', { timeout: 5000 });
    
    // Click Display 1
    await page.click('text=Display 1');
    await page.waitForTimeout(500);
    
    // Click Start
    await page.click('button:has-text("Start")');
    
    // Wait and check for video element
    await page.waitForTimeout(3000);
    
    const result = await page.evaluate(() => {
      const screencapView = document.querySelector('screencap-view');
      const videoElements = document.querySelectorAll('video');
      
      return {
        isCapturing: screencapView?.isCapturing,
        useWebRTC: screencapView?.useWebRTC,
        videoCount: videoElements.length,
        videoInfo: Array.from(videoElements).map(v => ({
          hasSource: !!v.srcObject || !!v.src,
          readyState: v.readyState,
          videoWidth: v.videoWidth,
          videoHeight: v.videoHeight
        })),
        frameStats: window.videoFrameStats || { count: 0, totalBytes: 0 }
      };
    });
    
    console.log('📊 Results:', JSON.stringify(result, null, 2));
    
    await page.screenshot({ path: 'webrtc-test.png' });
    console.log('📸 Screenshot saved');
    
    await page.waitForTimeout(3000);
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
  
  await browser.close();
}

testWebRTC().catch(console.error);