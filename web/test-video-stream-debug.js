#!/usr/bin/env node
const { chromium } = require('playwright');

async function debugVideoStream() {
  console.log('🔍 Debugging Linux screenshare video stream...\n');
  
  // Wait for server
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  const browser = await chromium.launch({ 
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-logging', '--v=1']
  });
  
  const context = await browser.newContext({
    permissions: ['camera', 'microphone']
  });
  
  const page = await context.newPage();
  
  // Capture all console messages
  const logs = [];
  page.on('console', msg => {
    const text = msg.text();
    logs.push({ type: msg.type(), text });
    if (!text.includes('router') && !text.includes('DEBUG')) {
      console.log(`[${msg.type()}] ${text}`);
    }
  });
  
  // Monitor WebSocket frames
  let binaryFrameCount = 0;
  let totalBinaryBytes = 0;
  
  page.on('websocket', ws => {
    console.log(`\n🔌 WebSocket created: ${ws.url()}`);
    
    ws.on('framereceived', ({ opcode, data }) => {
      if (opcode === 2) { // Binary frame
        binaryFrameCount++;
        totalBinaryBytes += data.length;
        console.log(`📦 Binary frame #${binaryFrameCount}: ${data.length} bytes (total: ${totalBinaryBytes} bytes)`);
      }
    });
    
    ws.on('close', () => {
      console.log('🔌 WebSocket closed');
      console.log(`📊 Total binary frames received: ${binaryFrameCount}`);
      console.log(`📊 Total binary data: ${totalBinaryBytes} bytes`);
    });
  });
  
  console.log('📺 Navigating to screencap...');
  await page.goto('http://localhost:4020/screencap', { waitUntil: 'networkidle' });
  
  // Wait for UI to load
  await page.waitForSelector('screencap-view', { timeout: 10000 });
  await page.waitForTimeout(3000);
  
  // Start capture
  console.log('\n🎬 Starting capture...');
  await page.evaluate(() => {
    const view = document.querySelector('screencap-view');
    const sidebar = view?.shadowRoot?.querySelector('screencap-sidebar');
    const firstDisplay = sidebar?.shadowRoot?.querySelector('.display-item');
    if (firstDisplay && !firstDisplay.classList.contains('selected')) {
      firstDisplay.click();
    }
  });
  
  await page.waitForTimeout(1000);
  
  const started = await page.evaluate(() => {
    const view = document.querySelector('screencap-view');
    const startBtn = view?.shadowRoot?.querySelector('button.primary');
    if (startBtn && !startBtn.disabled) {
      startBtn.click();
      return true;
    }
    return false;
  });
  
  if (!started) {
    console.error('❌ Could not start capture');
    await browser.close();
    return;
  }
  
  console.log('⏳ Waiting for video stream...');
  await page.waitForTimeout(5000);
  
  // Check video and MediaSource state
  const videoState = await page.evaluate(() => {
    const view = document.querySelector('screencap-view');
    const video = view?.shadowRoot?.querySelector('video');
    
    if (!video) return { error: 'No video element found' };
    
    // Check MediaSource
    let mediaSourceInfo = null;
    if (video.src && video.src.startsWith('blob:')) {
      // Try to get MediaSource info
      try {
        // MediaSource is usually stored on the video handler
        const handler = window.websocketVideoHandler;
        if (handler && handler.mediaSource) {
          mediaSourceInfo = {
            readyState: handler.mediaSource.readyState,
            duration: handler.mediaSource.duration,
            sourceBuffers: handler.mediaSource.sourceBuffers.length,
            activeSourceBuffers: handler.mediaSource.activeSourceBuffers.length
          };
        }
      } catch (e) {
        mediaSourceInfo = { error: e.message };
      }
    }
    
    return {
      src: video.src,
      srcObject: !!video.srcObject,
      readyState: video.readyState,
      readyStateText: ['HAVE_NOTHING', 'HAVE_METADATA', 'HAVE_CURRENT_DATA', 'HAVE_FUTURE_DATA', 'HAVE_ENOUGH_DATA'][video.readyState],
      networkState: video.networkState,
      networkStateText: ['NETWORK_EMPTY', 'NETWORK_IDLE', 'NETWORK_LOADING', 'NETWORK_NO_SOURCE'][video.networkState],
      error: video.error ? { code: video.error.code, message: video.error.message } : null,
      paused: video.paused,
      ended: video.ended,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      currentTime: video.currentTime,
      duration: video.duration,
      buffered: video.buffered.length > 0 ? {
        start: video.buffered.start(0),
        end: video.buffered.end(0),
        length: video.buffered.end(0) - video.buffered.start(0)
      } : null,
      mediaSource: mediaSourceInfo
    };
  });
  
  console.log('\n📹 Video element state:', JSON.stringify(videoState, null, 2));
  
  // Check WebSocket video handler
  const handlerState = await page.evaluate(() => {
    const view = document.querySelector('screencap-view');
    // Try to access the WebRTC handler which manages the video
    const webrtcHandler = view?.webrtcHandler;
    const wsVideoHandler = webrtcHandler?.websocketVideoHandler;
    
    if (!wsVideoHandler) return { error: 'No WebSocket video handler found' };
    
    return {
      hasMediaSource: !!wsVideoHandler.mediaSource,
      hasSourceBuffer: !!wsVideoHandler.sourceBuffer,
      hasVideoElement: !!wsVideoHandler.videoElement,
      frameQueueLength: wsVideoHandler.frameQueue?.length || 0,
      isProcessing: wsVideoHandler.isProcessing,
      hasStream: !!wsVideoHandler.stream
    };
  });
  
  console.log('\n🎥 WebSocket video handler state:', JSON.stringify(handlerState, null, 2));
  
  // Monitor for a few more seconds
  console.log('\n⏱️ Monitoring for 10 seconds...');
  await page.waitForTimeout(10000);
  
  // Final check
  const finalState = await page.evaluate(() => {
    const view = document.querySelector('screencap-view');
    const video = view?.shadowRoot?.querySelector('video');
    
    return {
      videoCurrentTime: video?.currentTime || 0,
      videoDuration: video?.duration || 0,
      isPlaying: video ? !video.paused && !video.ended : false,
      hasVideoData: video ? video.videoWidth > 0 && video.videoHeight > 0 : false
    };
  });
  
  console.log('\n📊 Final state:', JSON.stringify(finalState, null, 2));
  console.log(`\n📦 Total binary frames: ${binaryFrameCount}`);
  console.log(`📊 Total binary data: ${(totalBinaryBytes / 1024 / 1024).toFixed(2)} MB`);
  
  // Take screenshot
  await page.screenshot({ path: 'video-debug-final.png', fullPage: true });
  console.log('\n📸 Screenshot saved: video-debug-final.png');
  
  // Check for specific errors in logs
  const errors = logs.filter(log => log.type === 'error' || log.text.includes('error'));
  if (errors.length > 0) {
    console.log('\n❌ Errors found:');
    errors.forEach(err => console.log(`  - ${err.text}`));
  }
  
  console.log('\n✅ Test completed. Browser closing in 5 seconds...');
  await page.waitForTimeout(5000);
  await browser.close();
}

debugVideoStream().catch(err => {
  console.error('💥 Test failed:', err);
  process.exit(1);
});