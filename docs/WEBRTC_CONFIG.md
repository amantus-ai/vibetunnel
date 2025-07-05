# WebRTC Configuration Guide

VibeTunnel uses WebRTC for screen sharing functionality. This guide explains how to configure STUN and TURN servers for optimal performance.

## Overview

WebRTC requires ICE (Interactive Connectivity Establishment) servers to establish peer-to-peer connections, especially when clients are behind NATs or firewalls.

- **STUN servers**: Help discover your public IP address
- **TURN servers**: Relay traffic when direct connection is not possible

## Default Configuration

By default, VibeTunnel uses free public STUN servers from Google:

```javascript
stun:stun.l.google.com:19302
stun:stun1.l.google.com:19302
stun:stun2.l.google.com:19302
stun:stun3.l.google.com:19302
stun:stun4.l.google.com:19302
```

## Environment Variables

You can configure WebRTC servers using environment variables:

### TURN Server Configuration

```bash
# Basic TURN server
export TURN_SERVER_URL="turn:turnserver.example.com:3478"
export TURN_USERNAME="myusername"
export TURN_CREDENTIAL="mypassword"

# TURN server with TCP
export TURN_SERVER_URL="turn:turnserver.example.com:3478?transport=tcp"

# TURNS (TURN over TLS)
export TURN_SERVER_URL="turns:turnserver.example.com:5349"
```

### Additional STUN Servers

```bash
# Add custom STUN servers (comma-separated)
export ADDITIONAL_STUN_SERVERS="stun:stun.example.com:3478,stun:stun2.example.com:3478"
```

### ICE Transport Policy

```bash
# Force all traffic through TURN server (useful for testing)
export ICE_TRANSPORT_POLICY="relay"
```

## Programmatic Configuration

For advanced use cases, you can provide configuration programmatically:

### Browser (via global variable)

```javascript
window.__WEBRTC_CONFIG__ = {
  iceServers: [
    { urls: 'stun:stun.example.com:3478' },
    {
      urls: 'turn:turn.example.com:3478',
      username: 'user',
      credential: 'pass'
    }
  ]
};
```

### Server API

The server exposes an endpoint to retrieve the current WebRTC configuration:

```bash
GET /api/webrtc-config
```

Response:
```json
{
  "success": true,
  "config": {
    "iceServers": [
      { "urls": "stun:stun.l.google.com:19302" },
      {
        "urls": "turn:turn.example.com:3478",
        "username": "user",
        "credential": "pass"
      }
    ],
    "bundlePolicy": "max-bundle",
    "rtcpMuxPolicy": "require"
  }
}
```

## Setting Up Your Own TURN Server

For production use, especially in corporate environments, you should run your own TURN server.

### Using coturn

1. Install coturn:
```bash
# Ubuntu/Debian
sudo apt-get install coturn

# macOS
brew install coturn
```

2. Configure coturn (`/etc/turnserver.conf`):
```ini
# Network settings
listening-port=3478
tls-listening-port=5349
external-ip=YOUR_PUBLIC_IP

# Authentication
lt-cred-mech
user=vibetunnel:secretpassword

# Security
fingerprint
no-tlsv1
no-tlsv1_1

# Logging
log-file=/var/log/turnserver.log
```

3. Start the TURN server:
```bash
sudo systemctl start coturn
```

4. Configure VibeTunnel:
```bash
export TURN_SERVER_URL="turn:your-server.com:3478"
export TURN_USERNAME="vibetunnel"
export TURN_CREDENTIAL="secretpassword"
```

## Troubleshooting

### Connection Issues

1. **Check ICE gathering state** in browser console:
   ```javascript
   // In DevTools console while screen sharing
   peerConnection.iceGatheringState
   ```

2. **Test STUN/TURN connectivity**:
   - Use online tools like: https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
   - Enter your TURN server details and test

3. **Common issues**:
   - Firewall blocking UDP ports (try TCP transport)
   - TURN server authentication failures
   - Incorrect external IP configuration

### Performance Optimization

1. **Use geographically close servers**: Deploy TURN servers near your users
2. **Monitor bandwidth usage**: TURN servers relay all traffic
3. **Consider using TURNS** (TURN over TLS) for better firewall traversal
4. **Set appropriate bandwidth limits** in coturn configuration

## Security Considerations

1. **Always use authentication** for TURN servers (they relay traffic)
2. **Rotate credentials regularly**
3. **Monitor TURN server usage** for abuse
4. **Use TLS for signaling** (wss:// instead of ws://)
5. **Restrict TURN server access** by IP if possible

## Example Configurations

### Corporate Network with Firewall

```bash
# Use TCP transport and TURNS
export TURN_SERVER_URL="turns:turn.company.com:443?transport=tcp"
export TURN_USERNAME="corp-user"
export TURN_CREDENTIAL="secure-password"
export ICE_TRANSPORT_POLICY="relay"  # Force all traffic through TURN
```

### High Availability Setup

```javascript
window.__WEBRTC_CONFIG__ = {
  iceServers: [
    // Multiple STUN servers
    { urls: 'stun:stun1.company.com:3478' },
    { urls: 'stun:stun2.company.com:3478' },
    
    // Multiple TURN servers for redundancy
    {
      urls: [
        'turn:turn1.company.com:3478',
        'turn:turn2.company.com:3478'
      ],
      username: 'user',
      credential: 'pass'
    }
  ]
};
```

### Development/Testing

```bash
# Simple configuration for local testing
export TURN_SERVER_URL="turn:localhost:3478"
export TURN_USERNAME="test"
export TURN_CREDENTIAL="test"
```

## Monitoring

Monitor your WebRTC connections by checking:

1. **ICE connection state**: Should be "connected" or "completed"
2. **Packet loss**: Should be < 1% for good quality
3. **Round trip time**: Should be < 150ms for good experience
4. **Bandwidth usage**: Monitor if using TURN relay

The VibeTunnel statistics panel shows these metrics during screen sharing.