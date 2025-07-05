const WebSocket = require('ws');

console.log('🔍 Testing VibeTunnel screencap WebSocket API...');
console.log('📍 Connecting to ws://localhost:4020/ws/screencap-signal');

// No auth header needed since authentication is disabled
const ws = new WebSocket('ws://localhost:4020/ws/screencap-signal');

ws.on('open', () => {
  console.log('✅ Connected to screencap WebSocket');
  
  // Send a GET /processes request
  const request = {
    id: '1',
    method: 'GET',
    path: '/processes'
  };
  
  console.log('📊 Sending GET /processes request...');
  console.log('Request:', JSON.stringify(request));
  ws.send(JSON.stringify(request));
  
  // Set timeout to close after 5 seconds
  setTimeout(() => {
    console.log('⏱️ Closing connection after 5 seconds');
    ws.close();
  }, 5000);
});

ws.on('message', (data) => {
  console.log('Received:', data.toString());
  try {
    const parsed = JSON.parse(data.toString());
    console.log('Parsed response:', JSON.stringify(parsed, null, 2));
  } catch (e) {
    console.log('Could not parse as JSON');
  }
});

ws.on('error', (err) => {
  console.error('WebSocket error:', err);
});

ws.on('close', (code, reason) => {
  console.log('WebSocket closed:', code, reason.toString());
});