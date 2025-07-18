#!/usr/bin/env node

import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:4020/ws/screencap-signal');

ws.on('open', () => {
  console.log('WebSocket connected');
  
  // Send start-capture message
  const startMessage = {
    id: crypto.randomUUID(),
    type: 'request',
    category: 'screencap',
    action: 'start-capture',
    payload: {
      displayIndex: 0,
      quality: 'medium',
      sessionId: 'test-session-' + Date.now()
    },
    sessionId: 'test-session-' + Date.now()
  };
  
  console.log('Sending start-capture:', startMessage);
  ws.send(JSON.stringify(startMessage));
});

ws.on('message', (data, isBinary) => {
  if (isBinary) {
    console.log(`Binary message received: ${data.length} bytes`);
    // Check if it's a video frame (starts with 'VF')
    if (data.length > 2 && data[0] === 0x56 && data[1] === 0x46) { // 'V' = 0x56, 'F' = 0x46
      console.log('✅ VIDEO FRAME RECEIVED!');
    }
  } else {
    const message = JSON.parse(data.toString());
    console.log('Text message:', message);
  }
});

ws.on('error', (error) => {
  console.error('WebSocket error:', error);
});

ws.on('close', (code, reason) => {
  console.log(`WebSocket closed: code=${code}, reason=${reason}`);
});

// Keep running for 30 seconds
setTimeout(() => {
  console.log('Test complete');
  ws.close();
  process.exit(0);
}, 30000);