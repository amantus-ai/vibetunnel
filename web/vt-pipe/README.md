# vt-pipe

A lightweight Rust binary for forwarding terminal sessions to VibeTunnel with minimal memory overhead.

## Overview

vt-pipe is a memory-efficient replacement for the Node.js-based terminal forwarder. It provides the same functionality while using 96% less memory (~3MB vs ~75MB per session).

## Features

- **Lightweight**: Only 772KB binary size, ~3MB memory usage
- **Fast**: Native Rust performance with zero-copy I/O
- **Compatible**: Drop-in replacement for `vibetunnel fwd`
- **Feature-complete**: Supports resize, title updates, raw mode, and more

## Usage

vt-pipe is automatically invoked by the `vt` command:

```bash
# Run a command through VibeTunnel
vt ls -la

# Launch an interactive shell
vt

# Update session title (inside a session)
vt title "My Session"
```

### Direct Usage

```bash
# Forward a command
vt-pipe command args...

# With title mode
vt-pipe --title-mode dynamic command args...

# Update title of existing session
vt-pipe fwd --update-title "New Title" --session-id SESSION_ID
```

## Architecture

```
Terminal Input → vt-pipe → PTY Process
     ↓                         ↓
Unix Socket ← Binary Protocol ← PTY Output
     ↓
VibeTunnel Server
```

## Protocol

vt-pipe communicates with VibeTunnel using a binary protocol over Unix sockets:

- **Message Types**: StdinData, ControlCmd, StatusUpdate, StdoutData
- **Frame Format**: [1 byte type][4 bytes length][N bytes payload]
- **Control Commands**: resize, update-title, kill

## Building

```bash
cd web/vt-pipe
cargo build --release
```

The release build is optimized for size with:
- Link-time optimization (LTO)
- Symbol stripping
- Size optimization (`opt-level = "z"`)
- Single codegen unit

## Integration

vt-pipe is built automatically during the VibeTunnel Mac app build process and distributed as part of the app bundle at `VibeTunnel.app/Contents/Resources/vt-pipe`.

## Memory Comparison

| Component | Memory Usage | Binary Size |
|-----------|-------------|-------------|
| Node.js forwarder | ~75MB | ~110MB (includes Node) |
| vt-pipe | ~3MB | 772KB |
| **Savings** | **96%** | **99.3%** |

## Implementation Details

- Uses `portable-pty` for cross-platform PTY handling
- Tokio async runtime for efficient I/O
- Unix domain sockets for IPC
- Supports all standard terminal operations (resize, raw mode, etc.)

## Future Improvements

- Profile-guided optimization for even smaller binaries
- WebAssembly support for browser-based forwarding
- Built-in compression for remote sessions