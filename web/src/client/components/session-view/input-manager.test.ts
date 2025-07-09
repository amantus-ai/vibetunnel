import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../session-list.js';
import { InputManager } from './input-manager.js';

// Mock fetch globally
global.fetch = vi.fn();

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
    };

    inputManager.setSession(mockSession);
    inputManager.setCallbacks(mockCallbacks);

    // Reset fetch mock
    vi.mocked(global.fetch).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Option/Alt + Arrow key navigation', () => {
    it('should send Escape+b for Alt+Left arrow', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({}) };
      vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse as Response);

      const event = new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        altKey: true,
      });

      await inputManager.handleKeyboardInput(event);

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/sessions/test-session-id/input',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ text: '\x1bb' }),
        })
      );
    });

    it('should send Escape+f for Alt+Right arrow', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({}) };
      vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse as Response);

      const event = new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        altKey: true,
      });

      await inputManager.handleKeyboardInput(event);

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/sessions/test-session-id/input',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ text: '\x1bf' }),
        })
      );
    });

    it('should send regular arrow keys without Alt modifier', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({}) };
      vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse as Response);

      const event = new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        altKey: false,
      });

      await inputManager.handleKeyboardInput(event);

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/sessions/test-session-id/input',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ key: 'arrow_left' }),
        })
      );
    });

    it('should work with metaKey (Cmd on macOS) as well', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({}) };
      vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse as Response);

      const event = new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        metaKey: true,
      });

      await inputManager.handleKeyboardInput(event);

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/sessions/test-session-id/input',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ text: '\x1bf' }),
        })
      );
    });
  });

  describe('Option/Alt + Backspace/Delete word deletion', () => {
    it('should send Ctrl+W for Alt+Backspace', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({}) };
      vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse as Response);

      const event = new KeyboardEvent('keydown', {
        key: 'Backspace',
        altKey: true,
      });

      await inputManager.handleKeyboardInput(event);

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/sessions/test-session-id/input',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ text: '\x17' }),
        })
      );
    });

    it('should send Escape+d for Alt+Delete', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({}) };
      vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse as Response);

      const event = new KeyboardEvent('keydown', {
        key: 'Delete',
        altKey: true,
      });

      await inputManager.handleKeyboardInput(event);

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/sessions/test-session-id/input',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ text: '\x1bd' }),
        })
      );
    });

    it('should send regular Backspace without Alt modifier', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({}) };
      vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse as Response);

      const event = new KeyboardEvent('keydown', {
        key: 'Backspace',
        altKey: false,
      });

      await inputManager.handleKeyboardInput(event);

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/sessions/test-session-id/input',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ key: 'backspace' }),
        })
      );
    });

    it('should send regular Delete without Alt modifier', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({}) };
      vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse as Response);

      const event = new KeyboardEvent('keydown', {
        key: 'Delete',
        altKey: false,
      });

      await inputManager.handleKeyboardInput(event);

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/sessions/test-session-id/input',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ key: 'delete' }),
        })
      );
    });
  });

  describe('Cross-platform consistency', () => {
    it('should handle both altKey and metaKey consistently', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({}) };

      // Test Alt+Left
      vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse as Response);
      await inputManager.handleKeyboardInput(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true })
      );

      // Test Meta+Left (Cmd on macOS)
      vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse as Response);
      await inputManager.handleKeyboardInput(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', metaKey: true })
      );

      // Both should send the same escape sequence
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ text: '\x1bb' }),
        })
      );
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ text: '\x1bb' }),
        })
      );
    });

    it('should not interfere with standard copy/paste shortcuts', async () => {
      const _mockResponse = { ok: true, json: vi.fn().mockResolvedValue({}) };

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
});
