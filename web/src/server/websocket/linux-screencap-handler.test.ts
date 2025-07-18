import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { linuxScreencapHandler } from './linux-screencap-handler.js';

// Mock dependencies
vi.mock('../capture/desktop-capture-service.js', () => ({
  desktopCaptureService: {
    isReady: vi.fn().mockReturnValue(true),
    getInitializationError: vi.fn().mockReturnValue(undefined),
    startCapture: vi.fn().mockResolvedValue({
      id: 'test-session-id',
      displayServer: { type: 'x11' },
      captureStream: { stream: { on: vi.fn() } },
    }),
    stopCapture: vi.fn().mockResolvedValue(undefined),
    getCapabilities: vi.fn().mockResolvedValue({
      serverCapture: { available: true },
    }),
    getAllSessions: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('./linux-webrtc-handler.js', () => ({
  LinuxWebRTCHandler: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    createOffer: vi.fn().mockResolvedValue({ sdp: 'test-sdp', type: 'offer' }),
    handleAnswer: vi.fn().mockResolvedValue(undefined),
    handleIceCandidate: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    on: vi.fn(),
    emit: vi.fn(),
  })),
}));

describe('LinuxScreencapHandler', () => {
  let mockWs: WebSocket;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock WebSocket
    mockWs = {
      on: vi.fn(),
      send: vi.fn(),
      close: vi.fn(),
      readyState: 1, // OPEN
      OPEN: 1,
    } as unknown as WebSocket;
  });

  describe('handleBrowserConnection', () => {
    it('should send ready event when service is ready', () => {
      linuxScreencapHandler.handleBrowserConnection(mockWs, 'test-user-123');

      // Check ready event was sent
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringMatching(/"action":"ready".*"supportsWebRTC":true/)
      );
    });

    it('should close connection when service is not ready', async () => {
      const { desktopCaptureService } = vi.mocked(
        await import('../capture/desktop-capture-service.js')
      );
      desktopCaptureService.isReady.mockReturnValueOnce(false);
      desktopCaptureService.getInitializationError.mockReturnValueOnce(
        new Error('Service not initialized')
      );

      linuxScreencapHandler.handleBrowserConnection(mockWs, 'test-user-123');

      expect(mockWs.close).toHaveBeenCalledWith(1011, 'Service not initialized');
    });
  });

  describe('message handling', () => {
    let messageHandler: (data: Buffer) => void;

    beforeEach(() => {
      linuxScreencapHandler.handleBrowserConnection(mockWs, 'test-user-123');

      // Get the message handler
      const onCall = vi.mocked(mockWs.on).mock.calls.find((call) => call[0] === 'message');
      messageHandler = onCall?.[1] as (data: Buffer) => void;
    });

    it('should handle ping message', async () => {
      const message = {
        id: 'test-123',
        type: 'request',
        category: 'screencap',
        action: 'ping',
      };

      await messageHandler(Buffer.from(JSON.stringify(message)));

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('"action":"pong"'));
    });

    it('should handle malformed messages', async () => {
      await messageHandler(Buffer.from('invalid json'));

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"error":"Failed to parse message"')
      );
    });
  });

  describe('cleanup', () => {
    it('should clean up resources on disconnect', () => {
      linuxScreencapHandler.handleBrowserConnection(mockWs, 'test-user-123');

      // Get the close handler
      const closeCall = vi.mocked(mockWs.on).mock.calls.find((call) => call[0] === 'close');
      const closeHandler = closeCall?.[1] as () => void;

      // Trigger close
      closeHandler();

      // Verify cleanup (no errors thrown)
      expect(() => closeHandler()).not.toThrow();
    });
  });
});
