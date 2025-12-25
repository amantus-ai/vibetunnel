// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../../../shared/types.js';
import { InputManager } from './input-manager.js';

// Mock fetch globally
global.fetch = vi.fn();

const terminalSocketClientMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  getConnectionStatus: vi.fn(() => true),
  onConnectionStateChange: vi.fn(() => () => {}),
  sendInputText: vi.fn().mockReturnValue(true),
  sendInputKey: vi.fn().mockReturnValue(true),
}));

vi.mock('../../services/terminal-socket-client.js', () => ({
  terminalSocketClient: terminalSocketClientMock,
}));

// We don't need to mock browser-shortcuts because the tests should verify
// the actual behavior of the module

describe('InputManager', () => {
  let inputManager: InputManager;
  let mockSession: Session;
  let mockCallbacks: { requestUpdate: vi.Mock };

  beforeEach(() => {
    inputManager = new InputManager();
    mockSession = {
      id: 'test-session-id',
      name: 'Test Session',
      status: 'running',
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      command: 'bash',
      pid: 12345,
    };

    mockCallbacks = {
      requestUpdate: vi.fn(),
      getKeyboardCaptureActive: vi.fn().mockReturnValue(false), // Default to capture OFF for browser shortcut tests
    };

    inputManager.setSession(mockSession);
    inputManager.setCallbacks(mockCallbacks);

    // Reset fetch mock
    vi.mocked(global.fetch).mockReset();
    terminalSocketClientMock.sendInputText.mockClear();
    terminalSocketClientMock.sendInputKey.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Option/Alt + Arrow key navigation', () => {
    it('should send Escape+b for Alt+Left arrow', async () => {
      const event = new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        altKey: true,
      });

      await inputManager.handleKeyboardInput(event);

      expect(terminalSocketClientMock.sendInputText).toHaveBeenCalledWith(
        'test-session-id',
        '\x1bb'
      );
    });

    it('should send Escape+f for Alt+Right arrow', async () => {
      const event = new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        altKey: true,
      });

      await inputManager.handleKeyboardInput(event);

      expect(terminalSocketClientMock.sendInputText).toHaveBeenCalledWith(
        'test-session-id',
        '\x1bf'
      );
    });

    it('should send regular arrow keys without Alt modifier', async () => {
      const event = new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        altKey: false,
      });

      await inputManager.handleKeyboardInput(event);

      expect(terminalSocketClientMock.sendInputKey).toHaveBeenCalledWith(
        'test-session-id',
        'arrow_left'
      );
    });
  });

  describe('Option/Alt + Backspace word deletion', () => {
    it('should send Ctrl+W for Alt+Backspace', async () => {
      const event = new KeyboardEvent('keydown', {
        key: 'Backspace',
        altKey: true,
      });

      await inputManager.handleKeyboardInput(event);

      expect(terminalSocketClientMock.sendInputText).toHaveBeenCalledWith(
        'test-session-id',
        '\x17'
      );
    });

    it('should send regular Backspace without Alt modifier', async () => {
      const event = new KeyboardEvent('keydown', {
        key: 'Backspace',
        altKey: false,
      });

      await inputManager.handleKeyboardInput(event);

      expect(terminalSocketClientMock.sendInputKey).toHaveBeenCalledWith(
        'test-session-id',
        'backspace'
      );
    });
  });

  describe('Cross-platform consistency', () => {
    it('should not interfere with standard copy/paste shortcuts', async () => {
      // Mock navigator.platform for macOS
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        configurable: true,
      });

      // Test Cmd+C on macOS (should not send anything)
      const copyEvent = new KeyboardEvent('keydown', {
        key: 'c',
        metaKey: true,
      });
      await inputManager.handleKeyboardInput(copyEvent);

      // Test Cmd+V on macOS (should not send anything)
      const pasteEvent = new KeyboardEvent('keydown', {
        key: 'v',
        metaKey: true,
      });
      await inputManager.handleKeyboardInput(pasteEvent);

      // Should not have called fetch for copy/paste
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Session state handling', () => {
    it('should not send input to exited sessions', async () => {
      mockSession.status = 'exited';

      const event = new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        altKey: true,
      });

      await inputManager.handleKeyboardInput(event);

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should update session status when receiving 400 response', async () => {
      // Force HTTP fallback
      terminalSocketClientMock.sendInputText.mockReturnValueOnce(false);
      const mockResponse = {
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue({}),
      };
      vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse as Response);

      const event = new KeyboardEvent('keydown', {
        key: 'a',
      });

      await inputManager.handleKeyboardInput(event);

      expect(mockSession.status).toBe('exited');
      expect(mockCallbacks.requestUpdate).toHaveBeenCalled();
    });
  });

  describe('Browser shortcut detection', () => {
    it('should detect Cmd+Shift+A as browser shortcut on macOS', () => {
      Object.defineProperty(navigator, 'platform', {
        writable: true,
        value: 'MacIntel',
      });

      const event = new KeyboardEvent('keydown', {
        key: 'A',
        metaKey: true,
        shiftKey: true,
      });
      // Mock a target element (simulating event fired on document body)
      Object.defineProperty(event, 'target', {
        value: document.createElement('div'),
        configurable: true,
      });

      expect(inputManager.isKeyboardShortcut(event)).toBe(true);
    });

    it('should detect Cmd+1-9 as browser shortcuts on macOS', () => {
      Object.defineProperty(navigator, 'platform', {
        writable: true,
        value: 'MacIntel',
      });

      for (let i = 1; i <= 9; i++) {
        const event = new KeyboardEvent('keydown', {
          key: i.toString(),
          metaKey: true,
        });
        // Mock a target element
        Object.defineProperty(event, 'target', {
          value: document.createElement('div'),
          configurable: true,
        });

        expect(inputManager.isKeyboardShortcut(event)).toBe(true);
      }
    });

    it('should detect Cmd+Option+Left/Right as browser shortcuts on macOS', () => {
      Object.defineProperty(navigator, 'platform', {
        writable: true,
        value: 'MacIntel',
      });

      const leftEvent = new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        metaKey: true,
        altKey: true,
      });
      Object.defineProperty(leftEvent, 'target', {
        value: document.createElement('div'),
        configurable: true,
      });

      const rightEvent = new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        metaKey: true,
        altKey: true,
      });
      Object.defineProperty(rightEvent, 'target', {
        value: document.createElement('div'),
        configurable: true,
      });

      expect(inputManager.isKeyboardShortcut(leftEvent)).toBe(true);
      expect(inputManager.isKeyboardShortcut(rightEvent)).toBe(true);
    });
  });
});
