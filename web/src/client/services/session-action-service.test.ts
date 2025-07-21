/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../../shared/types.js';
import type { AuthClient } from './auth-client.js';
import { sessionActionService } from './session-action-service.js';

// Mock the session-actions utility - must use vi.hoisted
const { mockTerminateSession } = vi.hoisted(() => {
  return {
    mockTerminateSession: vi.fn(),
  };
});

vi.mock('../utils/session-actions.js', () => ({
  terminateSession: mockTerminateSession,
}));

describe('SessionActionService', () => {
  const mockAuthClient: AuthClient = {
    getAuthHeader: () => ({ Authorization: 'Bearer test-token' }),
    isAuthenticated: () => true,
    login: vi.fn(),
    logout: vi.fn(),
    on: vi.fn(),
    emit: vi.fn(),
    removeListener: vi.fn(),
  };

  const mockSession: Session = {
    id: 'test-session-id',
    name: 'Test Session',
    status: 'running',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    path: '/test/path',
    cols: 80,
    rows: 24,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock implementation to default success
    mockTerminateSession.mockResolvedValue({ success: true });
    // Mock window.dispatchEvent using happy-dom's window
    vi.spyOn(window, 'dispatchEvent').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('singleton pattern', () => {
    it('should return the same instance', () => {
      const instance1 = sessionActionService;
      const instance2 = sessionActionService;
      expect(instance1).toBe(instance2);
    });
  });

  describe('terminateSession', () => {
    it('should terminate a running session successfully', async () => {
      const onSuccess = vi.fn();
      const onError = vi.fn();

      const result = await sessionActionService.terminateSession(mockSession, {
        authClient: mockAuthClient,
        callbacks: {
          onSuccess,
          onError,
        },
      });

      expect(result.success).toBe(true);
      expect(onSuccess).toHaveBeenCalledWith('terminate', 'test-session-id');
      expect(onError).not.toHaveBeenCalled();
      expect(mockTerminateSession).toHaveBeenCalledWith(
        'test-session-id',
        mockAuthClient,
        'running'
      );
      // Check global event was dispatched
      expect(window.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'session-action',
          detail: {
            action: 'terminate',
            sessionId: 'test-session-id',
          },
        })
      );
    });

    it('should not terminate a non-running session', async () => {
      const onError = vi.fn();
      const exitedSession = { ...mockSession, status: 'exited' as const };

      const result = await sessionActionService.terminateSession(exitedSession, {
        authClient: mockAuthClient,
        callbacks: { onError },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid session state');
      expect(onError).toHaveBeenCalledWith('Cannot terminate session: invalid state');
      expect(mockTerminateSession).not.toHaveBeenCalled();
      expect(window.dispatchEvent).not.toHaveBeenCalled();
    });

    it('should handle null session', async () => {
      const onError = vi.fn();

      const result = await sessionActionService.terminateSession(null as unknown as Session, {
        authClient: mockAuthClient,
        callbacks: { onError },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid session state');
      expect(onError).toHaveBeenCalledWith('Cannot terminate session: invalid state');
    });

    it('should handle termination failure', async () => {
      const onError = vi.fn();
      const onSuccess = vi.fn();
      mockTerminateSession.mockResolvedValueOnce({
        success: false,
        error: 'Network error',
      });

      const result = await sessionActionService.terminateSession(mockSession, {
        authClient: mockAuthClient,
        callbacks: { onError, onSuccess },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
      expect(onError).toHaveBeenCalledWith('Failed to terminate session: Network error');
      expect(onSuccess).not.toHaveBeenCalled();
      expect(window.dispatchEvent).not.toHaveBeenCalled();
    });

    it('should work without callbacks', async () => {
      const result = await sessionActionService.terminateSession(mockSession, {
        authClient: mockAuthClient,
      });

      expect(result.success).toBe(true);
      expect(mockTerminateSession).toHaveBeenCalled();
      expect(window.dispatchEvent).toHaveBeenCalled();
    });
  });

  describe('clearSession', () => {
    it('should clear an exited session successfully', async () => {
      const onSuccess = vi.fn();
      const exitedSession = { ...mockSession, status: 'exited' as const };

      const result = await sessionActionService.clearSession(exitedSession, {
        authClient: mockAuthClient,
        callbacks: { onSuccess },
      });

      expect(result.success).toBe(true);
      expect(onSuccess).toHaveBeenCalledWith('delete', 'test-session-id');
      expect(mockTerminateSession).toHaveBeenCalledWith(
        'test-session-id',
        mockAuthClient,
        'exited'
      );
      expect(window.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'session-action',
          detail: {
            action: 'delete',
            sessionId: 'test-session-id',
          },
        })
      );
    });

    it('should not clear a running session', async () => {
      const onError = vi.fn();

      const result = await sessionActionService.clearSession(mockSession, {
        authClient: mockAuthClient,
        callbacks: { onError },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid session state');
      expect(onError).toHaveBeenCalledWith('Cannot clear session: invalid state');
      expect(mockTerminateSession).not.toHaveBeenCalled();
      expect(window.dispatchEvent).not.toHaveBeenCalled();
    });

    it('should handle null session', async () => {
      const onError = vi.fn();

      const result = await sessionActionService.clearSession(null as unknown as Session, {
        authClient: mockAuthClient,
        callbacks: { onError },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid session state');
      expect(onError).toHaveBeenCalledWith('Cannot clear session: invalid state');
    });

    it('should handle clear failure', async () => {
      const onError = vi.fn();
      const onSuccess = vi.fn();
      const exitedSession = { ...mockSession, status: 'exited' as const };
      mockTerminateSession.mockResolvedValueOnce({
        success: false,
        error: 'Database error',
      });

      const result = await sessionActionService.clearSession(exitedSession, {
        authClient: mockAuthClient,
        callbacks: { onError, onSuccess },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
      expect(onError).toHaveBeenCalledWith('Failed to clear session: Database error');
      expect(onSuccess).not.toHaveBeenCalled();
      expect(window.dispatchEvent).not.toHaveBeenCalled();
    });

    it('should work without callbacks', async () => {
      const exitedSession = { ...mockSession, status: 'exited' as const };

      const result = await sessionActionService.clearSession(exitedSession, {
        authClient: mockAuthClient,
      });

      expect(result.success).toBe(true);
      expect(mockTerminateSession).toHaveBeenCalled();
      expect(window.dispatchEvent).toHaveBeenCalled();
    });
  });

  describe('deleteSession', () => {
    it('should terminate running sessions', async () => {
      const onSuccess = vi.fn();

      const result = await sessionActionService.deleteSession(mockSession, {
        authClient: mockAuthClient,
        callbacks: { onSuccess },
      });

      expect(result.success).toBe(true);
      expect(onSuccess).toHaveBeenCalledWith('terminate', 'test-session-id');
      expect(mockTerminateSession).toHaveBeenCalledWith(
        'test-session-id',
        mockAuthClient,
        'running'
      );
    });

    it('should clear exited sessions', async () => {
      const onSuccess = vi.fn();
      const exitedSession = { ...mockSession, status: 'exited' as const };

      const result = await sessionActionService.deleteSession(exitedSession, {
        authClient: mockAuthClient,
        callbacks: { onSuccess },
      });

      expect(result.success).toBe(true);
      expect(onSuccess).toHaveBeenCalledWith('delete', 'test-session-id');
      expect(mockTerminateSession).toHaveBeenCalledWith(
        'test-session-id',
        mockAuthClient,
        'exited'
      );
    });

    it('should handle unsupported session status', async () => {
      const onError = vi.fn();
      const pendingSession = {
        ...mockSession,
        status: 'pending' as unknown as 'running' | 'exited',
      };

      const result = await sessionActionService.deleteSession(pendingSession, {
        authClient: mockAuthClient,
        callbacks: { onError },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Cannot delete session with status: pending');
      expect(onError).toHaveBeenCalledWith('Cannot delete session with status: pending');
      expect(mockTerminateSession).not.toHaveBeenCalled();
    });

    it('should propagate errors from underlying methods', async () => {
      const onError = vi.fn();
      mockTerminateSession.mockResolvedValueOnce({
        success: false,
        error: 'Permission denied',
      });

      const result = await sessionActionService.deleteSession(mockSession, {
        authClient: mockAuthClient,
        callbacks: { onError },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Permission denied');
      expect(onError).toHaveBeenCalledWith('Failed to terminate session: Permission denied');
    });
  });

  describe('deleteSessionById', () => {
    it('should delete session by ID successfully', async () => {
      const onSuccess = vi.fn();

      // Mock fetch as Response-like object
      const mockResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue(''),
      };
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await sessionActionService.deleteSessionById('test-id', {
        authClient: mockAuthClient,
        callbacks: { onSuccess },
      });

      expect(result.success).toBe(true);
      expect(onSuccess).toHaveBeenCalledWith('delete', 'test-id');
      expect(fetch).toHaveBeenCalledWith('/api/sessions/test-id', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer test-token' },
      });
      expect(window.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'session-action',
          detail: {
            action: 'delete',
            sessionId: 'test-id',
          },
        })
      );
    });

    it('should handle deletion errors', async () => {
      const onError = vi.fn();

      // Mock fetch to fail
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Not found',
      });

      const result = await sessionActionService.deleteSessionById('test-id', {
        authClient: mockAuthClient,
        callbacks: { onError },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Delete failed: 404');
      expect(onError).toHaveBeenCalledWith('Delete failed: 404');
      expect(window.dispatchEvent).not.toHaveBeenCalled();
    });

    it('should handle network errors', async () => {
      const onError = vi.fn();

      // Mock fetch to throw
      global.fetch = vi.fn().mockRejectedValue(new Error('Network failure'));

      const result = await sessionActionService.deleteSessionById('test-id', {
        authClient: mockAuthClient,
        callbacks: { onError },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network failure');
      expect(onError).toHaveBeenCalledWith('Network failure');
    });

    it('should handle non-Error exceptions', async () => {
      const onError = vi.fn();

      // Mock fetch to throw non-Error
      global.fetch = vi.fn().mockRejectedValue('String error');

      const result = await sessionActionService.deleteSessionById('test-id', {
        authClient: mockAuthClient,
        callbacks: { onError },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
      expect(onError).toHaveBeenCalledWith('Unknown error');
    });

    it('should work without callbacks', async () => {
      const mockResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue(''),
      };
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await sessionActionService.deleteSessionById('test-id', {
        authClient: mockAuthClient,
      });

      expect(result.success).toBe(true);
      expect(fetch).toHaveBeenCalled();
      expect(window.dispatchEvent).toHaveBeenCalled();
    });

    it('should handle empty session ID', async () => {
      const onError = vi.fn();

      // Even with empty ID, the method should attempt the call
      // The server will handle validation
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Invalid session ID',
      });

      const result = await sessionActionService.deleteSessionById('', {
        authClient: mockAuthClient,
        callbacks: { onError },
      });

      expect(result.success).toBe(false);
      expect(fetch).toHaveBeenCalledWith('/api/sessions/', expect.any(Object));
    });
  });

  describe('event emission', () => {
    it('should not emit events when window is undefined', async () => {
      // Remove window.dispatchEvent mock temporarily
      vi.mocked(window.dispatchEvent).mockRestore();

      // Mock window as undefined temporarily
      const originalWindow = global.window;
      // @ts-expect-error - Testing edge case
      delete global.window;

      const result = await sessionActionService.terminateSession(mockSession, {
        authClient: mockAuthClient,
      });

      expect(result.success).toBe(true);
      // No error should be thrown even without window

      // Restore window
      global.window = originalWindow;
    });

    it('should emit custom events with correct detail structure', async () => {
      const dispatchSpy = vi.mocked(window.dispatchEvent);

      await sessionActionService.terminateSession(mockSession, {
        authClient: mockAuthClient,
      });

      const eventCall = dispatchSpy.mock.calls[0];
      const event = eventCall[0] as CustomEvent;

      expect(event).toBeInstanceOf(CustomEvent);
      expect(event.type).toBe('session-action');
      expect(event.detail).toEqual({
        action: 'terminate',
        sessionId: 'test-session-id',
      });
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle sessions with missing properties gracefully', async () => {
      const incompleteSession = {
        id: 'test-id',
        status: 'running',
      } as Session;

      const result = await sessionActionService.terminateSession(incompleteSession, {
        authClient: mockAuthClient,
      });

      expect(result.success).toBe(true);
      expect(mockTerminateSession).toHaveBeenCalledWith('test-id', mockAuthClient, 'running');
    });

    it('should handle concurrent operations', async () => {
      const onSuccess = vi.fn();

      // Start multiple operations concurrently
      const operations = [
        sessionActionService.terminateSession(mockSession, {
          authClient: mockAuthClient,
          callbacks: { onSuccess },
        }),
        sessionActionService.terminateSession(
          { ...mockSession, id: 'session-2' },
          {
            authClient: mockAuthClient,
            callbacks: { onSuccess },
          }
        ),
      ];

      const results = await Promise.all(operations);

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success)).toBe(true);
      expect(onSuccess).toHaveBeenCalledTimes(2);
      expect(onSuccess).toHaveBeenCalledWith('terminate', 'test-session-id');
      expect(onSuccess).toHaveBeenCalledWith('terminate', 'session-2');
    });
  });
});
