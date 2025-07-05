const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:4020/ws/screencap-signal', {
  headers: {
    'X-VibeTunnel-Local': 'R5o9f1i92iic0ghtL-R8MwNr7_h7IS5RNJAogI4C-K8'
  }
});

ws.on('open', () => {
  console.log('Connected to screencap WebSocket');
  
  // Send a GET /processes request
  const request = {
    id: '1',
    method: 'GET',
    path: '/processes'
  };
  
  console.log('Sending request:', request);
  ws.send(JSON.stringify(request));
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