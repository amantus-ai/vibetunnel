# VibeTunnel Keyboard Shortcuts

VibeTunnel provides a comprehensive set of keyboard shortcuts for efficient terminal session management. The app intelligently handles keyboard input to balance browser functionality with terminal control.

## Keyboard Capture Modes

VibeTunnel operates in two keyboard capture modes:

### 1. **Capture Active** (Default)
- Most keyboard shortcuts are sent to the terminal
- Critical browser shortcuts remain functional
- Indicated by the keyboard icon in the session header

### 2. **Capture Disabled**
- Browser shortcuts take precedence
- Terminal receives only typed text
- Toggle with double-press Escape

## Toggling Keyboard Capture

| Action | Description |
|--------|-------------|
| **Double Escape** | Toggle keyboard capture on/off |

Press Escape twice within 500ms to toggle between capture modes.

## Critical Browser Shortcuts (Always Available)

These shortcuts always work, regardless of keyboard capture state:

### Tab Management
| macOS | Windows/Linux | Action |
|-------|---------------|--------|
| ⌘T | Ctrl+T | New tab |
| ⌘W | Ctrl+W | Close tab |
| ⌘⇧T | Ctrl+Shift+T | Reopen closed tab |
| ⌘1-9 | Ctrl+1-9 | Switch to tab 1-9 |
| ⌘0 | Ctrl+0 | Switch to last tab |

### Window Management
| macOS | Windows/Linux | Action |
|-------|---------------|--------|
| ⌘N | Ctrl+N | New window |
| ⌘⇧N | Ctrl+Shift+N | New incognito window |
| ⌘Q | Ctrl+Q | Quit browser |
| ⌘H | - | Hide window (macOS) |
| - | Alt+F4 | Close window (Windows) |

### Essential Operations
| macOS | Windows/Linux | Action |
|-------|---------------|--------|
| ⌘C | Ctrl+C | Copy |
| ⌘V | Ctrl+V | Paste |
| ⌘A | Ctrl+A | Select all* |
| ⌘, | - | Preferences (macOS) |

*When capture is active, ⌘A/Ctrl+A goes to terminal (moves cursor to line start)

### Developer Tools
| macOS | Windows/Linux | Action |
|-------|---------------|--------|
| F12 | F12 | Open DevTools |
| ⌘⌥I | Ctrl+Shift+I | Open DevTools |

## VibeTunnel-Specific Shortcuts

### Navigation
| macOS | Windows/Linux | Action | Context |
|-------|---------------|--------|---------|
| ⌘K | Ctrl+K | Create new session | Any view |
| ⌘O | Ctrl+O | Browse files | List view |
| ⌘B | Ctrl+B | Toggle sidebar | Any view |
| Escape | Escape | Return to list | Session/File browser |

## Terminal Shortcuts (When Capture Active)

When keyboard capture is active, these shortcuts are sent to the terminal:

### Cursor Movement
| macOS | Windows/Linux | Terminal Action |
|-------|---------------|-----------------|
| ⌘A | Ctrl+A | Move to line start |
| ⌘E | Ctrl+E | Move to line end |
| ⌥← | Alt+Left | Move word backward |
| ⌥→ | Alt+Right | Move word forward |

### Text Editing
| macOS | Windows/Linux | Terminal Action |
|-------|---------------|-----------------|
| ⌘W | Ctrl+W | Delete word backward |
| ⌘U | Ctrl+U | Delete to line start |
| ⌘K | Ctrl+K | Delete to line end |
| ⌥⌫ | Alt+Backspace | Delete word backward |
| ⌥D | Alt+D | Delete word forward |

### History & Search
| macOS | Windows/Linux | Terminal Action |
|-------|---------------|-----------------|
| ⌘R | Ctrl+R | Reverse history search |
| ⌘P | Ctrl+P | Previous command |
| ⌘N | Ctrl+N | Next command |

### Terminal Control
| macOS | Windows/Linux | Terminal Action |
|-------|---------------|-----------------|
| ⌘L | Ctrl+L | Clear screen |
| ⌘D | Ctrl+D | EOF/Exit |
| ⌘C | Ctrl+C | Interrupt process |
| ⌘Z | Ctrl+Z | Suspend process |

## Shortcuts Behavior by Capture State

### When Capture is Active ✅
These shortcuts go to the terminal:
- Text editing (⌘A, ⌘E, ⌘W, ⌘K, ⌘U)
- Navigation (⌘F, ⌘B for forward/backward char)
- Terminal control (⌘L, ⌘D, ⌘R)

### When Capture is Disabled ❌
These shortcuts perform browser actions:
- ⌘F/Ctrl+F - Find in page
- ⌘L/Ctrl+L - Focus address bar
- ⌘D/Ctrl+D - Bookmark page
- ⌘P/Ctrl+P - Print
- ⌘S/Ctrl+S - Save page

## Special Key Handling

### Modified Enter Key
| Combination | Terminal Receives |
|-------------|-------------------|
| Enter | Standard return |
| Ctrl+Enter | Special control sequence |
| Shift+Enter | Special shift sequence |

### Function Keys
- F1-F12 are sent to the terminal when capture is active
- F5 (Refresh) works in browser when capture is disabled
- F11 (Fullscreen) always works

## Platform Differences

### macOS
- Uses ⌘ (Command) as primary modifier
- ⌥ (Option) for word navigation
- Additional shortcuts like ⌘H (Hide), ⌘M (Minimize)

### Windows/Linux
- Uses Ctrl as primary modifier
- Alt for word navigation
- Alt+F4 closes windows

## Tips

1. **Double-tap Escape** to quickly toggle between terminal and browser shortcuts
2. **Critical shortcuts** (new tab, close tab, copy/paste) always work
3. **Tab switching** (⌘1-9, ⌘0) always works for quick navigation
4. When unsure, check the keyboard icon in the session header to see capture state

## Troubleshooting

### Shortcuts not working as expected?

1. **Check keyboard capture state** - Look for the keyboard icon in the session header
2. **Try double-escape** - Toggle capture mode on/off
3. **Browser shortcuts in terminal?** - Ensure keyboard capture is active
4. **Terminal shortcuts in browser?** - Disable keyboard capture with double-escape

### Copy/Paste issues?

- Standard copy/paste (⌘C/⌘V or Ctrl+C/Ctrl+V) always works
- For terminal copy mode, use the terminal's built-in shortcuts
- Right-click context menu is always available

## Implementation Details

The keyboard shortcut system is implemented in:
- `web/src/client/utils/browser-shortcuts.ts` - Centralized shortcut detection
- `web/src/client/components/session-view/input-manager.ts` - Terminal input handling
- `web/src/client/app.ts` - Application-level shortcut handling

The system uses a priority-based approach:
1. Critical browser shortcuts (highest priority)
2. VibeTunnel app shortcuts
3. Terminal shortcuts (when capture active)
4. Browser defaults (when capture disabled)