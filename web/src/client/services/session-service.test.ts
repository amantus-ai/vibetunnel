/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TitleMode } from '../../shared/types';
import type { AuthClient } from './auth-client';
import { type SessionCreateData, SessionService } from './session-service';

describe('SessionService', () => {
  let service: SessionService;
  let mockAuthClient: AuthClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Mock fetch
    fetchMock = vi.fn();
    global.fetch = fetchMock;

    // Mock auth client
    mockAuthClient = {
      getAuthHeader: vi.fn(() => ({ Authorization: 'Bearer test-token' })),
    } as unknown as AuthClient;

    // Create service instance
    service = new SessionService(mockAuthClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createSession', () => {
    const mockSessionData: SessionCreateData = {
      command: ['npm', 'run', 'dev'],
      workingDir: '/home/user/project',
      name: 'Test Session',
      spawn_terminal: false,
      cols: 120,
      rows: 30,
      titleMode: TitleMode.DYNAMIC,
    };

    it('should create a session successfully', async () => {
      const mockResult = {
        sessionId: 'session-123',
        message: 'Session created successfully',
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      });

      const result = await service.createSession(mockSessionData);

      expect(fetchMock).toHaveBeenCalledWith('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify(mockSessionData),
      });
      expect(result).toEqual(mockResult);
    });

    it('should include auth header in request', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sessionId: 'test-123' }),
      });

      await service.createSession(mockSessionData);

      expect(mockAuthClient.getAuthHeader).toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/sessions',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      );
    });

    it('should handle error response with details', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          details: 'Invalid working directory',
        }),
      });

      await expect(service.createSession(mockSessionData)).rejects.toThrow(
        'Invalid working directory'
      );
    });

    it('should handle error response with error field', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          error: 'Internal server error',
        }),
      });

      await expect(service.createSession(mockSessionData)).rejects.toThrow('Internal server error');
    });

    it('should handle error response with unknown format', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
      });

      await expect(service.createSession(mockSessionData)).rejects.toThrow('Unknown error');
    });

    it('should handle network errors', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network failure'));

      await expect(service.createSession(mockSessionData)).rejects.toThrow('Network failure');
    });

    it('should handle JSON parsing errors', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      await expect(service.createSession(mockSessionData)).rejects.toThrow('Invalid JSON');
    });

    it('should handle minimal session data', async () => {
      const minimalData: SessionCreateData = {
        command: ['zsh'],
        workingDir: '~/',
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sessionId: 'minimal-123' }),
      });

      const result = await service.createSession(minimalData);

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/sessions',
        expect.objectContaining({
          body: JSON.stringify(minimalData),
        })
      );
      expect(result.sessionId).toBe('minimal-123');
    });

    it('should serialize all session properties correctly', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sessionId: 'test' }),
      });

      await service.createSession(mockSessionData);

      const calledBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(calledBody).toEqual({
        command: ['npm', 'run', 'dev'],
        workingDir: '/home/user/project',
        name: 'Test Session',
        spawn_terminal: false,
        cols: 120,
        rows: 30,
        titleMode: TitleMode.DYNAMIC,
      });
    });

    it('should re-throw existing Error instances', async () => {
      const customError = new Error('Custom error message');
      fetchMock.mockRejectedValueOnce(customError);

      await expect(service.createSession(mockSessionData)).rejects.toThrow('Custom error message');
    });

    it('should wrap non-Error exceptions', async () => {
      fetchMock.mockRejectedValueOnce('String error');

      await expect(service.createSession(mockSessionData)).rejects.toThrow(
        'Failed to create session'
      );
    });
  });
});
