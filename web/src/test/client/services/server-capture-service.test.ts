import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerCaptureService } from '../../../client/services/server-capture-service.js';

// Mock fetch globally
global.fetch = vi.fn();

// Mock WebSocket
global.WebSocket = vi.fn().mockImplementation(() => ({
  readyState: WebSocket.CONNECTING,
  close: vi.fn(),
  send: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})) as any;

// Mock MediaStream
class MockMediaStream {
  active = true;
  id = 'mock-stream-id';
  getTracks() {
    return [];
  }
}
global.MediaStream = MockMediaStream as any;

describe('ServerCaptureService', () => {
  let service: ServerCaptureService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ServerCaptureService();
  });

  describe('getCapabilities', () => {
    it('should fetch capabilities successfully', async () => {
      const mockCapabilities = {
        serverCapture: {
          available: true,
          codecs: ['vp8', 'h264'],
        },
      };

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockCapabilities,
      } as Response);

      const result = await service.getCapabilities();
      expect(result).toEqual(mockCapabilities);
    });

    it('should throw on fetch error', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
      } as Response);

      await expect(service.getCapabilities()).rejects.toThrow(
        'Failed to get capabilities: Internal Server Error'
      );
    });
  });

  describe('startCapture', () => {
    it('should start server capture successfully', async () => {
      const mockSession = {
        sessionId: 'test-session-123',
        websocketUrl: 'wss://example.com/ws',
      };

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSession,
      } as Response);

      const result = await service.startCapture('server', {});

      expect(result).toBeDefined();
      expect(result.stream).toBeInstanceOf(MockMediaStream);
    });

    it('should fall back to browser capture for browser mode', async () => {
      const result = await service.startCapture('browser', {});

      expect(result).toBeDefined();
      expect(result.stream).toBeInstanceOf(MockMediaStream);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('stopCapture', () => {
    it('should stop capture successfully', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
      } as Response);

      await expect(service.stopCapture('test-session-123')).resolves.not.toThrow();
    });

    it('should handle stop errors gracefully', async () => {
      vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Network error'));

      // Should not throw, just log error
      await expect(service.stopCapture('test-session-123')).resolves.not.toThrow();
    });
  });

  describe('cleanup', () => {
    it('should cleanup all resources', () => {
      service.cleanup();
      // Should not throw
      expect(() => service.cleanup()).not.toThrow();
    });
  });
});
