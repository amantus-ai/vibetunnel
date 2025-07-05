# VibeTunnel WebSocket Architecture Analysis

## Current WebSocket Connections

VibeTunnel currently uses **three distinct WebSocket connections**, each serving a specific purpose:

### 1. **Buffer Updates WebSocket** (`/buffers`)
- **Purpose**: Streams terminal buffer updates to clients
- **Protocol**: Binary protocol with magic byte (0xbf)
- **Authentication**: Token-based via query parameter
- **Direction**: Server → Client (one-way)
- **Data Format**: 
  - Binary encoded terminal snapshots
  - Contains cols, rows, cursor position, cell data
- **Usage Pattern**: One connection per client, multiple session subscriptions
- **Implementation**:
  - Server: `BufferAggregator` class
  - Client: `BufferSubscriptionService` class

### 2. **Input WebSocket** (`/ws/input`)
- **Purpose**: Low-latency keyboard/mouse input transmission
- **Protocol**: Raw text with special key markers
- **Authentication**: Token-based via query parameter
- **Direction**: Client → Server (one-way)
- **Data Format**:
  - Regular text: sent as-is
  - Special keys: wrapped in null bytes (`\x00key\x00`)
- **Usage Pattern**: One connection per terminal session
- **Implementation**:
  - Server: `WebSocketInputHandler` class
  - Client: `WebSocketInputClient` class

### 3. **Screencap Signal WebSocket** (`/ws/screencap-signal`)
- **Purpose**: WebRTC signaling for screen capture
- **Protocol**: JSON messages
- **Authentication**: Token-based (inherited from main auth)
- **Direction**: Bidirectional
- **Message Types**:
  - `mac-ready`: Mac app announces availability
  - `start-capture`: Browser requests capture
  - `offer`/`answer`: WebRTC negotiation
  - `ice-candidate`: ICE candidate exchange
  - `error`: Error notifications
- **Usage Pattern**: Hub model - one Mac peer, multiple browser peers
- **Implementation**:
  - Server: `ScreencapSignalHandler` class
  - Client: Direct WebSocket in `screencap-view.ts`

## Authentication Methods

All WebSockets use the same authentication middleware:
- **Primary**: JWT token passed as query parameter (`?token=...`)
- **Fallback**: Bearer token for remote servers
- **No-auth mode**: When server runs with `--no-auth`
- **Local bypass**: Optional localhost authentication bypass

## Key Design Decisions

### Why Separate WebSockets?

1. **Separation of Concerns**
   - Each WebSocket handles a specific data type
   - Different performance requirements (binary vs text)
   - Independent scaling and optimization

2. **Protocol Optimization**
   - Buffer updates use efficient binary protocol
   - Input uses minimal text protocol for lowest latency
   - Signaling uses JSON for flexibility

3. **Connection Management**
   - Buffer WebSocket persists across sessions
   - Input WebSocket is session-specific
   - Signal WebSocket is ephemeral (only during screen sharing)

## Screencap Integration Recommendations

Based on the current architecture, here are the options for screencap:

### Option 1: Reuse Existing Signal WebSocket (Recommended)
- **Pros**:
  - Already authenticated and established
  - Designed for screencap communication
  - Supports multiple message types
  - Existing infrastructure
- **Cons**:
  - Currently focused on WebRTC signaling
  - Would need to extend message types

### Option 2: Create New Dedicated WebSocket
- **Pros**:
  - Complete separation of concerns
  - Can optimize specifically for screencap data
  - No risk of interfering with WebRTC
- **Cons**:
  - Additional connection overhead
  - More complex client management
  - Duplicates authentication logic

### Option 3: Hybrid Approach
- Use signal WebSocket for control messages
- Use a separate data channel for high-frequency updates
- Similar to how terminal uses separate input/output channels

## Recommended Implementation

**Use the existing screencap signal WebSocket** with extended message types:

```typescript
// Extend existing message types
interface SignalMessage {
  type: 'start-capture' | 'offer' | 'answer' | 'ice-candidate' | 'error' | 'ready' | 'mac-ready' |
        // New message types for screencap
        'capture-started' | 'capture-stopped' | 'capture-error' |
        'frame-ready' | 'stats-update' | 'config-update';
  // ... existing fields
}
```

This approach:
- Leverages existing authentication and connection management
- Maintains separation between WebRTC signaling and other screencap messages
- Allows future expansion without breaking changes
- Keeps all screencap-related communication in one place

## Connection Flow

```
Browser                    Server                      Mac App
   |                         |                            |
   |-- Connect /ws/screencap-signal -->|                 |
   |<-- ready ----------------|                           |
   |                         |<-- Connect /ws/screencap-signal --|
   |                         |-- mac-ready -------------->|
   |-- start-capture ------->|                           |
   |                         |-- start-capture --------->|
   |                         |<-- offer -----------------|
   |<-- offer ---------------|                           |
   |-- answer -------------->|                           |
   |                         |-- answer --------------->|
   |<-- ICE candidates ----->|<-- ICE candidates ------>|
   |                         |                           |
   |<===== WebRTC P2P Connection Established ==========>|
```

## Security Considerations

1. **Authentication**: All WebSockets share the same auth middleware
2. **Token Validation**: Tokens are validated on connection establishment
3. **Message Validation**: Each handler validates message format
4. **Connection Limits**: Consider implementing per-user connection limits
5. **Rate Limiting**: Important for input and signaling messages

## Performance Considerations

1. **Binary vs Text**: Buffer updates use binary for efficiency
2. **Message Size**: Keep signaling messages small
3. **Reconnection**: All WebSockets implement auto-reconnect
4. **Compression**: WebSocket compression is available but not always beneficial
5. **Multiplexing**: Buffer WebSocket multiplexes multiple sessions efficiently