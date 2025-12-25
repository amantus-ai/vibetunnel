# WebSocket v3 (Unified Ghostty Transport)

Single WebSocket. Multiplexed sessions. Binary framing. Same protocol for web + iOS.

## Endpoint
- `GET /ws` (WebSocket upgrade)
- Auth:
  - normal: `?token=...`
  - `--no-auth`: token optional

## Framing (binary)
```
u16  magic = 0x5654   // "VT" LE
u8   version = 3
u8   type
u32  sessionIdLenLE
u8[] sessionId (UTF-8, may be empty)
u32  payloadLenLE
u8[] payload
```
Source of truth: `web/src/shared/ws-v3.ts`.

## Message types (v3)
IDs: `WsV3MessageType` in `web/src/shared/ws-v3.ts`.

Client → Server:
- `SUBSCRIBE` payload = `encodeWsV3SubscribePayload({ flags, snapshotMinIntervalMs, snapshotMaxIntervalMs })`
  - `sessionId` may be empty (`""`) to subscribe to global `EVENT` frames (no per-session STDOUT/snapshots).
- `UNSUBSCRIBE` payload empty
- `INPUT_TEXT` payload = UTF-8 text bytes (includes escape sequences when needed)
- `INPUT_KEY` payload = UTF-8 key name (`SpecialKey`)
- `RESIZE` payload = `u32 colsLE` + `u32 rowsLE`
- `KILL` payload = UTF-8 signal (default `SIGTERM`)
- `RESET_SIZE` payload empty
- `PING` payload optional

Server → Client:
- `WELCOME` payload = JSON `{ ok: true, version: 3 }`
- `STDOUT` payload = UTF-8 bytes from PTY (asciinema “o” frames’ data)
- `SNAPSHOT_VT` payload = VT snapshot bytes (see next section)
- `EVENT` payload = JSON
  - per-session: `exit`, `git-status-update`, …
  - global (`sessionId == ""`): `connected`, `test-notification`, …
- `ERROR` payload = JSON `{ message: string }`
- `PONG` payload optional

## Subscribe flags
`WsV3SubscribeFlags` in `web/src/shared/ws-v3.ts`:
- `Stdout` (bit 0)
- `Snapshots` (bit 1)
- `Events` (bit 2)

## Snapshot payload (`SNAPSHOT_VT`)
Payload is the existing **VT snapshot v1** byte format (magic `VT`, version `1`).
- Used for:
  - session list previews/thumbnails (server-rendered)
  - optional “hard resync” for interactive clients
- Encoder: `TerminalManager` (server-side Ghostty emulation)

## Implementation map
- Server hub: `web/src/server/services/ws-v3-hub.ts`
- Stdout source: `web/src/server/services/cast-output-hub.ts` (tails cast + pruning via `lastClearOffset`)
- Git events: `web/src/server/services/git-status-hub.ts`
- Web client transport: `web/src/client/services/terminal-socket-client.ts`
- iOS transport: `ios/VibeTunnel/Services/BufferWebSocketClient.swift`

## HQ mode
HQ uses the same `/ws` v3 frames.
- HQ keeps one upstream WS per remote.
- Downstream subscriptions aggregate flags per session and fan out frames to clients.

## Removed legacy transports
- `/buffers` (v2 `0xBF` framing)
- `/ws/input`

Still available:
- `/api/sessions/:id/text` (plain-text rendering of the current terminal buffer)
