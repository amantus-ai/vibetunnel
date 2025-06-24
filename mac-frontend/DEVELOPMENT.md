# VibeTunnel macOS Frontend Development Guide

## Project Setup

This is a native macOS application built with SwiftUI and Swift 6, targeting macOS 15+.

### Prerequisites
- Xcode 15 or later
- macOS 15 (Sequoia) or later
- Swift 6.0 or later

### Building the Project

```bash
# Development build
swift build

# Release build
swift build -c release

# Run tests
swift test

# Run the app
swift run
```

## Architecture

The app follows modern Swift patterns with strict concurrency:

### State Management
- Uses `@Observable` macro for reactive state (no ViewModels)
- Environment injection for shared managers
- `@MainActor` isolation for UI-related code

### Core Managers

#### ConnectionManager
- Handles server connection and authentication
- Persists connection settings in UserDefaults
- Validates server URLs and handles errors

#### SessionManager
- Manages session lifecycle and auto-refresh
- Filters and sorts sessions
- Handles bulk operations (kill all, cleanup)

#### TerminalManager
- Manages terminal I/O for individual sessions
- Supports both SSE and WebSocket connections
- Handles terminal resizing and special messages

#### NavigationManager
- Manages deep linking and navigation state
- Handles window management for multi-window support

## Key Features

### Terminal Rendering
The app supports three terminal renderers:
1. **Native** - Custom NSTextView-based renderer with ANSI support
2. **SwiftTerm** - Uses SwiftTerm library (currently falls back to Native)
3. **xterm.js** - WebView-based renderer using xterm.js

### Binary Protocol
Implements the VibeTunnel binary protocol for efficient terminal updates:
- Magic byte verification (0xBF)
- Session ID extraction
- Cell-by-cell terminal buffer decoding
- Live thumbnail generation for session cards

### URL Detection
- Automatic URL detection in terminal output
- Click-to-open functionality
- Regex-based pattern matching

### Session Management
- Real-time session status updates
- Bulk operations with confirmation dialogs
- Search and filtering capabilities
- Activity indicators for content changes

## Testing

The project includes comprehensive unit tests:
- ANSI parser tests
- Session model tests  
- Connection manager tests
- All tests use Swift Testing framework

Run tests with:
```bash
swift test
```

## Performance Optimizations

### Terminal Output
- Maximum buffer size of 500KB
- Intelligent truncation at newline boundaries
- Batched updates for smooth rendering

### Binary Protocol
- Efficient cell encoding/decoding
- Minimal memory allocation
- Reusable buffer objects

### UI Updates
- Debounced search with 300ms delay
- Animation throttling
- Lazy grid rendering for session cards

## Debugging

### Debug Mode
Enable debug logging by setting environment variables:
```bash
LOG_LEVEL=debug swift run
```

### Common Issues

1. **Connection failures**: Check server URL format (must include http:// or https://)
2. **Terminal rendering issues**: Try switching renderers in settings
3. **Performance issues**: Check terminal buffer size in TerminalManager

## Code Style

- Follow Swift API Design Guidelines
- Use descriptive variable names
- Keep functions focused and small
- Add comments for complex logic
- Use `// MARK: -` for section organization

## Contributing

1. Create a feature branch
2. Write tests for new functionality
3. Ensure all tests pass
4. Run SwiftLint (if configured)
5. Submit a pull request

## Resources

- [Swift Documentation](https://docs.swift.org)
- [SwiftUI Documentation](https://developer.apple.com/documentation/swiftui)
- [VibeTunnel API Documentation](../docs/API.md)