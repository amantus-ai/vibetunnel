# Android Keyboard Fix for Claude Code

## Issue #504: Android keyboard covers Claude Code text input

### Problem
When Claude Code runs inside a VibeTunnel terminal session on Android Chrome, the on-screen keyboard covers the text input area, preventing users from seeing what they're typing.

### Root Cause
While VibeTunnel handles keyboard appearance for its own UI elements, embedded applications like Claude Code running inside the terminal don't benefit from these adjustments. The terminal content remains fixed in position when the keyboard appears.

### Solution Implemented

#### 1. Modern Viewport Units
- Added `100dvh` (dynamic viewport height) units alongside existing `100vh`
- Dynamic viewport units automatically adjust when the keyboard appears/disappears
- Updated in `index.html` for better mobile browser support

#### 2. Interactive Widget Meta Tag
- Added `interactive-widget=resizes-content` to viewport meta tag
- This tells Android Chrome to resize the viewport when keyboard appears
- Provides better native handling of keyboard appearance

#### 3. CSS Improvements
- Made terminal viewport scrollable when keyboard is visible
- Added specific styles for `data-keyboard-visible="true"` state
- Ensured xterm viewport can scroll to show content behind keyboard
- Used `env(keyboard-inset-height)` for future-proof keyboard handling

#### 4. Enhanced Keyboard Detection
- Set CSS custom property `--keyboard-height` with actual keyboard height
- Added `data-keyboard-visible` attribute to body element
- Dispatch custom events `vibetunnel:keyboard-shown` and `vibetunnel:keyboard-hidden`
- These allow embedded apps to react to keyboard state changes

### Benefits
- Claude Code (and other embedded apps) can now be scrolled when keyboard appears
- No more hidden input fields on Android devices
- Better visual feedback and smoother transitions
- Future-proof solution using modern CSS and viewport APIs

### Testing
1. Open VibeTunnel on Android Chrome
2. Start a Claude Code session
3. Tap on Claude's input field
4. Verify that:
   - The viewport adjusts when keyboard appears
   - You can scroll to see the input field
   - Text input remains visible while typing
   - Keyboard dismissal restores normal view

### Compatibility
- Android Chrome: Full support
- iOS Safari: Improved support (already had better handling)
- Desktop browsers: No impact (mobile-only styles)