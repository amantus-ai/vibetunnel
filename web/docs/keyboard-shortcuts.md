# VibeTunnel Keyboard Shortcuts Documentation

## Overview

VibeTunnel respects browser keyboard shortcuts while providing a seamless terminal experience. This document outlines which keyboard shortcuts are handled by the browser, which are captured by VibeTunnel, and the platform-specific considerations.

## Browser Shortcuts (Never Captured)

These shortcuts always pass through to the browser to maintain standard web navigation and functionality:

### Universal Shortcuts (All Platforms)

#### Tab Management
- `Ctrl/Cmd + T` - New tab
- `Ctrl/Cmd + W` - Close tab  
- `Ctrl/Cmd + Shift + T` - Reopen closed tab
- `Ctrl/Cmd + Tab` - Next tab
- `Ctrl/Cmd + Shift + Tab` - Previous tab
- `Ctrl/Cmd + 1-9` - Switch to tab by number

#### Browser Navigation
- `Ctrl/Cmd + R` - Reload page
- `Ctrl/Cmd + Shift + R` or `F5` - Hard reload
- `Ctrl/Cmd + L` - Focus address bar
- `F6` - Focus address bar
- `Alt + D` - Focus address bar

#### Essential Functions
- `Ctrl/Cmd + P` - Print
- `Ctrl/Cmd + S` - Save page
- `Ctrl/Cmd + F` - Find on page
- `Ctrl/Cmd + D` - Bookmark
- `Ctrl/Cmd + H` - History
- `Ctrl/Cmd + J` - Downloads
- `Ctrl/Cmd + Shift + Delete` - Clear browsing data
- `F11` - Fullscreen

### Windows/Linux Specific
- `Alt + F4` - Close window
- `Ctrl + Shift + Q` - Quit browser
- `Ctrl + Shift + N` - New incognito window
- `Ctrl + Page Up/Down` - Tab navigation

### macOS Specific
- `Cmd + Q` - Quit application
- `Cmd + Shift + A` - Chrome tab search
- `Cmd + Option + Left/Right` - Word navigation
- `Cmd + Shift + N` - New incognito window

## VibeTunnel Shortcuts

These shortcuts are captured and handled by VibeTunnel:

### Application Navigation
- `Ctrl/Cmd + O` - Open file browser (only in list view)
- `Ctrl/Cmd + B` - Toggle sidebar
- `Escape` - Close session and return to list view (when not in modal)

### Terminal Shortcuts
When focused in a terminal session, most keyboard input is sent to the terminal, including:
- All regular typing (a-z, 0-9, symbols)
- Arrow keys for terminal navigation
- Terminal-specific shortcuts like `Ctrl+C`, `Ctrl+D`, etc.
- **Alt+Left/Right Arrow** - Word navigation (move cursor by word)
- **Alt+Backspace** - Delete previous word

**Note**: Browser back/forward navigation (Alt+Left/Right) is disabled in the terminal view to prioritize terminal word navigation, which is essential for efficient command-line editing.

## Implementation Details

### Key Files
- `web/src/client/app.ts:160-264` - Main keyboard event handler
- `web/src/client/components/session-view/input-manager.ts` - Terminal input processing
- `web/src/client/components/session-view/lifecycle-event-manager.ts` - Global event routing

### Platform Detection
VibeTunnel detects the user's platform using `navigator.platform` and applies platform-specific shortcut handling to ensure native browser behavior is preserved.

### Design Philosophy
1. **Browser First**: Standard browser shortcuts take precedence over application shortcuts
2. **Terminal Context**: When in a terminal session, keyboard input is primarily routed to the terminal
3. **Escape Hatch**: Users can always use standard browser shortcuts to navigate away or close tabs
4. **Cross-Platform**: Shortcuts work consistently across Windows, Linux, and macOS

## Testing Shortcuts

To test keyboard shortcut behavior:

1. **Browser shortcuts**: Try tab navigation (`Ctrl/Cmd+T`, `Ctrl/Cmd+W`), page reload (`Ctrl/Cmd+R`), and browser navigation (`Alt+Left/Right`)
2. **VibeTunnel shortcuts**: Test sidebar toggle (`Ctrl/Cmd+B`), file browser (`Ctrl/Cmd+O` in list view), and escape navigation
3. **Terminal input**: Verify that regular typing and terminal shortcuts work as expected when focused in a session

## Future Considerations

- User-configurable shortcut preferences
- Additional application-specific shortcuts for common actions
- Accessibility shortcut support
- Visual indicators for available shortcuts