#!/usr/bin/env node

// Direct test of desktop capture service

import { createDesktopCaptureService } from './dist/server/capture/desktop-capture-service.js';
import { createLogger } from './dist/server/utils/logger.js';

const logger = createLogger('test-capture');

async function test() {
  logger.log('Starting capture test...');
  
  const captureService = createDesktopCaptureService();
  
  try {
    await captureService.initialize();
    logger.log('Capture service initialized');
    
    const session = await captureService.startCapture({
      displayIndex: 0,
      quality: 'medium'
    });
    
    logger.log('Capture session started:', session.id);
    
    if (session.captureStream?.stream) {
      let frameCount = 0;
      let totalBytes = 0;
      
      session.captureStream.stream.on('data', (chunk) => {
        frameCount++;
        totalBytes += chunk.length;
        if (frameCount <= 5 || frameCount % 100 === 0) {
          logger.log(`Frame ${frameCount}: ${chunk.length} bytes (total: ${totalBytes})`);
        }
      });
      
      session.captureStream.stream.on('end', () => {
        logger.log(`Stream ended. Total frames: ${frameCount}, bytes: ${totalBytes}`);
      });
      
      session.captureStream.stream.on('error', (error) => {
        logger.error('Stream error:', error);
      });
    } else {
      logger.error('No capture stream available');
    }
    
    // Keep running for 10 seconds
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    logger.log('Stopping capture...');
    await captureService.stopCapture(session.id);
    
  } catch (error) {
    logger.error('Test error:', error);
  }
}

test().catch(console.error);