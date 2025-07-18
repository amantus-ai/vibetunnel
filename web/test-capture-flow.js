#!/usr/bin/env node

import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:4020/ws/screencap-signal');

let messageCount = 0;
let binaryCount = 0;
let binaryBytes = 0;

ws.on('open', () => {
  console.log('Connected to WebSocket');
  
  // Send start-capture after a short delay
  setTimeout(() => {
    const message = {
      id: crypto.randomUUID(),
      type: 'request',
      category: 'screencap',
      action: 'start-capture',
      payload: {
        displayIndex: 0,
        quality: 'medium',
        sessionId: 'test-' + Date.now()
      },
      sessionId: 'test-' + Date.now()
    };
    
    console.log('Sending start-capture...');
    ws.send(JSON.stringify(message));
  }, 100);
});

ws.on('message', (data, isBinary) => {
  if (isBinary) {
    binaryCount++;
    binaryBytes += data.length;
    
    // Check for VF header
    if (data.length >= 2 && data[0] === 0x56 && data[1] === 0x46) {
      console.log(`✅ Video frame ${binaryCount}: ${data.length} bytes`);
    } else {
      console.log(`Binary message ${binaryCount}: ${data.length} bytes (not a video frame)`);
    }
  } else {
    messageCount++;
    const msg = JSON.parse(data.toString());
    console.log(`Message ${messageCount}: ${msg.action} (${msg.type})`);
    
    if (msg.action === 'stream-ended') {
      console.log('❌ Stream ended!');
    }
  }
});

ws.on('error', (error) => {
  console.error('WebSocket error:', error.message);
});

ws.on('close', (code, reason) => {
  console.log(`WebSocket closed: code=${code}, reason=${reason}`);
  console.log(`Total: ${messageCount} text messages, ${binaryCount} binary messages (${binaryBytes} bytes)`);
});

// Run for 10 seconds
setTimeout(() => {
  console.log('Test complete, closing connection...');
  ws.close();
  process.exit(0);
}, 10000);