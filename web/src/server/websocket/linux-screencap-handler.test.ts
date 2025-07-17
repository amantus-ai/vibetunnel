import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { linuxScreencapHandler } from './linux-screencap-handler.js';

// Mock dependencies
vi.mock('../capture/desktop-capture-service.js', () => ({
  desktopCaptureService: {
    startCapture: vi.fn(),
    stopCapture: vi.fn().mockResolvedValue(undefined),
    getCapabilities: vi.fn(),
    getAllSessions: vi.fn(),
  },
}));

vi.mock('../capture/stream-handler.js', () => ({
  streamHandler: {
    streamToSession: vi.fn(),
    subscribe: vi.fn(),
  },
}));

vi.mock('./linux-webrtc-handler.js', () => ({
  LinuxWebRTCHandler: vi.fn().mockImplementation(() => {
    const emitter = new EventEmitter();
    return {
      initialize: vi.fn().mockResolvedValue(undefined),
      createOffer: vi.fn().mockResolvedValue(undefined),
      handleAnswer: vi.fn().mockResolvedValue(undefined),
      handleIceCandidate: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      on: emitter.on.bind(emitter),
      emit: emitter.emit.bind(emitter),
    };
  }),
}));

import { desktopCaptureService } from '../capture/desktop-capture-service.js';
import { streamHandler } from '../capture/stream-handler.js';
import { LinuxWebRTCHandler } from './linux-webrtc-handler.js';

describe('LinuxScreencapHandler', () => {
  let mockWs: WebSocket;
  let mockDesktopCaptureService: typeof desktopCaptureService;
  let _mockStreamHandler: typeof streamHandler;

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

    mockDesktopCaptureService = desktopCaptureService;
    _mockStreamHandler = streamHandler;
  });

  describe('handleBrowserConnection', () => {
    it('should set up WebSocket connection and send ready event', () => {
      linuxScreencapHandler.handleBrowserConnection(mockWs, 'test-user-123');

      // Check WebSocket event handlers were set up
      expect(mockWs.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockWs.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockWs.on).toHaveBeenCalledWith('error', expect.any(Function));

      // Check ready event was sent
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('"action":"ready"'));
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('"supportsWebRTC":true'));
    });
  });

  describe('message handling', () => {
    let messageHandler: (data: Buffer) => void;

    beforeEach(() => {
      linuxScreencapHandler.handleBrowserConnection(mockWs, 'test-user-123');

      // Get the message handler
      const onMock = vi.mocked(mockWs.on);
      const onCall = onMock.mock.calls.find((call) => call[0] === 'message');
      messageHandler = onCall?.[1] as (data: Buffer) => void;
    });

    it('should handle get-initial-data request', async () => {
      mockDesktopCaptureService.getCapabilities.mockResolvedValue({
        serverCapture: { available: true },
        browserCapture: { available: true },
      });
      mockDesktopCaptureService.getAllSessions.mockResolvedValue([]);

      const message = {
        id: 'test-123',
        type: 'request',
        category: 'screencap',
        action: 'get-initial-data',
      };

      await messageHandler(Buffer.from(JSON.stringify(message)));

      expect(mockDesktopCaptureService.getCapabilities).toHaveBeenCalled();
      expect(mockDesktopCaptureService.getAllSessions).toHaveBeenCalled();
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('"action":"initial-data"'));
    });

    it('should handle start-capture request', async () => {
      const mockSession = {
        id: 'session-123',
        mode: 'server',
        displayServer: { type: 'x11' },
      };
      mockDesktopCaptureService.startCapture.mockResolvedValue(mockSession);

      const message = {
        id: 'test-456',
        type: 'request',
        category: 'screencap',
        action: 'start-capture',
        payload: {
          mode: 'desktop',
          displayIndex: 0,
          sessionId: 'client-session-789',
        },
        userId: 'test-user-123',
      };

      await messageHandler(Buffer.from(JSON.stringify(message)));

      expect(mockDesktopCaptureService.startCapture).toHaveBeenCalledWith({
        mode: 'server',
        displayIndex: 0,
        quality: 'high',
        auth: 'test-user-123',
      });

      expect(LinuxWebRTCHandler).toHaveBeenCalledWith(mockSession, 'client-session-789');

      // Check success response
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"action":"capture-started"')
      );

      // Check state change event
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('"action":"state-change"'));
    });

    it('should handle stop-capture request', async () => {
      // First start a capture session
      const mockSession = {
        id: 'session-123',
        mode: 'server',
      };
      mockDesktopCaptureService.startCapture.mockResolvedValue(mockSession);

      await messageHandler(
        Buffer.from(
          JSON.stringify({
            id: 'start-1',
            type: 'request',
            category: 'screencap',
            action: 'start-capture',
            payload: {},
          })
        )
      );

      vi.clearAllMocks();

      // Now stop it
      const stopMessage = {
        id: 'stop-1',
        type: 'request',
        category: 'screencap',
        action: 'stop-capture',
      };

      await messageHandler(Buffer.from(JSON.stringify(stopMessage)));

      expect(mockDesktopCaptureService.stopCapture).toHaveBeenCalledWith('session-123');
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"action":"capture-stopped"')
      );
    });

    it('should handle WebRTC signaling messages', async () => {
      // First start a capture to create WebRTC handler
      const mockSession = { id: 'session-123', mode: 'server' };
      mockDesktopCaptureService.startCapture.mockResolvedValue(mockSession);

      await messageHandler(
        Buffer.from(
          JSON.stringify({
            id: 'start-1',
            type: 'request',
            category: 'screencap',
            action: 'start-capture',
            payload: {},
          })
        )
      );

      // Send answer
      const answerMessage = {
        id: 'answer-1',
        type: 'event',
        category: 'screencap',
        action: 'answer',
        payload: Buffer.from(
          JSON.stringify({
            data: { type: 'answer', sdp: 'test-sdp' },
          })
        ).toString('base64'),
      };

      await messageHandler(Buffer.from(JSON.stringify(answerMessage)));

      // Verify WebRTC handler was called
      const mockHandler = vi.mocked(LinuxWebRTCHandler);
      const webrtcHandler = mockHandler.mock.results[0]?.value;
      expect(webrtcHandler.handleAnswer).toHaveBeenCalledWith({
        type: 'answer',
        sdp: 'test-sdp',
      });
    });

    it('should handle ping message', async () => {
      const pingMessage = {
        id: 'ping-123',
        type: 'request',
        category: 'screencap',
        action: 'ping',
      };

      await messageHandler(Buffer.from(JSON.stringify(pingMessage)));

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('"action":"pong"'));
    });
  });

  describe('edge cases', () => {
    it('should handle missing payload gracefully', async () => {
      linuxScreencapHandler.handleBrowserConnection(mockWs, 'test-user-123');

      const onMock = vi.mocked(mockWs.on);
      const messageCall = onMock.mock.calls.find((call) => call[0] === 'message');
      const messageHandler = messageCall?.[1] as (data: Buffer) => void;

      // Send message without payload
      const message = {
        id: 'test-no-payload',
        type: 'request',
        category: 'screencap',
        action: 'start-capture',
        payload: {}, // Empty payload instead of missing
      };

      mockDesktopCaptureService.startCapture.mockResolvedValue({
        id: 'session-default',
        mode: 'server',
      });

      await messageHandler(Buffer.from(JSON.stringify(message)));

      // Should use defaults (auth comes from userId)
      expect(mockDesktopCaptureService.startCapture).toHaveBeenCalledWith({
        mode: 'server',
        displayIndex: 0,
        quality: 'high',
        auth: 'test-user-123', // userId is set during connection
      });
    });

    it('should handle malformed messages', async () => {
      linuxScreencapHandler.handleBrowserConnection(mockWs, 'test-user-123');

      const onMock = vi.mocked(mockWs.on);
      const messageCall = onMock.mock.calls.find((call) => call[0] === 'message');
      const messageHandler = messageCall?.[1] as (data: Buffer) => void;

      // Send malformed JSON
      await messageHandler(Buffer.from('invalid json'));

      // Should send error response
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"error":"Failed to parse message"')
      );
    });

    it('should handle multiple concurrent sessions', async () => {
      // Create two clients
      const mockWs2 = {
        on: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
        readyState: 1,
        OPEN: 1,
      } as unknown as WebSocket;

      linuxScreencapHandler.handleBrowserConnection(mockWs, 'user1');
      linuxScreencapHandler.handleBrowserConnection(mockWs2, 'user2');

      const onMock1 = vi.mocked(mockWs.on);
      const messageCall1 = onMock1.mock.calls.find((call) => call[0] === 'message');
      const messageHandler1 = messageCall1?.[1] as (data: Buffer) => void;

      const onMock2 = vi.mocked(mockWs2.on);
      const messageCall2 = onMock2.mock.calls.find((call) => call[0] === 'message');
      const messageHandler2 = messageCall2?.[1] as (data: Buffer) => void;

      // Start captures for both
      mockDesktopCaptureService.startCapture
        .mockResolvedValueOnce({ id: 'session-1', mode: 'server' })
        .mockResolvedValueOnce({ id: 'session-2', mode: 'server' });

      await messageHandler1(
        Buffer.from(
          JSON.stringify({
            id: 'start-1',
            type: 'request',
            category: 'screencap',
            action: 'start-capture',
            payload: {},
          })
        )
      );

      await messageHandler2(
        Buffer.from(
          JSON.stringify({
            id: 'start-2',
            type: 'request',
            category: 'screencap',
            action: 'start-capture',
            payload: {},
          })
        )
      );

      // Both should have separate sessions
      expect(mockDesktopCaptureService.startCapture).toHaveBeenCalledTimes(2);
      expect(LinuxWebRTCHandler).toHaveBeenCalledTimes(2);
    });
  });

  describe('cleanup', () => {
    it('should clean up resources on disconnect', async () => {
      linuxScreencapHandler.handleBrowserConnection(mockWs, 'test-user-123');

      // Get handlers
      const onMock = vi.mocked(mockWs.on);
      const messageCall = onMock.mock.calls.find((call) => call[0] === 'message');
      const messageHandler = messageCall?.[1] as (data: Buffer) => void;
      const closeCall = vi.mocked(mockWs.on).mock.calls.find((call) => call[0] === 'close');
      const closeHandler = closeCall?.[1] as () => void;

      // Start a capture session
      const mockSession = { id: 'session-123', mode: 'server' };
      mockDesktopCaptureService.startCapture.mockResolvedValue(mockSession);

      await messageHandler(
        Buffer.from(
          JSON.stringify({
            id: 'start-1',
            type: 'request',
            category: 'screencap',
            action: 'start-capture',
            payload: {},
          })
        )
      );

      // Trigger close
      closeHandler();

      // Verify cleanup
      expect(mockDesktopCaptureService.stopCapture).toHaveBeenCalledWith('session-123');
      const mockHandler = vi.mocked(LinuxWebRTCHandler);
      const webrtcHandler = mockHandler.mock.results[0]?.value;
      expect(webrtcHandler.close).toHaveBeenCalled();
    });
  });
});
