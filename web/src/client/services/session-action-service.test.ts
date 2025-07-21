import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sessionActionService } from './session-action-service.js';
import type { AuthClient } from './auth-client.js';
import type { Session } from '../components/session-list.js';

// Mock the session-actions utility
vi.mock('../utils/session-actions.js', () => ({
  terminateSession: vi.fn().mockResolvedValue({ success: true }),
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
      expect(onSuccess).toHaveBeenCalledWith('clear', 'test-session-id');
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
    });
  });

  describe('deleteSession', () => {
    it('should terminate running sessions', async () => {
      const onSuccess = vi.fn();

      await sessionActionService.deleteSession(mockSession, {
        authClient: mockAuthClient,
        callbacks: { onSuccess },
      });

      expect(onSuccess).toHaveBeenCalledWith('terminate', 'test-session-id');
    });

    it('should clear exited sessions', async () => {
      const onSuccess = vi.fn();
      const exitedSession = { ...mockSession, status: 'exited' as const };

      await sessionActionService.deleteSession(exitedSession, {
        authClient: mockAuthClient,
        callbacks: { onSuccess },
      });

      expect(onSuccess).toHaveBeenCalledWith('clear', 'test-session-id');
    });
  });

  describe('deleteSessionById', () => {
    it('should delete session by ID successfully', async () => {
      const onSuccess = vi.fn();
      
      // Mock fetch
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => '',
      });

      const result = await sessionActionService.deleteSessionById('test-id', {
        authClient: mockAuthClient,
        callbacks: { onSuccess },
      });

      expect(result.success).toBe(true);
      expect(onSuccess).toHaveBeenCalledWith('terminate', 'test-id');
      expect(fetch).toHaveBeenCalledWith('/api/sessions/test-id', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer test-token' },
      });
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
    });
  });
});