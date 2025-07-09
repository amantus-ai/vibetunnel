import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LifecycleEventManager } from './lifecycle-event-manager.js';

describe('LifecycleEventManager', () => {
  let manager: LifecycleEventManager;

  beforeEach(() => {
    manager = new LifecycleEventManager();
  });

  describe('preventAndStopEvent helper', () => {
    it('should call preventDefault and stopPropagation on events', () => {
      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as Event;

      // Access private method through type assertion for testing
      (manager as unknown as { preventAndStopEvent(e: Event): void }).preventAndStopEvent(
        mockEvent
      );

      expect(mockEvent.preventDefault).toHaveBeenCalledOnce();
      expect(mockEvent.stopPropagation).toHaveBeenCalledOnce();
    });
  });

  describe('keyboard event handling', () => {
    it('should use preventAndStopEvent helper for keyboard shortcuts', () => {
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

      const preventAndStopEventSpy = vi.spyOn(
        manager as unknown as { preventAndStopEvent(e: Event): void },
        'preventAndStopEvent'
      );

      // Test Cmd+O shortcut
      const cmdOEvent = new KeyboardEvent('keydown', {
        key: 'o',
        metaKey: true,
      });

      manager.keyboardHandler(cmdOEvent);

      expect(preventAndStopEventSpy).toHaveBeenCalledWith(cmdOEvent);
      expect(mockCallbacks.setShowFileBrowser).toHaveBeenCalledWith(true);

      // Test regular key handling
      const regularKeyEvent = new KeyboardEvent('keydown', {
        key: 'a',
      });

      manager.keyboardHandler(regularKeyEvent);

      expect(preventAndStopEventSpy).toHaveBeenCalledWith(regularKeyEvent);
      expect(mockCallbacks.handleKeyboardInput).toHaveBeenCalledWith(regularKeyEvent);
    });

    it('should not prevent browser shortcuts', () => {
      const mockCallbacks = {
        getDisableFocusManagement: vi.fn().mockReturnValue(false),
        getInputManager: vi.fn().mockReturnValue({
          isKeyboardShortcut: vi.fn().mockReturnValue(true), // This is a browser shortcut
        }),
        getIsMobile: vi.fn().mockReturnValue(false),
      };

      manager.setCallbacks(mockCallbacks as Parameters<typeof manager.setCallbacks>[0]);

      const preventAndStopEventSpy = vi.spyOn(
        manager as unknown as { preventAndStopEvent(e: Event): void },
        'preventAndStopEvent'
      );

      // Test browser shortcut (e.g., Ctrl+C)
      const browserShortcut = new KeyboardEvent('keydown', {
        key: 'c',
        ctrlKey: true,
      });

      manager.keyboardHandler(browserShortcut);

      // Should not call preventAndStopEvent for browser shortcuts
      expect(preventAndStopEventSpy).not.toHaveBeenCalled();
    });
  });
});
