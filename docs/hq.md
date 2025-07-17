# HQ Mode - Distributed Terminal Management

HQ (Headquarters) mode enables VibeTunnel to operate as a distributed system where multiple VibeTunnel servers can be managed from a central headquarters server. This architecture allows you to scale terminal sessions across multiple machines while providing a unified interface.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Setup Guide](#setup-guide)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Security](#security)
- [Monitoring & Health](#monitoring--health)
- [Troubleshooting](#troubleshooting)
- [Use Cases](#use-cases)

## Overview

HQ mode transforms VibeTunnel from a single-server application into a distributed system with:

- **Central Management**: Access all terminal sessions from any remote server through one interface
- **Horizontal Scaling**: Add more servers to handle increased load
- **High Availability**: Continue operating even if individual remote servers fail
- **Transparent Routing**: Requests automatically route to the appropriate server
- **Unified Experience**: Users don't need to know which server hosts their session

## Architecture

### Components

```
┌─────────────────┐
│   HQ Server     │ ← Central management point
│  (Port 4020)    │
└────────┬────────┘
         │ Bearer Token Auth
         │
    ┌────┴────┬──────────┬──────────┐
    │         │          │          │
┌───▼───┐ ┌──▼───┐ ┌───▼───┐ ┌────▼────┐
│Remote1│ │Remote2│ │Remote3│ │Remote N │ ← Individual VibeTunnel servers
└───────┘ └───────┘ └───────┘ └─────────┘
```

### Key Concepts

1. **HQ Server**: The central server that aggregates and routes requests
2. **Remote Servers**: Individual VibeTunnel servers that register with HQ
3. **Remote Registry**: HQ's internal tracking of all registered remotes
4. **Session Ownership**: Each session belongs to a specific remote server
5. **Health Monitoring**: Periodic checks ensure remotes are responsive

### Data Flow

1. **Registration**: Remote servers register with HQ on startup
2. **Session Creation**: Users can specify which remote should host a session
3. **Request Routing**: HQ forwards requests to the appropriate remote
4. **Response Aggregation**: HQ combines responses from multiple remotes
5. **Stream Proxying**: SSE and WebSocket streams are transparently proxied

## Setup Guide

### Running an HQ Server

```bash
# Start HQ server with authentication
vibetunnel-server --hq --username hq-admin --password hq-secret

# Start HQ server on custom port
vibetunnel-server --hq --port 8080 --username hq-admin --password hq-secret

# HQ server with bearer token authentication
vibetunnel-server --hq --username hq-admin --password hq-secret
```

### Running Remote Servers

```bash
# Basic remote server
vibetunnel-server \
  --username local-admin \
  --password local-secret \
  --hq-url https://hq.example.com \
  --hq-username hq-admin \
  --hq-password hq-secret \
  --name production-1

# Remote server with custom port
vibetunnel-server \
  --port 4021 \
  --username local-admin \
  --password local-secret \
  --hq-url https://hq.example.com \
  --hq-username hq-admin \
  --hq-password hq-secret \
  --name production-2

# For local development (HTTP)
vibetunnel-server \
  --username local \
  --password local \
  --hq-url http://localhost:4020 \
  --hq-username hq-admin \
  --hq-password hq-secret \
  --name dev-remote \
  --allow-insecure-hq
```

### Docker Compose Example

```yaml
version: '3.8'

services:
  hq:
    image: vibetunnel/server:latest
    ports:
      - "4020:4020"
    environment:
      - VIBETUNNEL_USERNAME=hq-admin
      - VIBETUNNEL_PASSWORD=hq-secret
    command: ["--hq"]

  remote-1:
    image: vibetunnel/server:latest
    ports:
      - "4021:4020"
    environment:
      - VIBETUNNEL_USERNAME=local
      - VIBETUNNEL_PASSWORD=local
    command: [
      "--hq-url", "http://hq:4020",
      "--hq-username", "hq-admin",
      "--hq-password", "hq-secret",
      "--name", "remote-1",
      "--allow-insecure-hq"
    ]
    depends_on:
      - hq

  remote-2:
    image: vibetunnel/server:latest
    ports:
      - "4022:4020"
    environment:
      - VIBETUNNEL_USERNAME=local
      - VIBETUNNEL_PASSWORD=local
    command: [
      "--hq-url", "http://hq:4020",
      "--hq-username", "hq-admin",
      "--hq-password", "hq-secret",
      "--name", "remote-2",
      "--allow-insecure-hq"
    ]
    depends_on:
      - hq
```

## Configuration

### HQ Server Options

| Option | Description | Default |
|--------|-------------|---------|
| `--hq` | Enable HQ mode | `false` |
| `--port` | Server port | `4020` |
| `--username` | Admin username | Required |
| `--password` | Admin password | Required |
| `--no-auth` | Disable authentication (testing only) | `false` |

### Remote Server Options

| Option | Description | Default |
|--------|-------------|---------|
| `--hq-url` | HQ server URL | None |
| `--hq-username` | Username for HQ auth | None |
| `--hq-password` | Password for HQ auth | None |
| `--name` | Unique remote server name | Required |
| `--allow-insecure-hq` | Allow HTTP URLs for HQ | `false` |
| `--no-hq-auth` | Skip HQ authentication (testing) | `false` |

### Environment Variables

All command-line options can be set via environment variables:

```bash
# HQ Server
export VIBETUNNEL_USERNAME=hq-admin
export VIBETUNNEL_PASSWORD=hq-secret

# Remote Server
export VIBETUNNEL_HQ_URL=https://hq.example.com
export VIBETUNNEL_HQ_USERNAME=hq-admin
export VIBETUNNEL_HQ_PASSWORD=hq-secret
export VIBETUNNEL_REMOTE_NAME=production-1
```

## API Reference

### HQ-Specific Endpoints

#### List Remote Servers
```http
GET /api/remotes
Authorization: Basic <credentials>

Response:
[
  {
    "id": "uuid",
    "name": "production-1",
    "url": "https://remote1.example.com",
    "registeredAt": "2025-01-17T10:00:00Z",
    "lastHeartbeat": "2025-01-17T10:30:00Z",
    "sessionCount": 5,
    "healthy": true
  }
]
```

#### Register Remote (Internal)
```http
POST /api/remotes/register
Authorization: Basic <hq-credentials>
Content-Type: application/json

{
  "id": "uuid",
  "name": "production-1",
  "url": "https://remote1.example.com",
  "token": "bearer-token-for-hq-to-use"
}
```

#### Create Session on Specific Remote
```http
POST /api/sessions
Authorization: Basic <credentials>
Content-Type: application/json

{
  "command": "bash",
  "remoteId": "uuid-of-remote-server"
}
```

### Session Management

All standard session API endpoints work transparently with HQ mode:

- `GET /api/sessions` - Lists sessions from all remotes
- `GET /api/sessions/:id` - Gets session info (routes to appropriate remote)
- `POST /api/sessions/:id/input` - Sends input (routes to appropriate remote)
- `GET /api/sessions/:id/stream` - SSE stream (proxied from remote)
- `DELETE /api/sessions/:id` - Kills session (routes to appropriate remote)

### WebSocket Connections

WebSocket connections for terminal I/O and buffer updates are automatically routed:

- `/ws/input?sessionId=xxx` - Input WebSocket (routed to remote)
- `/ws/buffers` - Buffer updates (aggregated from all remotes)

## Security

### Authentication Flow

1. **Client → HQ**: Standard authentication (Basic Auth or JWT)
2. **HQ → Remote**: Bearer token authentication
3. **Remote → HQ**: Registration uses HQ credentials

### Best Practices

1. **Use HTTPS**: Always use HTTPS in production
   ```bash
   # Good
   --hq-url https://hq.example.com
   
   # Only for local development
   --hq-url http://localhost:4020 --allow-insecure-hq
   ```

2. **Strong Credentials**: Use strong passwords for both HQ and remote servers
   ```bash
   # Generate strong password
   openssl rand -base64 32
   ```

3. **Network Isolation**: Place HQ and remotes on private network
   ```yaml
   # Docker network example
   networks:
     vibetunnel:
       driver: bridge
       internal: true
   ```

4. **Firewall Rules**: Only expose HQ server publicly
   ```bash
   # Example iptables rules
   # Allow HQ port from anywhere
   iptables -A INPUT -p tcp --dport 4020 -j ACCEPT
   
   # Block remote ports from external
   iptables -A INPUT -p tcp --dport 4021:4030 -s 10.0.0.0/8 -j ACCEPT
   iptables -A INPUT -p tcp --dport 4021:4030 -j DROP
   ```

### Bearer Token Security

- Tokens are generated automatically by remote servers
- Each remote has a unique token
- Tokens are never exposed in logs or API responses
- Rotate tokens by restarting remote servers

## Monitoring & Health

### Health Checks

HQ performs health checks every 15 seconds:

```javascript
// Health check implementation
- GET request to remote's /api/health
- 5-second timeout
- Marks unhealthy after 3 consecutive failures
- Automatic recovery when responsive
```

### Metrics

Monitor these key metrics:

1. **Remote Health**
   - Number of healthy/unhealthy remotes
   - Last successful health check time
   - Response times

2. **Session Distribution**
   - Sessions per remote
   - Load balancing effectiveness
   - Failed session creations

3. **Performance**
   - Request routing latency
   - Stream proxy overhead
   - WebSocket connection count

### Logging

Enable debug logging for troubleshooting:

```bash
# HQ Server
vibetunnel-server --hq --debug

# Remote Server
vibetunnel-server --debug --hq-url https://hq.example.com
```

Key log patterns to monitor:
- `remote registered:` - Successful registration
- `remote unregistered:` - Remote disconnection
- `health check failed:` - Connectivity issues
- `forwarding request to remote:` - Request routing

## Troubleshooting

### Common Issues

#### Remote Won't Register

1. **Check connectivity**
   ```bash
   # From remote server
   curl -u hq-admin:hq-secret https://hq.example.com/api/health
   ```

2. **Verify credentials**
   ```bash
   # Test HQ credentials
   curl -u hq-admin:hq-secret https://hq.example.com/api/remotes
   ```

3. **Check logs**
   ```bash
   # HQ logs
   journalctl -u vibetunnel-hq -f
   
   # Remote logs
   journalctl -u vibetunnel-remote -f
   ```

#### Sessions Not Appearing

1. **Verify remote is healthy**
   ```bash
   curl -u admin:password https://hq.example.com/api/remotes
   ```

2. **Check session ownership**
   ```bash
   # Get session details
   curl -u admin:password https://hq.example.com/api/sessions/SESSION_ID
   ```

3. **Test direct remote access**
   ```bash
   # Bypass HQ
   curl -u local:local https://remote1.example.com/api/sessions
   ```

#### Performance Issues

1. **Check network latency**
   ```bash
   # Ping between HQ and remote
   ping -c 10 remote1.example.com
   ```

2. **Monitor resource usage**
   ```bash
   # On HQ server
   htop
   netstat -an | grep ESTABLISHED | wc -l
   ```

3. **Review proxy overhead**
   - Enable debug logging
   - Check request/response times
   - Monitor WebSocket connection count

### Debug Commands

```bash
# Test remote registration manually
curl -X POST https://hq.example.com/api/remotes/register \
  -u hq-admin:hq-secret \
  -H "Content-Type: application/json" \
  -d '{
    "id": "test-uuid",
    "name": "test-remote",
    "url": "https://test.example.com",
    "token": "test-token"
  }'

# Check session routing
curl -u admin:password https://hq.example.com/api/sessions \
  | jq '.[] | {id, source, remoteId}'

# Monitor health checks
watch -n 1 'curl -s -u admin:password https://hq.example.com/api/remotes | jq'
```

## Use Cases

### Multi-Region Deployment

Deploy VibeTunnel servers in different regions:

```yaml
# US East
remote-us-east:
  deploy:
    region: us-east-1
  environment:
    VIBETUNNEL_REMOTE_NAME: us-east-1

# EU West
remote-eu-west:
  deploy:
    region: eu-west-1
  environment:
    VIBETUNNEL_REMOTE_NAME: eu-west-1

# Asia Pacific
remote-ap-southeast:
  deploy:
    region: ap-southeast-1
  environment:
    VIBETUNNEL_REMOTE_NAME: ap-southeast-1
```

### Team Isolation

Separate servers for different teams:

```bash
# Development team server
vibetunnel-server --name dev-team --hq-url https://hq.internal

# QA team server
vibetunnel-server --name qa-team --hq-url https://hq.internal

# Production support server
vibetunnel-server --name prod-support --hq-url https://hq.internal
```

### Load Balancing

Distribute sessions across multiple servers:

```javascript
// Client-side load balancing
async function createSession(command) {
  // Get available remotes
  const remotes = await fetch('/api/remotes').then(r => r.json());
  
  // Find remote with least sessions
  const bestRemote = remotes
    .filter(r => r.healthy)
    .sort((a, b) => a.sessionCount - b.sessionCount)[0];
  
  // Create session on best remote
  return fetch('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({
      command,
      remoteId: bestRemote.id
    })
  });
}
```

### Maintenance Mode

Take servers offline gracefully:

```bash
# 1. Stop accepting new sessions on remote
kill -TERM $REMOTE_PID

# 2. Wait for existing sessions to complete
while curl -s https://remote1/api/sessions | jq length | grep -v "^0$"; do
  sleep 10
done

# 3. Perform maintenance
apt-get update && apt-get upgrade -y

# 4. Restart remote
systemctl start vibetunnel-remote
```

## Advanced Topics

### Custom Remote Selection

Implement custom logic for remote selection:

```typescript
// Example: Geo-based selection
interface RemoteWithLocation extends Remote {
  location: { lat: number; lon: number };
}

function selectNearestRemote(
  userLocation: { lat: number; lon: number },
  remotes: RemoteWithLocation[]
): Remote {
  return remotes
    .filter(r => r.healthy)
    .map(r => ({
      ...r,
      distance: calculateDistance(userLocation, r.location)
    }))
    .sort((a, b) => a.distance - b.distance)[0];
}
```

### Monitoring Integration

Export metrics to monitoring systems:

```javascript
// Prometheus metrics example
app.get('/metrics', async (req, res) => {
  const remotes = await getRemotes();
  const metrics = [
    `# HELP vibetunnel_remotes_total Total number of registered remotes`,
    `# TYPE vibetunnel_remotes_total gauge`,
    `vibetunnel_remotes_total ${remotes.length}`,
    `# HELP vibetunnel_remotes_healthy Number of healthy remotes`,
    `# TYPE vibetunnel_remotes_healthy gauge`,
    `vibetunnel_remotes_healthy ${remotes.filter(r => r.healthy).length}`,
  ];
  
  res.type('text/plain');
  res.send(metrics.join('\n'));
});
```

### Disaster Recovery

Implement automatic failover:

```bash
#!/bin/bash
# Health check and failover script

PRIMARY_HQ="https://hq1.example.com"
BACKUP_HQ="https://hq2.example.com"
CURRENT_HQ=$PRIMARY_HQ

while true; do
  if curl -f -s -u admin:password "$CURRENT_HQ/api/health"; then
    echo "HQ healthy: $CURRENT_HQ"
  else
    echo "HQ unhealthy, switching..."
    if [ "$CURRENT_HQ" = "$PRIMARY_HQ" ]; then
      CURRENT_HQ=$BACKUP_HQ
    else
      CURRENT_HQ=$PRIMARY_HQ
    fi
    
    # Update remote configuration
    systemctl set-environment VIBETUNNEL_HQ_URL=$CURRENT_HQ
    systemctl restart vibetunnel-remote
  fi
  
  sleep 30
done
```

## Summary

HQ mode transforms VibeTunnel into a powerful distributed terminal management system. Key benefits include:

- **Scalability**: Add servers as needed
- **Reliability**: No single point of failure for sessions
- **Flexibility**: Deploy servers anywhere
- **Transparency**: Users get unified experience

Start with a simple HQ + 2 remote setup, then expand based on your needs. Monitor health metrics and implement gradual rollouts for production deployments.