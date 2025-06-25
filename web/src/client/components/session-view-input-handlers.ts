/**
 * Input handlers for SessionView component
 */
import { authClient } from '../services/auth-client.js';
import { createLogger } from '../utils/logger.js';
import type { Session } from './session-list.js';

const logger = createLogger('session-view-input');

export interface TouchState {
  touchStartX: number;
  touchStartY: number;
}

export function createKeyboardHandler(
  session: Session | null,
  onOpenFileBrowser: () => void,
  onKeyInput: (e: KeyboardEvent) => void
): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    // Check if we're typing in an input field
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT'
    ) {
      // Allow normal input in form fields
      return;
    }

    // Handle Cmd+O / Ctrl+O to open file browser
    if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
      e.preventDefault();
      onOpenFileBrowser();
      return;
    }
    if (!session) return;

    // Allow important browser shortcuts to pass through
    const isMacOS = navigator.platform.toLowerCase().includes('mac');

    // Allow F12 and Ctrl+Shift+I (DevTools)
    if (
      e.key === 'F12' ||
      (!isMacOS && e.ctrlKey && e.shiftKey && e.key === 'I') ||
      (isMacOS && e.metaKey && e.altKey && e.key === 'I')
    ) {
      return;
    }

    // Allow Ctrl+A (select all), Ctrl+F (find), Ctrl+R (refresh), Ctrl+C/V (copy/paste), etc.
    if (
      !isMacOS &&
      e.ctrlKey &&
      !e.shiftKey &&
      ['a', 'f', 'r', 'l', 't', 'w', 'n', 'c', 'v'].includes(e.key.toLowerCase())
    ) {
      return;
    }

    // Allow Cmd+A, Cmd+F, Cmd+R, Cmd+C/V (copy/paste), etc. on macOS
    if (
      isMacOS &&
      e.metaKey &&
      !e.shiftKey &&
      !e.altKey &&
      ['a', 'f', 'r', 'l', 't', 'w', 'n', 'c', 'v'].includes(e.key.toLowerCase())
    ) {
      return;
    }

    // Allow Alt+Tab, Cmd+Tab (window switching)
    if ((e.altKey || e.metaKey) && e.key === 'Tab') {
      return;
    }

    // Only prevent default for keys we're actually going to handle
    e.preventDefault();
    e.stopPropagation();

    onKeyInput(e);
  };
}

export async function handleKeyboardInput(
  e: KeyboardEvent,
  session: Session,
  onBack: () => void,
  onSessionExited: () => void
): Promise<void> {
  // Handle Escape key specially for exited sessions
  if (e.key === 'Escape' && session.status === 'exited') {
    onBack();
    return;
  }

  // Don't send input to exited sessions
  if (session.status === 'exited') {
    logger.log('ignoring keyboard input - session has exited');
    return;
  }

  // Allow standard browser copy/paste shortcuts
  const isMacOS = navigator.platform.toLowerCase().includes('mac');
  const isStandardPaste =
    (isMacOS && e.metaKey && e.key === 'v' && !e.ctrlKey && !e.shiftKey) ||
    (!isMacOS && e.ctrlKey && e.key === 'v' && !e.shiftKey);
  const isStandardCopy =
    (isMacOS && e.metaKey && e.key === 'c' && !e.ctrlKey && !e.shiftKey) ||
    (!isMacOS && e.ctrlKey && e.key === 'c' && !e.shiftKey);

  if (isStandardPaste || isStandardCopy) {
    // Allow standard browser copy/paste to work
    return;
  }

  let inputText = '';

  // Handle special keys
  switch (e.key) {
    case 'Enter':
      if (e.ctrlKey) {
        inputText = 'ctrl_enter';
      } else if (e.shiftKey) {
        inputText = 'shift_enter';
      } else {
        inputText = 'enter';
      }
      break;
    case 'Escape':
      inputText = 'escape';
      break;
    case 'ArrowUp':
      inputText = 'arrow_up';
      break;
    case 'ArrowDown':
      inputText = 'arrow_down';
      break;
    case 'ArrowLeft':
      inputText = 'arrow_left';
      break;
    case 'ArrowRight':
      inputText = 'arrow_right';
      break;
    case 'Tab':
      inputText = '\t';
      break;
    case 'Backspace':
      inputText = '\b';
      break;
    case 'Delete':
      inputText = '\x7f';
      break;
    case ' ':
      inputText = ' ';
      break;
    default:
      // Handle regular printable characters
      if (e.key.length === 1) {
        inputText = e.key;
      } else {
        // Ignore other special keys
        return;
      }
      break;
  }

  // Handle Ctrl combinations (but not if we already handled Ctrl+Enter above)
  if (e.ctrlKey && e.key.length === 1 && e.key !== 'Enter') {
    const charCode = e.key.toLowerCase().charCodeAt(0);
    if (charCode >= 97 && charCode <= 122) {
      // a-z
      inputText = String.fromCharCode(charCode - 96); // Ctrl+A = \x01, etc.
    }
  }

  // Send the input to the session
  try {
    // Determine if we should send as key or text
    const body = [
      'enter',
      'escape',
      'arrow_up',
      'arrow_down',
      'arrow_left',
      'arrow_right',
      'ctrl_enter',
      'shift_enter',
      'backspace',
      'tab',
    ].includes(inputText)
      ? { key: inputText }
      : { text: inputText };

    const response = await fetch(`/api/sessions/${session.id}/input`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authClient.getAuthHeader(),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      if (response.status === 400) {
        logger.log('session no longer accepting input (likely exited)');
        onSessionExited();
      } else {
        logger.error('failed to send input to session', { status: response.status });
      }
    }
  } catch (error) {
    logger.error('error sending input', error);
  }
}

export async function sendInputText(session: Session | null, text: string): Promise<void> {
  if (!session) return;

  try {
    // Determine if we should send as key or text
    const body = [
      'enter',
      'escape',
      'backspace',
      'tab',
      'arrow_up',
      'arrow_down',
      'arrow_left',
      'arrow_right',
      'ctrl_enter',
      'shift_enter',
      'page_up',
      'page_down',
      'home',
      'end',
      'delete',
      'f1',
      'f2',
      'f3',
      'f4',
      'f5',
      'f6',
      'f7',
      'f8',
      'f9',
      'f10',
      'f11',
      'f12',
    ].includes(text)
      ? { key: text }
      : { text };

    const response = await fetch(`/api/sessions/${session.id}/input`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authClient.getAuthHeader(),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      logger.error('failed to send input to session', { status: response.status });
    }
  } catch (error) {
    logger.error('error sending input', error);
  }
}

export function createTouchHandlers(onSwipeBack: () => void): {
  touchStartHandler: (e: TouchEvent) => void;
  touchEndHandler: (e: TouchEvent) => void;
  touchState: TouchState;
} {
  const touchState: TouchState = {
    touchStartX: 0,
    touchStartY: 0,
  };

  const touchStartHandler = (e: TouchEvent) => {
    const touch = e.touches[0];
    touchState.touchStartX = touch.clientX;
    touchState.touchStartY = touch.clientY;
  };

  const touchEndHandler = (e: TouchEvent) => {
    const touch = e.changedTouches[0];
    const touchEndX = touch.clientX;
    const touchEndY = touch.clientY;

    const deltaX = touchEndX - touchState.touchStartX;
    const deltaY = touchEndY - touchState.touchStartY;

    // Check for horizontal swipe from left edge (back gesture)
    const isSwipeRight = deltaX > 100;
    const isVerticallyStable = Math.abs(deltaY) < 100;
    const startedFromLeftEdge = touchState.touchStartX < 50;

    if (isSwipeRight && isVerticallyStable && startedFromLeftEdge) {
      // Trigger back navigation
      onSwipeBack();
    }
  };

  return {
    touchStartHandler,
    touchEndHandler,
    touchState,
  };
}

export function handleQuickKeyPress(
  key: string,
  isModifier: boolean | undefined,
  isSpecial: boolean | undefined,
  sendInputText: (text: string) => void,
  onToggleMobileInput: () => void,
  onToggleCtrlAlpha: () => void
): void {
  if (isSpecial && key === 'ABC') {
    onToggleMobileInput();
    return;
  } else if (isModifier && key === 'Control') {
    // Just send Ctrl modifier - don't show the overlay
    // This allows using Ctrl as a modifier with physical keyboard
    return;
  } else if (key === 'CtrlFull') {
    onToggleCtrlAlpha();
    return;
  } else if (key === 'Ctrl+A') {
    sendInputText('\x01');
  } else if (key === 'Ctrl+C') {
    sendInputText('\x03');
  } else if (key === 'Ctrl+D') {
    sendInputText('\x04');
  } else if (key === 'Ctrl+E') {
    sendInputText('\x05');
  } else if (key === 'Ctrl+K') {
    sendInputText('\x0b');
  } else if (key === 'Ctrl+L') {
    sendInputText('\x0c');
  } else if (key === 'Ctrl+R') {
    sendInputText('\x12');
  } else if (key === 'Ctrl+U') {
    sendInputText('\x15');
  } else if (key === 'Ctrl+W') {
    sendInputText('\x17');
  } else if (key === 'Ctrl+Z') {
    sendInputText('\x1a');
  } else if (key === 'Option') {
    sendInputText('\x1b');
  } else if (key === 'Command') {
    // Command key doesn't have a direct terminal equivalent
    return;
  } else if (key === 'Delete') {
    sendInputText('delete');
  } else if (key.startsWith('F')) {
    // Handle function keys F1-F12
    const fNum = Number.parseInt(key.substring(1));
    if (fNum >= 1 && fNum <= 12) {
      sendInputText(`f${fNum}`);
    }
  } else {
    // Map key names to proper values
    let keyToSend = key;
    if (key === 'Tab') {
      keyToSend = 'tab';
    } else if (key === 'Escape') {
      keyToSend = 'escape';
    } else if (key === 'ArrowUp') {
      keyToSend = 'arrow_up';
    } else if (key === 'ArrowDown') {
      keyToSend = 'arrow_down';
    } else if (key === 'ArrowLeft') {
      keyToSend = 'arrow_left';
    } else if (key === 'ArrowRight') {
      keyToSend = 'arrow_right';
    } else if (key === 'PageUp') {
      keyToSend = 'page_up';
    } else if (key === 'PageDown') {
      keyToSend = 'page_down';
    } else if (key === 'Home') {
      keyToSend = 'home';
    } else if (key === 'End') {
      keyToSend = 'end';
    }

    // Send the key to terminal
    sendInputText(keyToSend.toLowerCase());
  }
}
