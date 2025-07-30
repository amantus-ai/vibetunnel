# VibeTunnel Native PTY

Native Rust implementation of PTY functionality with activity detection for VibeTunnel.

## Building

```bash
# Install dependencies and build
npm install
npm run build

# Build in release mode
npm run build:release
```

## Testing

Due to the NAPI bindings, the Rust tests require special handling:

### Unit Tests in lib.rs

Basic unit tests can be run directly:

```bash
cargo test --lib
```

### Integration Tests via Node.js

Full integration tests need to be run through Node.js:

```bash
# Build the native module first
npm run build

# Run Node.js tests that exercise the native module
npm test
```

### Performance Benchmarks

```bash
# Benchmarks can be adapted to run through Node.js
# See benchmarks/ directory for examples
```

## Features

- **PTY Management**: Cross-platform terminal emulation
- **Activity Detection**: Real-time detection of Claude CLI status messages
- **Event-driven I/O**: Efficient callback-based data handling
- **Binary Safety**: Handles binary data and invalid UTF-8
- **Resource Management**: Automatic cleanup of PTY resources

## API

### NativePty

```rust
// Create a new PTY
let pty = NativePty::new(
    shell: Option<String>,      // Shell command (defaults to system shell)
    args: Option<Vec<String>>,  // Command arguments
    env: Option<HashMap<String, String>>, // Environment variables
    cwd: Option<String>,        // Working directory
    cols: Option<u16>,          // Terminal columns
    rows: Option<u16>,          // Terminal rows
)?;

// Write data
pty.write(data: Buffer)?;

// Read output (polling)
pty.read_output(timeout_ms: Option<u32>)?;
pty.read_all_output()?;

// Event-driven (recommended)
pty.set_on_data(callback: JsFunction)?;

// Terminal operations
pty.resize(cols: u16, rows: u16)?;
pty.kill(signal: Option<String>)?;
pty.check_exit_status()?;
pty.destroy()?;
```

### ActivityDetector

```rust
// Create detector
let detector = ActivityDetector::new()?;

// Detect Claude activity in data
let activity = detector.detect(data: Buffer);
// Returns Activity { timestamp, status, details }
```

## Activity Pattern Examples

The ActivityDetector recognizes Claude CLI status patterns:

- `✻ Crafting… (205s · ↑ 6.0k tokens · esc to interrupt)`
- `⏺ Calculating… (0s)`
- `✳ Measuring… (120s · ⚒ 671 tokens · esc to interrupt)`

## Platform Support

- **macOS**: Full support
- **Linux**: Full support
- **Windows**: Full support (uses cmd.exe/PowerShell)

## Development

### Adding Tests

Due to NAPI constraints, tests should be written as:
1. Basic unit tests in `#[cfg(test)]` modules in lib.rs
2. Integration tests in JavaScript/TypeScript that load the built module
3. Consider creating a separate pure-Rust testing harness for complex scenarios

### Debugging

Enable debug logging:
```bash
RUST_LOG=debug npm run build
```

## License

Part of VibeTunnel project.