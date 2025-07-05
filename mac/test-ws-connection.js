#!/usr/bin/env node
// Test WebSocket connection to screencap-signal endpoint

const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:4020/ws/screencap-signal');

ws.on('open', () => {
    console.log('✅ Connected to WebSocket');
    
    // Send a test API request
    const request = {
        type: 'api-request',
        requestId: 'test-1',
        method: 'GET',
        endpoint: '/processes',
        sessionId: 'test-session'
    };
    
    console.log('📤 Sending:', JSON.stringify(request));
    ws.send(JSON.stringify(request));
});

ws.on('message', (data) => {
    console.log('📥 Received:', data.toString());
    try {
        const parsed = JSON.parse(data.toString());
        console.log('📋 Parsed:', JSON.stringify(parsed, null, 2));
    } catch (e) {
        console.log('⚠️  Could not parse as JSON');
    }
});

ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
});

ws.on('close', (code, reason) => {
    console.log(`🔒 WebSocket closed: ${code} ${reason}`);
});

// Keep the script running
setTimeout(() => {
    console.log('⏰ Timeout reached, closing connection');
    ws.close();
}, 5000);