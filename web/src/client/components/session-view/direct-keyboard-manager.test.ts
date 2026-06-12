/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectKeyboardManager } from './direct-keyboard-manager';
import type { InputManager } from './input-manager';

describe('DirectKeyboardManager', () => {
  let manager: DirectKeyboardManager;
  let mockInputManager: Pick<InputManager, 'isKeyboardShortcut' | 'sendInput' | 'sendInputText'>;
  let originalRequestAnimationFrame: typeof requestAnimationFrame;

  const getManagerState = () =>
    manager as unknown as {
      hiddenInput: HTMLInputElement | null;
      focusRetentionInterval: number | null;
      keyboardReopenTimeout: ReturnType<typeof setTimeout> | null;
      reopeningKeyboard: boolean;
    };

  beforeEach(() => {
    // Mock requestAnimationFrame
    originalRequestAnimationFrame = global.requestAnimationFrame;
    global.requestAnimationFrame = vi.fn((callback) => {
      // Execute callback immediately in test environment
      setTimeout(callback, 0);
      return 1;
    });

    manager = new DirectKeyboardManager('test');
    mockInputManager = {
      isKeyboardShortcut: vi.fn().mockReturnValue(false),
      sendInput: vi.fn(),
      sendInputText: vi.fn(),
    };
    manager.setInputManager(mockInputManager as InputManager);

    // Mock clipboard API using Object.defineProperty
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        readText: vi.fn().mockResolvedValue('clipboard content'),
      },
      writable: true,
      configurable: true,
    });

    // Mock secure context for clipboard API to work
    Object.defineProperty(window, 'isSecureContext', {
      value: true,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    manager.cleanup();
    vi.useRealTimers();
    // Restore requestAnimationFrame
    global.requestAnimationFrame = originalRequestAnimationFrame;
  });

  it('should handle Paste quick key and send clipboard content', async () => {
    await manager.handleQuickKeyPress('Paste');
    expect(navigator.clipboard.readText).toHaveBeenCalled();
    expect(mockInputManager.sendInputText).toHaveBeenCalledWith('clipboard content');
  });

  it('recreates the hidden input only for an explicit keyboard reopen', () => {
    const originalInput = getManagerState().hiddenInput;
    expect(originalInput).toBeTruthy();

    originalInput?.focus();
    manager.ensureHiddenInputVisible();
    expect(getManagerState().hiddenInput).toBe(originalInput);

    vi.useFakeTimers();
    manager.focusHiddenInput(true);

    expect(getManagerState().hiddenInput).not.toBe(originalInput);
    expect(getManagerState().reopeningKeyboard).toBe(true);
    expect(getManagerState().focusRetentionInterval).toBeNull();

    vi.advanceTimersByTime(500);

    expect(getManagerState().reopeningKeyboard).toBe(false);
    expect(getManagerState().focusRetentionInterval).not.toBeNull();
  });

  it('restarts the reopen window after repeated TAP presses', () => {
    vi.useFakeTimers();

    manager.focusHiddenInput(true);
    vi.advanceTimersByTime(400);
    manager.focusHiddenInput(true);
    vi.advanceTimersByTime(100);

    expect(getManagerState().reopeningKeyboard).toBe(true);
    expect(getManagerState().focusRetentionInterval).toBeNull();

    vi.advanceTimersByTime(400);

    expect(getManagerState().reopeningKeyboard).toBe(false);
    expect(getManagerState().focusRetentionInterval).not.toBeNull();
  });

  it('cancels a pending keyboard reopen during cleanup', () => {
    vi.useFakeTimers();

    manager.focusHiddenInput(true);
    manager.cleanup();
    vi.runAllTimers();

    expect(getManagerState().hiddenInput).toBeNull();
    expect(getManagerState().keyboardReopenTimeout).toBeNull();
    expect(getManagerState().reopeningKeyboard).toBe(false);
    expect(getManagerState().focusRetentionInterval).toBeNull();
  });

  it.each([
    [' h', 'h'],
    ['h ', 'h'],
    ['hello world ', 'hello world'],
    [' /', '/'],
    [' /help', '/help'],
  ])('removes the placeholder space from %j', (inputValue, expected) => {
    const hiddenInput = getManagerState().hiddenInput;
    expect(hiddenInput).toBeTruthy();

    if (!hiddenInput) {
      return;
    }

    hiddenInput.value = inputValue;
    hiddenInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));

    expect(mockInputManager.sendInputText).toHaveBeenCalledWith(expected);
  });

  it('sends Escape without bubbling to app navigation', () => {
    const hiddenInput = getManagerState().hiddenInput;
    expect(hiddenInput).toBeTruthy();

    const documentKeydown = vi.fn();
    document.addEventListener('keydown', documentKeydown);

    try {
      const escapeEvent = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      hiddenInput?.dispatchEvent(escapeEvent);

      expect(escapeEvent.defaultPrevented).toBe(true);
      expect(mockInputManager.sendInput).toHaveBeenCalledWith('escape');
      expect(documentKeydown).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', documentKeydown);
    }
  });

  it.each([
    ['Enter', false, 'enter'],
    ['Tab', false, 'tab'],
    ['Tab', true, 'shift_tab'],
    ['Escape', false, 'escape'],
    ['ArrowUp', false, 'arrow_up'],
    ['ArrowDown', false, 'arrow_down'],
    ['ArrowLeft', false, 'arrow_left'],
    ['ArrowRight', false, 'arrow_right'],
    ['PageUp', false, 'page_up'],
    ['PageDown', false, 'page_down'],
    ['Home', false, 'home'],
    ['End', false, 'end'],
    ['Delete', false, 'delete'],
  ])('routes hardware %s from the hidden input', (key, shiftKey, expected) => {
    const hiddenInput = getManagerState().hiddenInput;
    const keyEvent = new KeyboardEvent('keydown', {
      key,
      shiftKey,
      bubbles: true,
      cancelable: true,
    });

    hiddenInput?.dispatchEvent(keyEvent);

    expect(keyEvent.defaultPrevented).toBe(true);
    expect(mockInputManager.sendInput).toHaveBeenCalledWith(expected);
  });

  it('preserves browser shortcuts from the hidden input', () => {
    const hiddenInput = getManagerState().hiddenInput;
    vi.mocked(mockInputManager.isKeyboardShortcut).mockReturnValueOnce(true);
    const keyEvent = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });

    hiddenInput?.dispatchEvent(keyEvent);

    expect(keyEvent.defaultPrevented).toBe(false);
    expect(mockInputManager.sendInput).not.toHaveBeenCalled();
  });
});
