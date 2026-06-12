// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  afterEach(() => {
    manager.cleanup();
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
        getKeyboardCaptureActive: vi.fn().mockReturnValue(true),
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
        getKeyboardCaptureActive: vi.fn().mockReturnValue(true),
        handleKeyboardInput: vi.fn(),
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

    it('handles the file browser shortcut before browser shortcut filtering', () => {
      const mockCallbacks = {
        getDisableFocusManagement: vi.fn().mockReturnValue(false),
        setShowFileBrowser: vi.fn(),
        getInputManager: vi.fn().mockReturnValue({
          isKeyboardShortcut: vi.fn().mockReturnValue(true),
        }),
        handleKeyboardInput: vi.fn(),
      };

      manager.setCallbacks(mockCallbacks as Parameters<typeof manager.setCallbacks>[0]);

      const cmdOEvent = new KeyboardEvent('keydown', {
        key: 'o',
        metaKey: true,
      });
      manager.keyboardHandler(cmdOEvent);

      expect(eventUtils.consumeEvent).toHaveBeenCalledWith(cmdOEvent);
      expect(mockCallbacks.setShowFileBrowser).toHaveBeenCalledWith(true);
      expect(mockCallbacks.getInputManager).not.toHaveBeenCalled();
    });

    it.each([
      { metaKey: true, shiftKey: true },
      { ctrlKey: true, altKey: true },
      { metaKey: true, ctrlKey: true },
    ])('preserves modified browser O shortcuts: %o', (modifiers) => {
      const isKeyboardShortcut = vi.fn().mockReturnValue(true);
      const mockCallbacks = {
        getDisableFocusManagement: vi.fn().mockReturnValue(false),
        setShowFileBrowser: vi.fn(),
        getInputManager: vi.fn().mockReturnValue({ isKeyboardShortcut }),
        handleKeyboardInput: vi.fn(),
      };

      manager.setCallbacks(mockCallbacks as Parameters<typeof manager.setCallbacks>[0]);

      const event = new KeyboardEvent('keydown', {
        key: 'o',
        ...modifiers,
      });
      manager.keyboardHandler(event);

      expect(isKeyboardShortcut).toHaveBeenCalledWith(event);
      expect(eventUtils.consumeEvent).not.toHaveBeenCalled();
      expect(mockCallbacks.setShowFileBrowser).not.toHaveBeenCalled();
    });

    it('should leave native IME composition events to the browser', () => {
      const mockCallbacks = {
        getDisableFocusManagement: vi.fn().mockReturnValue(false),
        getInputManager: vi.fn(),
        handleKeyboardInput: vi.fn(),
      };

      manager.setCallbacks(mockCallbacks as Parameters<typeof manager.setCallbacks>[0]);
      manager.setSession({
        id: 'test-session',
        status: 'running',
      } as Parameters<typeof manager.setSession>[0]);

      const composingEvent = new KeyboardEvent('keydown', { key: 'Process' });
      Object.defineProperty(composingEvent, 'isComposing', { value: true });

      manager.keyboardHandler(composingEvent);

      expect(eventUtils.consumeEvent).not.toHaveBeenCalled();
      expect(mockCallbacks.getInputManager).not.toHaveBeenCalled();
      expect(mockCallbacks.handleKeyboardInput).not.toHaveBeenCalled();
    });

    it('should leave composition events marked by the desktop IME input untouched', () => {
      const mockCallbacks = {
        getDisableFocusManagement: vi.fn().mockReturnValue(false),
        getInputManager: vi.fn(),
        handleKeyboardInput: vi.fn(),
      };

      manager.setCallbacks(mockCallbacks as Parameters<typeof manager.setCallbacks>[0]);
      document.body.setAttribute('data-ime-composing', 'true');

      try {
        manager.keyboardHandler(new KeyboardEvent('keydown', { key: 'a' }));
      } finally {
        document.body.removeAttribute('data-ime-composing');
      }

      expect(eventUtils.consumeEvent).not.toHaveBeenCalled();
      expect(mockCallbacks.getInputManager).not.toHaveBeenCalled();
      expect(mockCallbacks.handleKeyboardInput).not.toHaveBeenCalled();
    });

    it('routes mobile hardware Escape to the running terminal', () => {
      const mockCallbacks = {
        getDisableFocusManagement: vi.fn().mockReturnValue(false),
        getInputManager: vi.fn().mockReturnValue({
          isKeyboardShortcut: vi.fn().mockReturnValue(false),
        }),
        handleKeyboardInput: vi.fn(),
      };

      manager.setCallbacks(mockCallbacks as Parameters<typeof manager.setCallbacks>[0]);
      manager.setSession({
        id: 'test-session',
        status: 'running',
      } as Parameters<typeof manager.setSession>[0]);

      const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape' });
      manager.mobileHardwareKeyboardHandler(escapeEvent);

      expect(eventUtils.consumeEvent).toHaveBeenCalledWith(escapeEvent);
      expect(mockCallbacks.handleKeyboardInput).toHaveBeenCalledWith(escapeEvent);
    });

    it('routes ordinary mobile hardware keys to the running terminal', () => {
      const mockCallbacks = {
        getDisableFocusManagement: vi.fn().mockReturnValue(false),
        getInputManager: vi.fn().mockReturnValue({
          isKeyboardShortcut: vi.fn().mockReturnValue(false),
        }),
        handleKeyboardInput: vi.fn(),
      };

      manager.setCallbacks(mockCallbacks as Parameters<typeof manager.setCallbacks>[0]);
      manager.setSession({
        id: 'test-session',
        status: 'running',
      } as Parameters<typeof manager.setSession>[0]);

      const keyEvent = new KeyboardEvent('keydown', { key: 'a' });
      manager.mobileHardwareKeyboardHandler(keyEvent);

      expect(eventUtils.consumeEvent).toHaveBeenCalledWith(keyEvent);
      expect(mockCallbacks.handleKeyboardInput).toHaveBeenCalledWith(keyEvent);
    });

    it('leaves mobile keyboard events from editable controls untouched', () => {
      const mockCallbacks = {
        getDisableFocusManagement: vi.fn().mockReturnValue(false),
        getInputManager: vi.fn(),
        handleKeyboardInput: vi.fn(),
      };
      const input = document.createElement('input');
      document.body.appendChild(input);

      manager.setCallbacks(mockCallbacks as Parameters<typeof manager.setCallbacks>[0]);
      manager.setSession({
        id: 'test-session',
        status: 'running',
      } as Parameters<typeof manager.setSession>[0]);

      try {
        input.addEventListener('keydown', manager.mobileHardwareKeyboardHandler);
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      } finally {
        input.remove();
      }

      expect(eventUtils.consumeEvent).not.toHaveBeenCalled();
      expect(mockCallbacks.getInputManager).not.toHaveBeenCalled();
      expect(mockCallbacks.handleKeyboardInput).not.toHaveBeenCalled();
    });

    it('routes the mobile file browser shortcut from the hidden keyboard input', () => {
      const mockCallbacks = {
        getDisableFocusManagement: vi.fn().mockReturnValue(false),
        setShowFileBrowser: vi.fn(),
        getInputManager: vi.fn(),
        handleKeyboardInput: vi.fn(),
      };
      const input = document.createElement('input');
      document.body.appendChild(input);

      manager.setCallbacks(mockCallbacks as Parameters<typeof manager.setCallbacks>[0]);

      try {
        input.addEventListener('keydown', manager.mobileHardwareKeyboardHandler);
        input.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'o',
            metaKey: true,
            bubbles: true,
          })
        );
      } finally {
        input.remove();
      }

      expect(eventUtils.consumeEvent).toHaveBeenCalledTimes(1);
      expect(mockCallbacks.setShowFileBrowser).toHaveBeenCalledWith(true);
      expect(mockCallbacks.getInputManager).not.toHaveBeenCalled();
      expect(mockCallbacks.handleKeyboardInput).not.toHaveBeenCalled();
    });

    it('routes hardware keys from the terminal paste input', () => {
      const mockCallbacks = {
        getDisableFocusManagement: vi.fn().mockReturnValue(false),
        getInputManager: vi.fn().mockReturnValue({
          isKeyboardShortcut: vi.fn().mockReturnValue(false),
        }),
        handleKeyboardInput: vi.fn(),
      };
      const pasteInput = document.createElement('textarea');
      pasteInput.className = 'terminal-paste-input';
      document.body.appendChild(pasteInput);

      manager.setCallbacks(mockCallbacks as Parameters<typeof manager.setCallbacks>[0]);
      manager.setSession({
        id: 'test-session',
        status: 'running',
      } as Parameters<typeof manager.setSession>[0]);

      try {
        pasteInput.addEventListener('keydown', manager.mobileHardwareKeyboardHandler);
        pasteInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      } finally {
        pasteInput.remove();
      }

      expect(eventUtils.consumeEvent).toHaveBeenCalledTimes(1);
      expect(mockCallbacks.handleKeyboardInput).toHaveBeenCalledTimes(1);
    });

    it('routes hardware keys from the contenteditable terminal surface', () => {
      const mockCallbacks = {
        getDisableFocusManagement: vi.fn().mockReturnValue(false),
        getInputManager: vi.fn().mockReturnValue({
          isKeyboardShortcut: vi.fn().mockReturnValue(false),
        }),
        handleKeyboardInput: vi.fn(),
      };
      const terminal = document.createElement('vibe-terminal');
      const terminalSurface = document.createElement('div');
      terminalSurface.className = 'terminal-container';
      terminalSurface.contentEditable = 'true';
      terminal.appendChild(terminalSurface);
      document.body.appendChild(terminal);

      manager.setCallbacks(mockCallbacks as Parameters<typeof manager.setCallbacks>[0]);
      manager.setSession({
        id: 'test-session',
        status: 'running',
      } as Parameters<typeof manager.setSession>[0]);

      try {
        terminalSurface.addEventListener('keydown', manager.mobileHardwareKeyboardHandler);
        terminalSurface.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'a', bubbles: true, composed: true })
        );
      } finally {
        terminal.remove();
      }

      expect(eventUtils.consumeEvent).toHaveBeenCalledTimes(1);
      expect(mockCallbacks.handleKeyboardInput).toHaveBeenCalledTimes(1);
    });

    it('routes hardware keys from the terminal renderer textarea', () => {
      const mockCallbacks = {
        getDisableFocusManagement: vi.fn().mockReturnValue(false),
        getInputManager: vi.fn().mockReturnValue({
          isKeyboardShortcut: vi.fn().mockReturnValue(false),
        }),
        handleKeyboardInput: vi.fn(),
      };
      const terminal = document.createElement('vibe-terminal');
      const terminalInput = document.createElement('textarea');
      terminalInput.setAttribute('aria-label', 'Terminal input');
      terminal.appendChild(terminalInput);
      document.body.appendChild(terminal);

      manager.setCallbacks(mockCallbacks as Parameters<typeof manager.setCallbacks>[0]);
      manager.setSession({
        id: 'test-session',
        status: 'running',
      } as Parameters<typeof manager.setSession>[0]);

      try {
        terminalInput.addEventListener('keydown', manager.mobileHardwareKeyboardHandler);
        terminalInput.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'a', bubbles: true, composed: true })
        );
      } finally {
        terminal.remove();
      }

      expect(eventUtils.consumeEvent).toHaveBeenCalledTimes(1);
      expect(mockCallbacks.handleKeyboardInput).toHaveBeenCalledTimes(1);
    });

    it('leaves mobile keyboard events from Shadow DOM editors untouched', () => {
      const mockCallbacks = {
        getDisableFocusManagement: vi.fn().mockReturnValue(false),
        getInputManager: vi.fn(),
        handleKeyboardInput: vi.fn(),
      };
      const inlineEdit = document.createElement('inline-edit');
      const shadowRoot = inlineEdit.attachShadow({ mode: 'open' });
      const input = document.createElement('input');
      shadowRoot.appendChild(input);
      document.body.appendChild(inlineEdit);

      manager.setCallbacks(mockCallbacks as Parameters<typeof manager.setCallbacks>[0]);
      manager.setSession({
        id: 'test-session',
        status: 'running',
      } as Parameters<typeof manager.setSession>[0]);

      try {
        document.addEventListener('keydown', manager.mobileHardwareKeyboardHandler);
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'a', bubbles: true, composed: true })
        );
      } finally {
        document.removeEventListener('keydown', manager.mobileHardwareKeyboardHandler);
        inlineEdit.remove();
      }

      expect(eventUtils.consumeEvent).not.toHaveBeenCalled();
      expect(mockCallbacks.getInputManager).not.toHaveBeenCalled();
      expect(mockCallbacks.handleKeyboardInput).not.toHaveBeenCalled();
    });

    it('leaves mobile browser shortcuts to the browser', () => {
      const mockCallbacks = {
        getDisableFocusManagement: vi.fn().mockReturnValue(false),
        getInputManager: vi.fn().mockReturnValue({
          isKeyboardShortcut: vi.fn().mockReturnValue(true),
        }),
        handleKeyboardInput: vi.fn(),
      };

      manager.setCallbacks(mockCallbacks as Parameters<typeof manager.setCallbacks>[0]);
      manager.setSession({
        id: 'test-session',
        status: 'running',
      } as Parameters<typeof manager.setSession>[0]);

      manager.mobileHardwareKeyboardHandler(
        new KeyboardEvent('keydown', { key: 'l', metaKey: true })
      );

      expect(eventUtils.consumeEvent).not.toHaveBeenCalled();
      expect(mockCallbacks.handleKeyboardInput).not.toHaveBeenCalled();
    });

    it('registers and removes the mobile hardware keyboard listener', () => {
      const mockCallbacks = {
        getDisableFocusManagement: vi.fn().mockReturnValue(false),
        getInputManager: vi.fn().mockReturnValue({
          isKeyboardShortcut: vi.fn().mockReturnValue(false),
        }),
        handleKeyboardInput: vi.fn(),
      };
      const lifecycle = manager as unknown as {
        setupEventListeners: (isMobile: boolean) => void;
      };

      manager.setCallbacks(mockCallbacks as Parameters<typeof manager.setCallbacks>[0]);
      manager.setSession({
        id: 'test-session',
        status: 'running',
      } as Parameters<typeof manager.setSession>[0]);
      lifecycle.setupEventListeners(true);

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
      expect(mockCallbacks.handleKeyboardInput).toHaveBeenCalledTimes(1);

      manager.cleanup();
      vi.clearAllMocks();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

      expect(mockCallbacks.handleKeyboardInput).not.toHaveBeenCalled();
    });
  });
});
