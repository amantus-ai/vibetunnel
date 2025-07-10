# Native PTY Rust Tests

This directory contains comprehensive tests for the VibeTunnel native PTY Rust addon.

## Test Coverage

### Activity Detector Tests (`activity_detector.rs`)
- Pattern matching for various Claude CLI status formats
- ANSI escape code handling
- Edge cases (partial buffers, invalid UTF-8, large inputs)
- Performance with large buffers
- Multiple status detection

### Basic PTY Tests (`pty_basic.rs`)
- PTY creation with different configurations
- Shell spawning (bash, sh, cmd.exe)
- Environment variables and working directory
- Process lifecycle (spawn, kill, exit status)
- Resource cleanup

### PTY I/O Tests (`pty_io.rs`)
- Read/write operations
- Binary data handling
- Concurrent I/O
- Buffer management and backpressure
- Timeout handling

### Integration Tests (`integration.rs`)
- End-to-end activity detection through PTY
- Streaming detection
- Multiple concurrent sessions
- Real-world scenarios with mixed output

## Running Tests

```bash
# Run all tests
cargo test

# Run specific test file
cargo test --test activity_detector
cargo test --test pty_basic
cargo test --test pty_io
cargo test --test integration

# Run with output
cargo test -- --nocapture

# Run single test
cargo test test_activity_detection_patterns
```

## Running Benchmarks

```bash
# Run benchmarks
cargo bench

# Run specific benchmark
cargo bench activity_detector

# Generate HTML report
cargo bench -- --save-baseline base
```

## Test Utilities

The tests use several helper functions:
- `str_to_buffer()` - Convert strings to NAPI Buffers
- Test fixtures for various Claude status formats
- Cross-platform command handling (Windows/Unix)

## Platform-Specific Tests

Some tests behave differently on Windows vs Unix:
- Shell commands (`cmd.exe` vs `sh`)
- Signal handling (Windows doesn't support Unix signals)
- Path separators and file permissions

## Known Limitations

1. **Event Callbacks**: The `set_on_data` callback tests require JavaScript runtime and are tested through integration tests in the parent project.

2. **Process Signals**: Windows signal handling is limited compared to Unix.

3. **Timing**: Some tests use sleep() which may be flaky on heavily loaded systems.

## Adding New Tests

When adding tests:
1. Use descriptive test names
2. Add platform-specific handling where needed
3. Clean up resources (call `destroy()` on PTY instances)
4. Use `test-case` for parameterized tests
5. Add benchmarks for performance-critical code