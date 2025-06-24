# VibeTunnel macOS Frontend

A native macOS frontend for VibeTunnel with complete feature parity to the web interface, built with SwiftUI and Swift 6 for macOS 15+.

## Features

- ✅ **Session Management**: Create, view, and manage terminal sessions
- ✅ **Native Terminal View**: Built-in terminal emulator with full keyboard support
- ✅ **File Browser**: Browse and select directories with git status integration
- ✅ **Real-time Updates**: Auto-refresh session status every 3 seconds
- ✅ **macOS Integration**: Native UI following macOS design patterns
- ✅ **Keyboard Shortcuts**: Comprehensive shortcuts for power users
- ✅ **Settings**: Customizable terminal font size, column width, and more

## Building

```bash
cd mac-frontend
swift build
```

## Running

```bash
swift run
```

## Usage

1. **First Launch**: Connect to your VibeTunnel server (default: http://localhost:5173)
2. **Create Session**: Click "New Session" or press Cmd+N
3. **Manage Sessions**: View all sessions in the grid, click to open terminal
4. **File Browser**: Press Cmd+O in terminal to browse and insert file paths
5. **Settings**: Configure terminal preferences and connection settings

## Architecture

The app follows modern Swift patterns:
- `@Observable` for state management (no ViewModels)
- Environment injection for shared managers
- Native SwiftUI views with AppKit integration where needed
- Async/await for all networking

## Key Components

- **ConnectionManager**: Handles server connection and persistence
- **SessionManager**: Manages session lifecycle and auto-refresh
- **TerminalManager**: Handles terminal I/O and SSE streaming
- **NavigationManager**: Manages deep linking and navigation state

## Keyboard Shortcuts

- `Cmd+N`: New session
- `Cmd+O`: Open file browser (in terminal)
- `Cmd+K`: Clear terminal (in terminal dropdown menu)
- `Cmd+Shift+K`: Kill all sessions
- `Cmd+,`: Open settings
- `Cmd+C`: Copy selected text
- `Cmd+V`: Paste into terminal
- `Escape`: Close modals/navigate back

## Project Status

### ✅ **Complete Feature Parity + Production Ready!**

The macOS frontend has achieved complete feature parity with the web interface and is now production-ready with additional polish:

**Core Features:**
- ✅ Server connection with auth support
- ✅ Session list with real-time updates
- ✅ Multiple terminal renderers (Native, xterm.js, SwiftTerm)
- ✅ Full ANSI color support
- ✅ WebSocket support for binary protocol
- ✅ SSE fallback for compatibility
- ✅ **Live terminal thumbnails with binary protocol**
- ✅ Real-time activity indicators on session cards

**Session Management:**
- ✅ Create, view, and kill sessions
- ✅ Multi-window support (open sessions in new windows)
- ✅ Context menus for quick actions
- ✅ Search and filtering
- ✅ Bulk operations

**Terminal Features:**
- ✅ Full keyboard input support
- ✅ Terminal resizing with column constraints
- ✅ **Terminal width selector with presets (80, 100, 120, 160 cols)**
- ✅ **Dynamic font size adjustment controls**
- ✅ **Terminal dimensions display (cols × rows)**
- ✅ **Enhanced copy/paste support with context menu**
- ✅ Terminal snapshots
- ✅ Export terminal output as text

**File Browser:**
- ✅ Browse directories with native file picker
- ✅ **Cmd+O keyboard shortcut for quick access**
- ✅ Git status integration
- ✅ Git diff viewer for modified files
- ✅ Path insertion into terminal
- ✅ File preview support

**Additional Features:**
- ✅ Real log viewer with API integration
- ✅ Comprehensive keyboard shortcuts
- ✅ Settings and preferences
- ✅ Dark theme throughout
- ✅ macOS native UI patterns

### Additional Polish (Completed)

**Code Quality:**
- ✅ SwiftLint integration with custom rules
- ✅ All critical linting issues resolved
- ✅ Proper error handling for edge cases
- ✅ Network error recovery and retry logic

**Performance:**
- ✅ Optimized for large terminal outputs (500KB buffer)
- ✅ Intelligent truncation with newline boundaries  
- ✅ Batched updates for smooth rendering
- ✅ Thread-safe buffer management

**Testing:**
- ✅ Unit tests for core functionality
- ✅ ANSI parser tests with color/style validation
- ✅ Session model tests
- ✅ Connection manager tests
- ✅ All tests passing (16/16)

**Assets:**
- ✅ App icon configuration ready
- ✅ Info.plist with proper app configuration
- ✅ Developer Tools category set

## Building & Running

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

## Architecture Highlights

- **Swift 6** with strict concurrency checking
- **@Observable** state management (no ViewModels)
- **Actor isolation** for thread safety
- **Structured concurrency** with async/await
- **Performance optimized** for large outputs
- **Comprehensive error handling** with recovery

## Latest Updates

### 🚀 Enhanced Feature Set (Just Completed!)

Building on the already complete feature parity, we've added these additional enhancements:

**Terminal Enhancements:**
- ✅ **URL Detection & Click-to-Open** - Automatically detect and highlight URLs in terminal output
- ✅ **Terminal Width Presets** - Quick access to common terminal widths (80, 100, 120, 160 columns)
- ✅ **Dynamic Font Size Controls** - Increase/decrease font size with toolbar buttons
- ✅ **Clear Terminal** - Clear terminal buffer with Cmd+K menu option
- ✅ **Enhanced Copy/Paste** - Right-click context menu and improved clipboard support

**Session Management:**
- ✅ **Kill All Sessions** - Quickly terminate all running sessions with Cmd+Shift+K
- ✅ **Clean Up Exited Sessions** - Remove all exited sessions from the list with one click

**UI Improvements:**
- ✅ **Terminal Dimensions Display** - Always visible cols×rows indicator in toolbar
- ✅ **Cmd+O File Browser Shortcut** - Quick keyboard access to file browser

## Future Enhancements

With enhanced feature parity achieved and production polish complete, potential future enhancements:
- Terminal recording/playback
- Advanced git integration (blame, log, etc.)
- Terminal tabs within windows
- Custom theme editor
- Plugin system for extensions
- Cloud sync for settings