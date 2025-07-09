import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as eventUtils from '../../utils/event-utils.js';
import { LifecycleEventManager } from './lifecycle-event-manager.js';

// Mock the event utils module
vi.mock('../../utils/event-utils.js');

describe('LifecycleEventManager', () => {
  let manager: LifecycleEventManager;

  beforeEach(() => {
    manager = new LifecycleEventManager();
    vi.clearAllMocks();
  });

  describe('consumeEvent usage', () => {
    it('should call consumeEvent for keyboard shortcuts', () => {
      const mockCallbacks = {
        getDisableFocusManagement: vi.fn().mockReturnValue(false),
        setShowFileBrowser: vi.fn(),
        getInputManager: vi.fn().mockReturnValue({
          isKeyboardShortcut: vi.fn().mockReturnValue(false),
        }),
        handleKeyboardInput: vi.fn(),
        getIsMobile: vi.fn().mockReturnValue(false),
      };

      const mockSession = {
        id: 'test-session',
        status: 'running',
      };

      manager.setCallbacks(mockCallbacks as Parameters<typeof manager.setCallbacks>[0]);
      manager.setSession(mockSession as Parameters<typeof manager.setSession>[0]);

      // Test Cmd+O shortcut
      const cmdOEvent = new KeyboardEvent('keydown', {
        key: 'o',
        metaKey: true,
      });

      manager.keyboardHandler(cmdOEvent);

      expect(eventUtils.consumeEvent).toHaveBeenCalledWith(cmdOEvent);
      expect(mockCallbacks.setShowFileBrowser).toHaveBeenCalledWith(true);

      // Test regular key handling
      const regularKeyEvent = new KeyboardEvent('keydown', {
        key: 'a',
      });

      manager.keyboardHandler(regularKeyEvent);

      expect(eventUtils.consumeEvent).toHaveBeenCalledWith(regularKeyEvent);
      expect(mockCallbacks.handleKeyboardInput).toHaveBeenCalledWith(regularKeyEvent);
    });

    it('should not consume browser shortcuts', () => {
      const mockCallbacks = {
        getDisableFocusManagement: vi.fn().mockReturnValue(false),
        getInputManager: vi.fn().mockReturnValue({
          isKeyboardShortcut: vi.fn().mockReturnValue(true), // This is a browser shortcut
        }),
        getIsMobile: vi.fn().mockReturnValue(false),
      };

      manager.setCallbacks(mockCallbacks as Parameters<typeof manager.setCallbacks>[0]);

      // Test browser shortcut (e.g., Ctrl+C)
      const browserShortcut = new KeyboardEvent('keydown', {
        key: 'c',
        ctrlKey: true,
      });

      manager.keyboardHandler(browserShortcut);

      // Should not call consumeEvent for browser shortcuts
      expect(eventUtils.consumeEvent).not.toHaveBeenCalled();
    });
  });
});
