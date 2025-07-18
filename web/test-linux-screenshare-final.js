#!/usr/bin/env node

import { chromium } from 'playwright';

console.log('Testing Linux screenshare with video frame detection...');

(async () => {
  const browser = await chromium.launch({ 
    headless: false,
    args: ['--auto-open-devtools-for-tabs']
  });
  
  const page = await browser.newPage();
  
  // Enable console logging
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('video') || text.includes('frame') || text.includes('FFmpeg') || 
        text.includes('WebSocket') || text.includes('capture') || text.includes('stream')) {
      console.log(`[Browser Console] ${msg.type()}: ${text}`);
    }
  });
  
  page.on('pageerror', (error) => {
    console.error('[Page Error]', error);
  });

  // Navigate to the app
  await page.goto('http://localhost:4020');
  await page.waitForTimeout(2000);

  // Click on Screenshare
  console.log('Clicking on Screenshare...');
  const screenshareButton = await page.waitForSelector('text=Screenshare', { timeout: 10000 });
  await screenshareButton.click();

  // Wait for screencap view to load
  await page.waitForSelector('screencap-view', { timeout: 10000 });
  console.log('Screencap view loaded');

  // Start screen capture
  console.log('Starting screen capture...');
  const startButton = await page.waitForSelector('vt-button:has-text("Start Desktop Capture")', { timeout: 10000 });
  await startButton.click();

  // Monitor for video frames
  console.log('Monitoring for video frames...');
  
  // Check WebSocket messages and video element state every second
  let frameCount = 0;
  const checkInterval = setInterval(async () => {
    // Check if video element exists and has content
    const videoInfo = await page.evaluate(() => {
      const videoElements = document.querySelectorAll('video');
      if (videoElements.length > 0) {
        const video = videoElements[0];
        return {
          exists: true,
          readyState: video.readyState,
          currentTime: video.currentTime,
          duration: video.duration,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          src: video.src,
          error: video.error ? video.error.message : null
        };
      }
      return { exists: false };
    });
    
    if (videoInfo.exists) {
      console.log('Video element state:', videoInfo);
      if (videoInfo.videoWidth > 0 && videoInfo.videoHeight > 0) {
        console.log('✅ VIDEO IS DISPLAYING!');
        frameCount++;
      }
    }
    
    // Also check for MediaSource state
    const mediaSourceInfo = await page.evaluate(() => {
      const videos = document.querySelectorAll('video');
      if (videos.length > 0 && videos[0].src.startsWith('blob:')) {
        return { hasMediaSource: true, src: videos[0].src };
      }
      return { hasMediaSource: false };
    });
    
    if (mediaSourceInfo.hasMediaSource) {
      console.log('MediaSource detected:', mediaSourceInfo.src);
    }
  }, 1000);

  // Wait 30 seconds to observe
  await page.waitForTimeout(30000);
  
  clearInterval(checkInterval);
  console.log(`Total frames with video content: ${frameCount}`);
  
  await browser.close();
})();