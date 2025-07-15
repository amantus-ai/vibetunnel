# VibeTunnel Keyboard Shortcuts Documentation

## Overview

VibeTunnel provides a dynamic keyboard capture system that allows users to toggle between browser-priority and terminal-priority modes. This document outlines the keyboard capture behavior, which shortcuts are affected, and how to control the capture mode.

## Keyboard Capture Modes

VibeTunnel has two modes controlled by the keyboard capture indicator button:

### Capture Mode ON (Default)
Terminal receives priority for most shortcuts. Browser gets only critical shortcuts.

### Capture Mode OFF  
Browser shortcuts work normally, terminal gets only basic input.

## Keyboard Capture Toggle

**Double-tap Escape** - Toggle between capture modes
- Shows visual feedback when mode changes
- Works from anywhere in the terminal session

## Critical Browser Shortcuts (Always Available)

These shortcuts always pass through to the browser regardless of capture mode:

### Tab and Window Management
- `Ctrl/Cmd + T` - New tab
- `Ctrl/Cmd + W` - Close tab
- `Ctrl/Cmd + N` - New window  
- `Ctrl/Cmd + Shift + T` - Reopen closed tab
- `Ctrl/Cmd + 1-9` - Switch to tab by number
- `Alt/Cmd + Tab` - Switch between windows/applications

### System Functions
- `Ctrl/Cmd + Q` (macOS) / `Ctrl + Shift + Q` (Linux) / `Alt + F4` (Windows) - Quit/close
- `F12` - Developer tools
- `Ctrl/Cmd + Shift + I` - Developer tools
- `Ctrl/Cmd + H` (macOS) - Hide window

### DevTools and Debugging
- `Ctrl/Cmd + Shift + N` - New incognito window

## Captured Shortcuts (When Capture Mode ON)

When keyboard capture is enabled, these shortcuts are sent to the terminal instead of the browser:

### macOS Captured Shortcuts
- `Cmd + A` - Line start (instead of select all)
- `Cmd + E` - Line end  
- `Cmd + R` - History search (instead of reload)
- `Cmd + L` - Clear screen (instead of address bar)
- `Cmd + D` - EOF/Exit (instead of bookmark)
- `Cmd + F` - Forward character (instead of find)
- `Cmd + P` - Previous command (instead of print)
- `Cmd + U` - Delete to start (instead of view source)
- `Cmd + K` - Delete to end (instead of search bar)
- `Option + D` - Delete word forward

### Windows/Linux Captured Shortcuts
- `Ctrl + A` - Line start (instead of select all)
- `Ctrl + E` - Line end
- `Ctrl + R` - History search (instead of reload)
- `Ctrl + L` - Clear screen (instead of address bar)
- `Ctrl + D` - EOF/Exit (instead of bookmark)
- `Ctrl + F` - Forward character (instead of find)
- `Ctrl + P` - Previous command (instead of print)
- `Ctrl + U` - Delete to start (instead of view source)
- `Ctrl + K` - Delete to end (instead of search bar)
- `Alt + D` - Delete word forward

### Universal Terminal Input
- All regular typing (a-z, 0-9, symbols)
- Arrow keys for terminal navigation
- **Alt+Left/Right Arrow** - Word navigation (move cursor by word)
- **Alt+Backspace** - Delete previous word
- `Ctrl+C`, `Ctrl+D`, etc. - Terminal control sequences

### Copy/Paste (Always Available)
- `Ctrl/Cmd + C` - Copy selected text
- `Ctrl/Cmd + V` - Paste text

**Note**: When capture is ON, browser shortcuts like Cmd+W/Ctrl+W are sent to the terminal for word deletion instead of closing the tab.

## Implementation Details

### Key Files
- `web/src/client/components/session-view/input-manager.ts:299-405` - Keyboard capture logic and shortcut detection
- `web/src/client/components/keyboard-capture-indicator.ts` - Capture indicator UI component
- `web/src/client/components/session-view/session-header.ts:225-238` - Header integration
- `web/src/client/app.ts:100-102` - Global capture toggle event handling

### How It Works
1. **Capture Detection**: `isKeyboardShortcut()` determines if a key event should go to browser or terminal
2. **Dynamic Toggle**: Double-tap Escape toggles the capture state via `capture-toggled` events
3. **Visual Feedback**: Keyboard capture indicator shows current state and captured shortcuts
4. **Platform Specific**: Uses `navigator.platform` to apply correct key modifiers (Cmd vs Ctrl)

### Design Philosophy
1. **User Control**: Users can toggle between modes based on their current needs
2. **Critical Safety**: Essential browser shortcuts (new tab, quit, DevTools) always work
3. **Terminal Power**: When enabled, capture provides full terminal editing capabilities
4. **Visual Clarity**: Clear indication of current mode and affected shortcuts

## Testing Capture Behavior

### When Capture Mode ON (Default)
1. **Test captured shortcuts**: Try `Cmd/Ctrl+W` (should delete word, not close tab)
2. **Test critical shortcuts**: Try `Cmd/Ctrl+T` (should open new tab)
3. **Test toggle**: Double-tap Escape to switch modes

### When Capture Mode OFF
1. **Test browser shortcuts**: Try `Cmd/Ctrl+W` (should close tab)
2. **Test terminal input**: Regular typing should still work
3. **Test toggle**: Double-tap Escape to re-enable capture

### Troubleshooting
- If shortcuts don't work as expected, check the keyboard capture indicator state
- Critical shortcuts like `Cmd/Ctrl+T` should always work regardless of capture mode
- Double-tap Escape should toggle between modes with visual confirmation