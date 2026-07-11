# Native Forwarder

`vibetunnel-fwd` is VibeTunnel's per-session native process. The `vt` wrapper launches it around a command; the web server watches the resulting session artifacts and sends control messages over a Unix socket.

```text
vt -> vibetunnel-fwd -> PTY -> child command
                    -> session files and ipc.sock <- web server
```

The implementation is a Rust crate in `native/vt-fwd`. It supports macOS and Linux; Windows is not supported.

## Session Contract

Each session uses `~/.vibetunnel/control/<session-id>/` by default. `VIBETUNNEL_CONTROL_DIR` overrides the control root.

- `session.json` contains the current `SessionInfo` state.
- `stdout` is an asciinema v2 stream with output, input, resize, and exit records.
- `stdin` is a private FIFO kept for compatibility.
- `ipc.sock` accepts live input and control commands and is removed when the forwarder exits.

The session JSON schema is defined in `web/src/shared/types.ts`. The forwarder creates private directories and artifacts so session contents are not readable by other local users.

## IPC Contract

Frames use one byte for the message type, a four-byte big-endian payload length, and the payload. `STDIN_DATA` payloads are raw bytes; `CONTROL_CMD` payloads are JSON. The command set includes resize, kill, reset-size, and update-title. Heartbeat frames are echoed.

The server-side framing helpers are in `web/src/server/pty/socket-protocol.ts`. The forwarder independently enforces a 1 MiB inbound payload limit in `native/vt-fwd/src/control_socket.rs`; an oversized frame closes only the offending connection. Unknown message types are ignored.

## CLI Contract

The forwarder accepts a command after its options:

```text
vibetunnel-fwd [--session-id <id>] [--title-mode <mode>] [--verbosity <level>] <command> [args...]
```

`--update-title` updates an existing session and exits. Title modes are `none`, `filter`, and `static`. The wrapper also passes `VIBETUNNEL_SESSION_ID`, `VIBETUNNEL_TITLE_MODE`, `VIBETUNNEL_LOG_LEVEL`, and an optional `VIBETUNNEL_CONTROL_DIR`.

## Build and Test

Install rustup; `native/vt-fwd/rust-toolchain.toml` selects Rust 1.97.0 and the required rustfmt and Clippy components. `native/vt-fwd/Cargo.lock` pins crate dependencies.

```bash
cd native/vt-fwd
cargo fmt --all -- --check
cargo clippy --all-targets --all-features --locked -- -D warnings
cargo test --all-targets --locked
cargo build --release --locked
python3 test/e2e.py target/release/vibetunnel-fwd
```

The release binary is `native/vt-fwd/target/release/vibetunnel-fwd`. `node web/scripts/build-fwd-rust.js` builds and installs the host binary for web and macOS packaging; the npm build creates platform-specific forwarder directories.
