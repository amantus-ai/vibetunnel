# iOS Safari Paste Implementation

## Overview

This document describes the implementation of paste functionality for iOS Safari in VibeTunnel, addressing the limitations of the Clipboard API on mobile Safari and providing a reliable fallback mechanism.

## The Problem

### Primary Issues

1. **Clipboard API Limitations on iOS Safari**
   - `navigator.clipboard.readText()` only works in secure contexts (HTTPS/localhost)
   - Even in secure contexts, it requires "transient user activation" (immediate user gesture)
   - iOS 15 and older versions don't expose `readText()` at all
   - In HTTP contexts, `navigator.clipboard` is completely undefined

2. **Focus Management Conflicts**
   - VibeTunnel uses aggressive focus retention for the hidden input field
   - Focus retention runs every 100ms to maintain keyboard visibility
   - "Keyboard mode" forces focus back to hidden input continuously
   - This prevents any other element from maintaining focus long enough for iOS paste menu

3. **iOS Native Paste Menu Requirements**
   - Requires a visible, focusable text input element
   - Element must maintain focus for the paste menu to appear
   - User must be able to long-press the element
   - Hidden or off-screen elements don't trigger the paste menu reliably

### Failed Approaches

1. **Off-screen Textarea** (Apple's documented approach)
   - Created textarea at `position: fixed; left: -9999px`
   - Focus was immediately stolen by focus retention mechanism
   - Even after disabling focus retention, keyboard mode continued stealing focus
   - iOS couldn't show paste menu on an off-screen element

2. **Temporary Focus Retention Disable**
   - Attempted to pause focus retention interval during paste
   - Keyboard mode's focus management still interfered
   - Complex state management led to race conditions
   - Restoration of focus states was unreliable

## The Solution

### Implementation Strategy

Use the existing hidden input field and temporarily make it visible for paste operations:

```typescript
private triggerNativePasteWithHiddenInput(): void {
  // 1. Save original styles
  const originalStyles = {
    position: this.hiddenInput.style.position,
    opacity: this.hiddenInput.style.opacity,
    // ... all other styles
  };

  // 2. Make input visible at screen center
  this.hiddenInput.style.position = 'fixed';
  this.hiddenInput.style.left = '50%';
  this.hiddenInput.style.top = '50%';
  this.hiddenInput.style.transform = 'translate(-50%, -50%)';
  this.hiddenInput.style.width = '200px';
  this.hiddenInput.style.height = '40px';
  this.hiddenInput.style.opacity = '1';
  this.hiddenInput.style.backgroundColor = 'white';
  this.hiddenInput.style.border = '2px solid #007AFF';
  this.hiddenInput.style.borderRadius = '8px';
  this.hiddenInput.style.padding = '8px';
  this.hiddenInput.style.zIndex = '10000';
  this.hiddenInput.placeholder = 'Long-press to paste';

  // 3. Add paste event listener
  this.hiddenInput.addEventListener('paste', handlePasteEvent);

  // 4. Focus and select
  this.hiddenInput.focus();
  this.hiddenInput.select();

  // 5. Clean up after paste or timeout
}
```

### Why This Works

1. **No Focus Conflicts**: Uses the same input that already has focus management
2. **Visible Target**: iOS can show paste menu on a visible, centered element
3. **User-Friendly**: Clear visual feedback with "Long-press to paste" placeholder
4. **Simple State Management**: Just style changes, no complex focus juggling
5. **Maintains User Gesture Context**: Called directly from touch event handler

### User Flow

1. User taps "Paste" button in quick keys
2. Hidden input becomes visible at screen center with blue border
3. User long-presses the visible input
4. iOS shows native paste menu
5. User taps "Paste" from menu
6. Text is pasted and sent to terminal
7. Input returns to hidden state

## Implementation Details

### Key Files

- `web/src/client/components/session-view/direct-keyboard-manager.ts:695-784` - Main paste implementation
- `web/src/client/components/terminal-quick-keys.ts:198-207` - Paste button handler

### Fallback Logic

```typescript
// In handleQuickKeyPress for 'Paste' key:
1. Try modern Clipboard API if available (HTTPS contexts)
2. If that fails or unavailable, use triggerNativePasteWithHiddenInput()
3. Show visible input for native iOS paste menu
```

### Autocorrect Disable

To prevent iOS text editing interference, the hidden input has comprehensive attributes:

```typescript
this.hiddenInput.autocapitalize = 'none';
this.hiddenInput.autocomplete = 'off';
this.hiddenInput.setAttribute('autocorrect', 'off');
this.hiddenInput.setAttribute('spellcheck', 'false');
this.hiddenInput.setAttribute('data-autocorrect', 'off');
this.hiddenInput.setAttribute('data-gramm', 'false');
this.hiddenInput.setAttribute('data-ms-editor', 'false');
this.hiddenInput.setAttribute('data-smartpunctuation', 'false');
this.hiddenInput.setAttribute('inputmode', 'text');
```

## Testing

### Test Scenarios

1. **HTTPS Context**: Clipboard API should work directly
2. **HTTP Context**: Should fall back to visible input method
3. **Focus Retention Active**: Paste should still work without conflicts
4. **Multiple Paste Operations**: Each should work independently
5. **Timeout Handling**: Input should restore after 10 seconds if no paste

### Known Limitations

1. Requires user to long-press and select paste (two taps total)
2. Shows visible UI element temporarily
3. 10-second timeout if user doesn't paste
4. Only works with text content (no rich text/images)

## References

- [iOS Safari Clipboard API Documentation](https://developer.apple.com/documentation/webkit/clipboard_api)
- [WebKit Bug Tracker - Clipboard API Issues](https://bugs.webkit.org/)
- Original working implementation: Commit `44f69c45a`
- Issue #317: Safari paste functionality