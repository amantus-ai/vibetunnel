# VibeTunnel CJK IME Input Implementation

## Overview

VibeTunnel provides comprehensive Chinese, Japanese, and Korean (CJK) Input Method Editor (IME) support across both desktop and mobile platforms. The implementation uses platform-specific approaches to ensure optimal user experience:

- **Desktop**: Cursor-positioned text input with native browser IME integration
- **Mobile**: Native virtual keyboard with direct input handling

## Architecture

### Core Components

```
SessionView
├── InputManager (Main input coordination layer)
│   ├── Platform detection (mobile vs desktop)
│   ├── DesktopIMEInput component integration (desktop only)
│   ├── Keyboard input handling
│   ├── WebSocket/HTTP input routing
│   └── Terminal cursor position access
├── DesktopIMEInput (Desktop-specific IME component)
│   ├── Cursor-positioned input element creation
│   ├── IME composition event handling
│   ├── Global paste handling
│   ├── Dynamic cursor positioning
│   └── Focus management
├── DirectKeyboardManager (Mobile input handling)
│   ├── Native virtual keyboard integration
│   ├── Direct input processing
│   └── Quick keys toolbar
├── LifecycleEventManager (Event interception & coordination)
└── Terminal Components (Cursor position providers)
```

## Implementation Details

### Cursor Position Tracking

**File**: `cursor-position.ts`

The cursor position tracking system uses renderer-specific cursor coordinates:

#### Coordinate System

```typescript
export function calculateCursorPosition(
  cursorX: number, // 0-based column position
  cursorY: number, // 0-based row position
  fontSize: number, // Terminal font size in pixels
  container: Element, // Terminal container element
  sessionStatus: string, // Session status for validation
): { x: number; y: number } | null;
```

#### Position Calculation Process

1. **Character Measurement**: Dynamically measures actual character width using font metrics
2. **Absolute Positioning**: Calculates page-absolute cursor coordinates
3. **Container Relative**: Converts to position relative to `#session-terminal` container
4. **IME Positioning**: Returns coordinates suitable for IME input placement

#### Terminal Type Support

- **Ghostty Terminal (`vibe-terminal`)**: Uses the active buffer cursor and renderer cell metrics.
- **Buffer Terminal (`vibe-terminal-buffer`)**: Uses `buffer.cursorX/Y` from VT snapshot data.

#### Key Features

- **Precise Alignment**: Accounts for exact character width and line height
- **Container Aware**: Handles side panels and complex layouts
- **Font Responsive**: Adapts to different font sizes and families
- **Platform Consistent**: Same calculation logic across all terminal types

#### Error Handling

The function includes comprehensive error handling and graceful fallbacks:

- Returns `null` when session is not running
- Returns `null` when container element is not found
- Returns `null` when character measurement fails
- Falls back to absolute coordinates if session container is missing

### Platform Detection

**File**: `mobile-utils.ts`

VibeTunnel automatically detects the platform and chooses the appropriate IME strategy:

```typescript
export function detectMobile(): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent,
  );
}
```

### Desktop Implementation

#### 1. DesktopIMEInput Component

**File**: `ime-input.ts`

A dedicated component for desktop browsers that creates and manages a native text input:

- Positioned dynamically at terminal cursor location
- Uses a normal input size so browsers can anchor native candidate windows reliably
- Transparent background and hidden caret keep the terminal visually unobstructed
- Handles all CJK composition events through standard DOM APIs
- Focuses when the user clicks the terminal, with short animation-frame retries for browser timing
- Clean lifecycle management with proper cleanup

#### 2. Desktop Input Manager Integration

**File**: `input-manager.ts`

The `InputManager` detects platform and creates the appropriate IME component:

```typescript
private setupIMEInput(): void {
  // Skip IME input setup on mobile devices (they use native keyboard)
  if (detectMobile()) {
    logger.log('Skipping IME input setup on mobile device');
    return;
  }

  // Create desktop IME input component
  this.imeInput = new DesktopIMEInput({
    container: terminalContainer,
    onTextInput: (text: string) => this.sendInputText(text),
    onSpecialKey: (key: string) => this.sendInput(key),
    getCursorInfo: () => {
      const terminalElement = this.callbacks?.getTerminalElement?.();
      if (
        terminalElement &&
        'getCursorInfo' in terminalElement &&
        typeof terminalElement.getCursorInfo === 'function'
      ) {
        return terminalElement.getCursorInfo();
      }
      return null;
    }
  });
}
```

#### 3. Desktop Focus Management

**File**: `ime-input.ts`

Desktop IME focus follows terminal clicks. The implementation avoids polling because repeatedly stealing focus interferes with native candidate selection:

```typescript
focus(): void {
  this.updatePosition();
  this.input.focus();

  requestAnimationFrame(() => {
    if (document.activeElement !== this.input) {
      requestAnimationFrame(() => this.input.focus());
    }
  });
}
```

### Mobile Implementation

#### 1. Direct Keyboard Manager

**File**: `direct-keyboard-manager.ts`

Mobile devices use the native virtual keyboard with a visible input field:

- Standard HTML input element (not hidden)
- Native virtual keyboard with CJK support
- Quick keys toolbar for common terminal operations
- No special IME handling needed (OS provides it)

#### 2. Mobile Input Flow

**Files**: `session-view.ts`, `lifecycle-event-manager.ts`

Mobile input handling follows a different flow:

1. User taps terminal area
2. Native virtual keyboard appears with CJK support
3. User types or selects from IME candidates
4. Input is sent directly to terminal
5. No desktop composition bridge is needed

## Platform Differences

### Key Implementation Differences

| Aspect               | Desktop                          | Mobile                       |
| -------------------- | -------------------------------- | ---------------------------- |
| **Input Element**    | Cursor-positioned standard input | Visible standard input field |
| **IME Handling**     | Custom composition events        | Native OS keyboard           |
| **Positioning**      | Follows terminal cursor          | Fixed position or overlay    |
| **Focus Management** | Click focus with bounded retries | Standard focus behavior      |
| **Keyboard**         | Physical + software IME          | Virtual keyboard with IME    |
| **Integration**      | Transparent terminal overlay     | Visible UI component         |
| **Performance**      | Minimal overhead                 | Standard input performance   |

### Technical Architecture Differences

#### Desktop Implementation

```typescript
// Creates a browser-compatible input at the terminal cursor
const input = document.createElement("input");
input.style.width = "200px";
input.style.height = "24px";
input.style.backgroundColor = "transparent";
input.style.caretColor = "transparent";

// Handles IME composition events
input.addEventListener("compositionstart", handleStart);
input.addEventListener("compositionend", handleEnd);

// Positions at terminal cursor
input.style.left = `${cursorX}px`;
input.style.top = `${cursorY}px`;
```

#### Mobile Implementation

```typescript
// Uses DirectKeyboardManager with visible input
const input = document.createElement("input");
input.type = "text";
input.placeholder = "Type here...";
// Standard visible input - no special IME handling needed

// OS handles IME automatically through virtual keyboard
// No composition event handling required
```

### User Experience Differences

#### Desktop Experience

- **Seamless**: No visible UI changes
- **Cursor following**: IME popup appears at terminal cursor
- **Click to focus**: Click anywhere in terminal area
- **Traditional**: Works like native terminal IME
- **Paste support**: Global paste handling anywhere in terminal

#### Mobile Experience

- **Touch-first**: Designed for finger interaction
- **Visible input**: Clear indication of where to type
- **Quick keys**: Easy access to terminal-specific keys
- **Gesture support**: Touch gestures and haptic feedback
- **Keyboard management**: Handles virtual keyboard show/hide

## Platform-Specific Features

### Desktop Features

- **Dynamic cursor positioning**: IME popup follows terminal cursor exactly
- **Global paste handling**: Paste works anywhere in terminal area
- **Composition state tracking**: Via native `KeyboardEvent.isComposing` plus the `data-ime-composing` DOM attribute
- **Focus management**: Click focus plus bounded browser-timing retries
- **Transparent integration**: Native input text appears at the terminal cursor without a separate control
- **Performance optimized**: Minimal resource usage when not composing

### Mobile Features

- **Native virtual keyboard**: Full OS-level CJK IME integration
- **Quick keys toolbar**: Touch-friendly terminal keys (Tab, Esc, Ctrl, etc.)
- **Touch-optimized UI**: Larger tap targets and touch gestures
- **Auto-capitalization control**: Intelligently disabled for terminal accuracy
- **Viewport management**: Graceful handling of keyboard show/hide animations
- **Direct input mode**: Option to use hidden input for power users

## User Experience

### Desktop Workflow

```
User clicks terminal → Cursor-positioned input focuses → Types CJK →
Browser shows IME candidates → User selects → Text appears in terminal
```

### Mobile Workflow

```
User taps terminal → Virtual keyboard appears → Types CJK →
OS shows IME candidates → User selects → Text appears in terminal
```

### Visual Behavior

- **Desktop**: Transparent input text and native IME popup at the terminal cursor
- **Mobile**: Standard input field with native virtual keyboard
- **Both platforms**: Seamless CJK text input with full IME support

## Performance

### Optimization Features

- One input element and listener set per active desktop session
- Dynamic positioning only calculated when needed
- Minimal DOM footprint (single input element)
- Clean event delegation and lifecycle management
- Click-to-focus behavior without polling
- Proper cleanup prevents memory leaks during session changes

## Code Reference

### Primary Files

- `ime-input.ts` - Desktop input creation, composition events, positioning, focus, paste, and cleanup
- `input-manager.ts` - Input coordination, desktop/mobile selection, terminal routing, and lifecycle
- `terminal.ts` - Ghostty renderer cursor geometry used to anchor the native input
- `lifecycle-event-manager.ts` - Keyboard interception that leaves active composition to the browser
- `direct-keyboard-manager.ts` - Mobile keyboard handling
- `mobile-utils.ts` - Mobile detection utilities

### Supporting Files

- `session-view.ts` - Container element and terminal integration
- `ime-constants.ts` - IME-related key filtering utilities
- `terminal-constants.ts` - Terminal element IDs, font settings, and IME positioning constants

## Browser Compatibility

Works with all major browsers that support:

- IME composition events (`compositionstart`, `compositionupdate`, `compositionend`)
- Clipboard API for paste functionality
- Standard DOM positioning APIs

The affected macOS boundary has live coverage with Chrome and Safari using Chinese Pinyin. Automated coverage verifies the composition lifecycle and cursor anchoring independently of the operating-system candidate UI.

## Configuration

### Automatic Platform Detection

CJK IME support is automatically configured based on the detected platform:

- **Desktop**: Cursor-positioned IME input with native candidate-window anchoring
- **Mobile**: Native virtual keyboard with OS IME

### Requirements

1. User has CJK input method enabled in their OS
2. Desktop: User clicks in terminal area to focus
3. Mobile: User taps terminal or input field
4. User switches to CJK input mode in their OS

## Troubleshooting

### Common Issues

- **IME candidates not showing**: Ensure browser supports composition events
- **Text not appearing**: Check if terminal session is active and receiving input
- **Paste not working**: Verify clipboard permissions in browser

### Debug Information

Comprehensive logging available in browser console:

- `🔍 Setting up IME input on desktop device` - Platform detection
- `[ime-input]` - Desktop IME component events
- `[direct-keyboard-manager]` - Mobile keyboard events
- State tracking through DOM attributes:
  - `data-ime-composing` - IME composition active (desktop)
  - `data-ime-input-focused` - IME input has focus (desktop)
- Mobile detection logs showing user agent analysis

---

## Recent Improvements (v1.0.0-beta.16+)

### Unified Cursor Position Tracking

- **Shared Utility**: Created `cursor-position.ts` for consistent cursor calculation across all terminal types
- **Container-Aware Positioning**: Fixed IME positioning issues with side panels and complex layouts
- **Precise Alignment**: Improved character width measurement for pixel-perfect cursor alignment
- **Debug Logging**: Enhanced debug output with comprehensive coordinate information

### Technical Improvements

- **Code Deduplication**: Eliminated ~120 lines of duplicate cursor calculation code
- **Maintainability**: Single source of truth for cursor positioning logic
- **Type Safety**: Improved TypeScript interfaces and error handling
- **Performance**: More efficient coordinate conversion with optimized calculations

### Element ID Centralization

- **Constants File**: Created `terminal-constants.ts` to centralize all critical terminal element IDs
- **Prevention of Breakage**: Changes to IDs like `session-terminal`, `buffer-container`, or `terminal-container` now only require updates in one location
- **Consistent References**: All components now import `TERMINAL_IDS` constants instead of using hardcoded strings
- **Type Safety**: Constants are strongly typed to prevent typos and ensure consistent usage across the codebase

---

**Status**: ✅ Production Ready  
**Platforms**: Desktop (Windows, macOS, Linux) and Mobile (iOS, Android)  
**Version**: VibeTunnel Web v1.0.0-beta.16+  
**Last Updated**: 2026-06-13
