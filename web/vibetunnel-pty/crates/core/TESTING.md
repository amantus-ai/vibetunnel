# VibeTunnel PTY Core - Testing Documentation

## Overview

This document describes the comprehensive test suite for the `vibetunnel-pty-core` library. The test suite covers all major components with both unit tests and integration tests.

## Test Coverage

### 1. Protocol Module (`protocol.rs`)
- **Message Type Conversions**: Tests for enum values and TryFrom implementations
- **Encoding/Decoding**: Round-trip tests for binary protocol format
- **Edge Cases**: Empty payloads, large payloads (64KB), invalid message types
- **Buffer Handling**: Partial messages, multiple messages in buffer
- **Property-Based Testing**: Using proptest for fuzzing encode/decode operations

### 2. PTY Module (`pty.rs`)
- **Configuration**: Default and custom PTY configurations
- **Process Creation**: Basic PTY creation with various shells and arguments
- **Environment Variables**: Testing custom environment propagation
- **Working Directory**: Testing CWD changes
- **Interactive I/O**: Write/read cycles, multiple commands
- **Terminal Resize**: Dynamic terminal size changes
- **Process Lifecycle**: Child process management and exit codes
- **Signal Handling**: SIGTERM handling on Unix systems

### 3. Session Module (`session.rs`)
- **Serialization**: JSON serialization with camelCase field names
- **Session Store**: CRUD operations on the in-memory store
- **Multiple Sessions**: Concurrent session management
- **Optional Fields**: Handling of None values
- **Trait Implementation**: Verifying the SessionStore trait

### 4. Activity Module (`activity.rs`)
- **Pattern Detection**: Claude CLI activity pattern matching
- **UTF-8 Handling**: Unicode characters and invalid UTF-8
- **Edge Cases**: Empty strings, whitespace, malformed patterns
- **Timestamp Generation**: Ensuring proper timestamp creation
- **Serialization**: Activity struct JSON serialization

### 5. Integration Tests
- **Full PTY Lifecycle**: End-to-end PTY creation, I/O, and termination
- **Protocol Integration**: Using protocol encoding with real PTY output
- **Session Management**: Creating sessions from real PTY processes
- **Activity Detection**: Detecting activities from PTY output
- **Concurrent Operations**: Multiple PTYs running simultaneously
- **Message Streaming**: Processing multiple protocol messages
- **Tokio Runtime**: Testing with async runtime (when CLI feature enabled)

## Running Tests

```bash
# Run all tests
cargo test

# Run specific test module
cargo test protocol
cargo test pty
cargo test session
cargo test activity

# Run integration tests only
cargo test --test integration_tests

# Run with output
cargo test -- --nocapture

# Run with specific feature
cargo test --features cli
```

## Test Dependencies

The following dev-dependencies were added:
- `tokio`: For async runtime testing
- `tempfile`: For temporary directory creation in tests
- `proptest`: For property-based testing
- `rstest`: For parameterized tests (available for future use)

## Test Statistics

- **Total Tests**: 66 tests
  - Unit tests: 58
  - Integration tests: 8
- **Test Categories**:
  - Protocol: 13 unit tests + 3 property tests
  - PTY: 12 unit tests
  - Session: 12 unit tests
  - Activity: 17 unit tests
  - Integration: 8 tests

## Key Testing Patterns

1. **Isolation**: Each test creates its own PTY/session instances
2. **Cleanup**: PTY processes are properly terminated after tests
3. **Timing**: Using thread::sleep for PTY I/O synchronization
4. **Cross-Platform**: Platform-specific tests are conditionally compiled
5. **Property Testing**: Fuzzing critical protocol functions

## Future Improvements

1. Add benchmarks for performance-critical operations
2. Add stress tests for handling many concurrent PTYs
3. Mock system calls for more deterministic PTY tests
4. Add code coverage reporting
5. Test error recovery and edge cases more thoroughly