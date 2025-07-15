/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectKeyboardManager } from './direct-keyboard-manager';
import type { InputManager } from './input-manager';

describe('DirectKeyboardManager', () => {
  let manager: DirectKeyboardManager;
  let mockInputManager: Pick<InputManager, 'sendInputText'>;
  let originalRequestAnimationFrame: typeof requestAnimationFrame;

  beforeEach(() => {
    // Mock requestAnimationFrame
    originalRequestAnimationFrame = global.requestAnimationFrame;
    global.requestAnimationFrame = vi.fn((callback) => {
      // Execute callback immediately in test environment
      setTimeout(callback, 0);
      return 1;
    });

    manager = new DirectKeyboardManager('test');
    mockInputManager = { sendInputText: vi.fn() };
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
    // Restore requestAnimationFrame
    global.requestAnimationFrame = originalRequestAnimationFrame;
  });

  it('should handle Paste quick key and send clipboard content', async () => {
    await manager.handleQuickKeyPress('Paste');
    expect(navigator.clipboard.readText).toHaveBeenCalled();
    expect(mockInputManager.sendInputText).toHaveBeenCalledWith('clipboard content');
  });
});
