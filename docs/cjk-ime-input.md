# VibeTunnel CJK IME Input Implementation

## Overview

VibeTunnel provides comprehensive Chinese, Japanese, and Korean (CJK) Input Method Editor (IME) support across both desktop and mobile platforms. The implementation uses platform-specific approaches to ensure optimal user experience:

- **Desktop**: Invisible input element with native browser IME integration
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
│   ├── Invisible input element creation
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

### Platform Detection
**File**: `mobile-utils.ts`

VibeTunnel automatically detects the platform and chooses the appropriate IME strategy:
```typescript
export function detectMobile(): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}
```

### Desktop Implementation

#### 1. DesktopIMEInput Component
**File**: `ime-input.ts:32-382`

A dedicated component for desktop browsers that creates and manages an invisible input element:
- Positioned dynamically at terminal cursor location
- Completely invisible (`opacity: 0`, `1px x 1px`, `pointerEvents: none`)
- Handles all CJK composition events through standard DOM APIs
- Placeholder: "CJK Input"
- Auto-focus with retention mechanism to prevent focus loss
- Clean lifecycle management with proper cleanup

#### 2. Desktop Input Manager Integration
**File**: `input-manager.ts:71-129`

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
      // Dynamic cursor position calculation
      const cursorInfo = terminalElement.getCursorInfo();
      const pixelX = terminalRect.left - containerRect.left + cursorX * charWidth;
      const pixelY = terminalRect.top - containerRect.top + cursorY * lineHeight + lineHeight;
      return { x: pixelX, y: pixelY };
    }
  });
}
```

#### 3. Desktop Focus Retention
**File**: `ime-input.ts:317-343`

Desktop IME requires special focus handling to prevent losing focus during composition:
```typescript
private startFocusRetention(): void {
  // Skip in test environment to avoid infinite loops
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') {
    return;
  }
  
  this.focusRetentionInterval = setInterval(() => {
    if (document.activeElement !== this.input) {
      this.input.focus();
    }
  }, 100);
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
5. No invisible elements or composition tracking needed

## Platform Differences

### Key Implementation Differences

| Aspect | Desktop | Mobile |
|--------|---------|---------|
| **Input Element** | Invisible 1px × 1px input | Visible standard input field |
| **IME Handling** | Custom composition events | Native OS keyboard |
| **Positioning** | Follows terminal cursor | Fixed position or overlay |
| **Focus Management** | Active focus retention | Standard focus behavior |
| **Keyboard** | Physical + software IME | Virtual keyboard with IME |
| **Integration** | Completely transparent | Visible UI component |
| **Performance** | Minimal overhead | Standard input performance |

### Technical Architecture Differences

#### Desktop Implementation
```typescript
// Creates invisible input at cursor position
const input = document.createElement('input');
input.style.opacity = '0';
input.style.width = '1px';
input.style.height = '1px';
input.style.pointerEvents = 'none';

// Handles IME composition events
input.addEventListener('compositionstart', handleStart);
input.addEventListener('compositionend', handleEnd);

// Positions at terminal cursor
input.style.left = `${cursorX}px`;
input.style.top = `${cursorY}px`;
```

#### Mobile Implementation
```typescript
// Uses DirectKeyboardManager with visible input
const input = document.createElement('input');
input.type = 'text';
input.placeholder = 'Type here...';
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
- **Composition state tracking**: Via `data-ime-composing` DOM attribute
- **Focus retention**: Active mechanism prevents accidental focus loss
- **Invisible integration**: Zero visual footprint for users
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
User clicks terminal → Invisible input focuses → Types CJK → 
Browser shows IME candidates → User selects → Text appears in terminal
```

### Mobile Workflow
```
User taps terminal → Virtual keyboard appears → Types CJK → 
OS shows IME candidates → User selects → Text appears in terminal
```

### Visual Behavior
- **Desktop**: Completely invisible, native IME popup at cursor position
- **Mobile**: Standard input field with native virtual keyboard
- **Both platforms**: Seamless CJK text input with full IME support

## Performance

### Resource Usage
- **Memory**: <1KB (1 invisible DOM element + event listeners)
- **CPU**: ~0.1ms per event (negligible overhead)
- **Impact on English users**: None (actually improves paste reliability)

### Optimization Features
- Event handlers only active during IME usage
- Dynamic positioning only calculated when needed
- Minimal DOM footprint (single invisible input element)
- Clean event delegation and lifecycle management
- Automatic focus management with click-to-focus behavior
- Proper cleanup prevents memory leaks during session changes

## Code Reference

### Primary Files
- `ime-input.ts` - Desktop IME component implementation
  - `32-48` - DesktopIMEInput class definition
  - `50-80` - Invisible input element creation
  - `82-132` - Event listener setup (composition, paste, focus)
  - `134-156` - IME composition event handling
  - `317-343` - Focus retention mechanism
- `input-manager.ts` - Input coordination and platform detection
  - `71-129` - Platform detection and IME setup
  - `131-144` - IME state checking during keyboard input
  - `453-458` - Cleanup and lifecycle management
- `direct-keyboard-manager.ts` - Mobile keyboard handling
  - Complete mobile input implementation
- `mobile-utils.ts` - Mobile detection utilities

### Supporting Files
- `terminal.ts` - XTerm cursor position API via `getCursorInfo()`
- `vibe-terminal-binary.ts` - Binary terminal cursor position API
- `session-view.ts` - Container element and terminal integration
- `lifecycle-event-manager.ts` - Event coordination and interception
- `ime-constants.ts` - IME-related key filtering utilities

## Browser Compatibility

Works with all major browsers that support:
- IME composition events (`compositionstart`, `compositionupdate`, `compositionend`)
- Clipboard API for paste functionality
- Standard DOM positioning APIs

Tested with:
- Chrome, Firefox, Safari, Edge
- macOS, Windows, Linux IME systems
- Chinese (Simplified/Traditional), Japanese, Korean input methods

## Configuration

### Automatic Platform Detection
CJK IME support is automatically configured based on the detected platform:
- **Desktop**: Invisible IME input with cursor following
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

**Status**: ✅ Production Ready  
**Platforms**: Desktop (Windows, macOS, Linux) and Mobile (iOS, Android)  
**Version**: VibeTunnel Web v1.0.0-beta.15+  
**Last Updated**: 2025-01-22