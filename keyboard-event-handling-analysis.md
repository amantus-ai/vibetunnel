# Keyboard Event Handling Analysis for VibeTunnel Web

## Overview

This document provides a comprehensive analysis of keyboard event handling in the VibeTunnel web client, focusing on how keyboard events are captured, processed, and potentially blocked from browser defaults.

## Key Files Involved

### Core Input Handling
1. **`web/src/client/components/session-view/input-manager.ts`**
   - Main keyboard input processing logic
   - Handles special key combinations
   - Routes input to terminal sessions

2. **`web/src/client/components/session-view/direct-keyboard-manager.ts`**
   - Mobile-specific keyboard handling
   - Hidden input element management
   - IME (Input Method Editor) support for CJK languages

3. **`web/src/client/components/session-view/lifecycle-event-manager.ts`**
   - Global keyboard event listener registration
   - Initial event filtering and routing
   - Browser shortcut detection

### Utility Functions
4. **`web/src/client/utils/event-utils.ts`**
   - `consumeEvent()` helper that calls both `preventDefault()` and `stopPropagation()`
   - Used throughout the codebase for complete event consumption

### Component-Level Handlers
5. **`web/src/client/app.ts`**
   - Global keyboard shortcuts (Cmd+O, Cmd+B, Escape)
   - App-level navigation shortcuts

## Event Flow

### 1. Initial Capture (lifecycle-event-manager.ts)

```typescript
keyboardHandler = (e: KeyboardEvent): void => {
  // First check: Focus management disabled?
  if (this.callbacks.getDisableFocusManagement()) {
    return; // Let event through
  }

  // Special handling for Cmd+O / Ctrl+O
  if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
    consumeEvent(e); // BLOCKS browser default
    this.callbacks.setShowFileBrowser(true);
    return;
  }

  // Check if in inline-edit component
  const composedPath = e.composedPath();
  for (const element of composedPath) {
    if (element instanceof HTMLElement && element.tagName?.toLowerCase() === 'inline-edit') {
      return; // Let event through
    }
  }

  // Check if browser shortcut
  const inputManager = this.callbacks.getInputManager();
  if (inputManager?.isKeyboardShortcut(e)) {
    return; // Let event through
  }

  // Otherwise, consume the event
  consumeEvent(e); // BLOCKS browser default
  this.callbacks.handleKeyboardInput(e);
};
```

### 2. Browser Shortcut Detection (input-manager.ts)

```typescript
isKeyboardShortcut(e: KeyboardEvent): boolean {
  // Allow typing in input fields
  const target = e.target as HTMLElement;
  if (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.contentEditable === 'true' ||
    target.closest('.monaco-editor') ||
    target.closest('[data-keybinding-context]') ||
    target.closest('.editor-container') ||
    target.closest('inline-edit')
  ) {
    return false; // Not a browser shortcut
  }

  const isMacOS = navigator.platform.toLowerCase().includes('mac');

  // Allow F12 and DevTools shortcuts
  if (
    e.key === 'F12' ||
    (!isMacOS && e.ctrlKey && e.shiftKey && e.key === 'I') ||
    (isMacOS && e.metaKey && e.altKey && e.key === 'I')
  ) {
    return true;
  }

  // Allow common browser shortcuts
  if (
    !isMacOS &&
    e.ctrlKey &&
    !e.shiftKey &&
    ['a', 'f', 'r', 'l', 't', 'w', 'n', 'c', 'v'].includes(e.key.toLowerCase())
  ) {
    return true;
  }

  // Allow macOS shortcuts
  if (
    isMacOS &&
    e.metaKey &&
    !e.shiftKey &&
    !e.altKey &&
    ['a', 'f', 'r', 'l', 't', 'w', 'n', 'c', 'v'].includes(e.key.toLowerCase())
  ) {
    return true;
  }

  // Allow Alt+Tab, Cmd+Tab
  if ((e.altKey || e.metaKey) && e.key === 'Tab') {
    return true;
  }

  return false;
}
```

## Blocked Browser Shortcuts

### Always Blocked in Terminal View

1. **Alt+Arrow Navigation** (Back/Forward)
   - `Alt+Left Arrow` → Sends `ESC+b` to terminal (move to previous word)
   - `Alt+Right Arrow` → Sends `ESC+f` to terminal (move to next word)
   - `Alt+Backspace` → Sends `Ctrl+W` to terminal (delete word)
   - **Blocked by**: `consumeEvent(e)` in `input-manager.ts`

2. **Most Regular Keys**
   - All regular typing (a-z, 0-9, symbols)
   - Arrow keys (without modifiers)
   - Enter, Tab, Backspace, Delete, Escape
   - Space bar
   - **Blocked by**: `consumeEvent(e)` in `lifecycle-event-manager.ts`

3. **Special Terminal Shortcuts**
   - `Ctrl+A` through `Ctrl+Z` (sent as control sequences)
   - Function keys (F1-F12)
   - Page Up/Down, Home, End
   - **Blocked by**: Default prevention in event flow

### Explicitly Allowed Browser Shortcuts

1. **Developer Tools**
   - `F12`
   - `Ctrl+Shift+I` (Windows/Linux)
   - `Cmd+Alt+I` (macOS)

2. **Common Browser Operations**
   - `Ctrl/Cmd+A` (Select All)
   - `Ctrl/Cmd+F` (Find)
   - `Ctrl/Cmd+R` (Refresh)
   - `Ctrl/Cmd+L` (Focus address bar)
   - `Ctrl/Cmd+T` (New tab)
   - `Ctrl/Cmd+W` (Close tab)
   - `Ctrl/Cmd+N` (New window)
   - `Ctrl/Cmd+C` (Copy) - Special handling
   - `Ctrl/Cmd+V` (Paste) - Special handling

3. **Window Management**
   - `Alt+Tab` (Windows/Linux)
   - `Cmd+Tab` (macOS)

## Special Cases

### Copy/Paste Handling

The code has special logic for copy/paste:

```typescript
// Allow standard browser copy/paste shortcuts
const isMacOS = navigator.platform.toLowerCase().includes('mac');
const isStandardPaste =
  (isMacOS && metaKey && key === 'v' && !ctrlKey && !shiftKey) ||
  (!isMacOS && ctrlKey && key === 'v' && !shiftKey);
const isStandardCopy =
  (isMacOS && metaKey && key === 'c' && !ctrlKey && !shiftKey) ||
  (!isMacOS && ctrlKey && key === 'c' && !shiftKey);

if (isStandardPaste || isStandardCopy) {
  return; // Allow browser to handle
}
```

### Mobile/Touch Keyboard

On mobile devices, a hidden input element is used with additional handling:
- Focus retention mechanisms
- IME composition support
- Virtual keyboard API integration
- Quick keys overlay

## Problems Identified

### 1. Alt+Arrow Navigation Blocking
The most significant issue is that **Alt+Left/Right Arrow browser navigation is completely blocked** when the terminal has focus. This prevents users from using these common shortcuts to navigate back/forward in their browser history.

### 2. Aggressive Event Consumption
The `consumeEvent()` function calls both `preventDefault()` and `stopPropagation()`, which:
- Prevents any parent handlers from receiving the event
- Blocks all default browser behavior
- Cannot be overridden by user preferences

### 3. Limited Shortcut Passthrough
While some browser shortcuts are allowed, the whitelist is limited and doesn't include:
- Alt+Arrow navigation
- Browser-specific shortcuts
- Custom keyboard shortcuts from extensions
- Accessibility shortcuts

## Recommendations

1. **Add Alt+Arrow to Allowed Shortcuts**
   - Modify `isKeyboardShortcut()` to detect Alt+Arrow combinations
   - Allow these events to pass through to the browser

2. **Make Blocking Configurable**
   - Add user preferences for keyboard shortcut handling
   - Allow users to choose between "Terminal Priority" and "Browser Priority" modes

3. **Use preventDefault() Selectively**
   - Consider using only `preventDefault()` without `stopPropagation()`
   - Allow events to bubble for parent handlers

4. **Document Blocked Shortcuts**
   - Provide clear documentation of which shortcuts are captured
   - Offer alternative key combinations for blocked functionality