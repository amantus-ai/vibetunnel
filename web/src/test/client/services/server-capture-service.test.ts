import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerCaptureService } from '../../../client/services/server-capture-service.js';
import { createLogger } from '../../../client/utils/logger.js';

// Mock dependencies
vi.mock('../../../client/utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Mock global objects
const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockWebSocket = vi.fn();
global.WebSocket = mockWebSocket as any;

const mockMediaSource = vi.fn();
global.MediaSource = mockMediaSource as any;
global.URL = {
  ...global.URL,
  createObjectURL: vi.fn().mockReturnValue('blob:mock-url'),
  revokeObjectURL: vi.fn(),
};

describe('ServerCaptureService', () => {
  let service: ServerCaptureService;
  let mockLogger: any;
  let mockWs: any;
  let mockMediaSourceInstance: any;
  let mockSourceBuffer: any;
  let mockVideoElement: HTMLVideoElement;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLogger = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    vi.mocked(createLogger).mockReturnValue(mockLogger);

    // Mock WebSocket
    mockWs = {
      readyState: WebSocket.CONNECTING,
      send: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    mockWebSocket.mockImplementation(() => mockWs);

    // Mock MediaSource
    mockSourceBuffer = {
      updating: false,
      appendBuffer: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      remove: vi.fn(),
      mode: 'segments',
    };

    mockMediaSourceInstance = {
      readyState: 'closed',
      addSourceBuffer: vi.fn().mockReturnValue(mockSourceBuffer),
      endOfStream: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      sourceBuffers: [],
      activeSourceBuffers: [],
      duration: 0,
    };
    mockMediaSource.mockImplementation(() => mockMediaSourceInstance);
    mockMediaSource.isTypeSupported = vi.fn().mockReturnValue(true);

    // Mock video element
    mockVideoElement = {
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      load: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      src: '',
      srcObject: null,
      paused: true,
      currentTime: 0,
      buffered: {
        length: 0,
        start: vi.fn(),
        end: vi.fn(),
      },
    } as any;

    service = new ServerCaptureService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getCapabilities', () => {
    it('should return capabilities when available', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          serverCapture: {
            available: true,
            displayServer: { type: 'x11' },
            codecs: ['vp8'],
            screens: [],
            requiresAuth: false,
          },
          browserCapture: {
            available: true,
            requiresAuth: false,
          },
        }),
      });

      const capabilities = await service.getCapabilities();

      expect(capabilities).toEqual({
        serverCapture: {
          available: true,
          displayServer: { type: 'x11' },
          codecs: ['vp8'],
          screens: [],
          requiresAuth: false,
        },
        browserCapture: {
          available: true,
          requiresAuth: false,
        },
      });
      expect(mockFetch).toHaveBeenCalledWith('/api/server-screencap/capabilities');
    });

    it('should throw on fetch error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(service.getCapabilities()).rejects.toThrow('Network error');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to get server capabilities:',
        expect.any(Error)
      );
    });

    it('should throw on non-OK response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Service Unavailable',
      });

      await expect(service.getCapabilities()).rejects.toThrow(
        'Failed to get capabilities: Service Unavailable'
      );
    });
  });

  describe('startCapture', () => {
    beforeEach(() => {
      // Mock MediaStream for browser mode
      global.MediaStream = class MediaStream extends EventTarget {
        getTracks() {
          return [];
        }
        getVideoTracks() {
          return [];
        }
        getAudioTracks() {
          return [];
        }
      } as any;

      // Mock navigator.mediaDevices.getDisplayMedia
      global.navigator = {
        mediaDevices: {
          getDisplayMedia: vi.fn().mockResolvedValue(new MediaStream()),
        },
      } as any;

      // Mock getAuthToken method
      service.getAuthToken = vi.fn().mockReturnValue('test-token');

      // Mock supportsWebSocketStreaming
      service.supportsWebSocketStreaming = vi.fn().mockReturnValue(true);
    });

    it('should start server capture successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sessionId: 'session-123',
          mode: 'server',
          streamUrl: '/api/server-screencap/stream/session-123',
        }),
      });

      // Mock createStreamFromServer
      const mockStream = new MediaStream();
      service.createStreamFromServer = vi.fn().mockResolvedValue(mockStream);

      const options: ServerCaptureOptions = {
        mode: 'server',
        quality: 'high',
        framerate: 30,
      };

      const result = await service.startCapture(options);

      expect(result).toBe(mockStream);
      expect(mockFetch).toHaveBeenCalledWith('/api/server-screencap/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'server',
          quality: 'high',
          framerate: 30,
          auth: 'test-token',
        }),
      });
    });

    it('should pass capture options to server', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sessionId: 'session-123',
          mode: 'server',
        }),
      });

      service.createStreamFromServer = vi.fn().mockResolvedValue(new MediaStream());

      const options: ServerCaptureOptions = {
        mode: 'server',
        quality: 'ultra',
        width: 1920,
        height: 1080,
        framerate: 60,
        displayIndex: 0,
      };

      await service.startCapture(options);

      expect(mockFetch).toHaveBeenCalledWith('/api/server-screencap/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...options,
          auth: 'test-token',
        }),
      });
    });

    it('should fall back to browser capture for browser mode', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sessionId: 'session-123',
          mode: 'browser',
        }),
      });

      const mockStream = new MediaStream();
      const mockGetDisplayMedia = vi.fn().mockResolvedValue(mockStream);
      global.navigator.mediaDevices.getDisplayMedia = mockGetDisplayMedia;

      const options: ServerCaptureOptions = {
        mode: 'browser',
        framerate: 30,
        width: 1920,
        height: 1080,
      };

      const result = await service.startCapture(options);

      expect(result).toBe(mockStream);
      expect(mockGetDisplayMedia).toHaveBeenCalledWith({
        video: {
          frameRate: 30,
          width: 1920,
          height: 1080,
        },
        audio: false,
      });
    });

    it('should throw when start request fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Server error' }),
      });

      const options: ServerCaptureOptions = {
        mode: 'server',
      };

      await expect(service.startCapture(options)).rejects.toThrow('Server error');
    });

    it('should throw with default message when no error provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({}),
      });

      const options: ServerCaptureOptions = {
        mode: 'server',
      };

      await expect(service.startCapture(options)).rejects.toThrow('Failed to start capture');
    });
  });

  describe('createWebSocketStream', () => {
    beforeEach(() => {
      service.currentSession = {
        sessionId: 'session-123',
        mode: 'server',
        streamUrl: '/api/server-screencap/stream/session-123',
      };
      service.videoElement = mockVideoElement;

      // Mock captureStream on video element
      const mockStream = new MediaStream();
      mockVideoElement.captureStream = vi.fn().mockReturnValue(mockStream);
    });

    it('should create MediaStream from WebSocket', async () => {
      service.supportsWebSocketStreaming = vi.fn().mockReturnValue(true);
      const streamPromise = service.createStreamFromServer();

      // Simulate WebSocket connection
      mockWs.readyState = WebSocket.OPEN;
      const openHandler = mockWs.addEventListener.mock.calls.find(
        (call: any) => call[0] === 'open'
      )?.[1];
      openHandler?.();

      // Simulate MediaSource open
      mockMediaSourceInstance.readyState = 'open';
      const sourceOpenHandler = mockMediaSourceInstance.addEventListener.mock.calls.find(
        (call: any) => call[0] === 'sourceopen'
      )?.[1];
      sourceOpenHandler?.();

      // Simulate stream start message
      const messageHandler = mockWs.addEventListener.mock.calls.find(
        (call: any) => call[0] === 'message'
      )?.[1];
      messageHandler?.({
        data: JSON.stringify({ type: 'stream-start' }),
      });

      const stream = await streamPromise;

      expect(stream).toBeInstanceOf(MediaStream);
      expect(mockVideoElement.src).toBe('blob:mock-url');
      expect(mockMediaSourceInstance.addSourceBuffer).toHaveBeenCalledWith(
        'video/webm; codecs="vp8"'
      );
    });

    it('should handle video data chunks', () => {
      service.createWebSocketStream();

      // Setup WebSocket and MediaSource
      mockWs.readyState = WebSocket.OPEN;
      const openHandler = mockWs.addEventListener.mock.calls.find(
        (call: any) => call[0] === 'open'
      )?.[1];
      openHandler?.();

      mockMediaSourceInstance.readyState = 'open';
      const sourceOpenHandler = mockMediaSourceInstance.addEventListener.mock.calls.find(
        (call: any) => call[0] === 'sourceopen'
      )?.[1];
      sourceOpenHandler?.();

      // Send video data
      const messageHandler = mockWs.addEventListener.mock.calls.find(
        (call: any) => call[0] === 'message'
      )?.[1];

      const videoData = new ArrayBuffer(100);
      messageHandler?.({ data: videoData });

      expect(mockSourceBuffer.appendBuffer).toHaveBeenCalledWith(videoData);
    });

    it('should handle WebSocket errors', async () => {
      const streamPromise = service.createWebSocketStream();

      const errorHandler = mockWs.addEventListener.mock.calls.find(
        (call: any) => call[0] === 'error'
      )?.[1];
      errorHandler?.(new Event('error'));

      await expect(streamPromise).rejects.toBeDefined();
    });

    it('should handle stream error messages', async () => {
      const streamPromise = service.createWebSocketStream();

      const messageHandler = mockWs.addEventListener.mock.calls.find(
        (call: any) => call[0] === 'message'
      )?.[1];
      messageHandler?.({
        data: JSON.stringify({ type: 'stream-error', error: 'FFmpeg crashed' }),
      });

      await expect(streamPromise).rejects.toThrow('FFmpeg crashed');
    });
  });

  describe('stopCapture', () => {
    it('should stop server capture session', async () => {
      service.currentSession = {
        sessionId: 'session-123',
        mode: 'server',
      };
      service.webSocket = mockWs;
      service.mediaSource = mockMediaSourceInstance;
      service.videoElement = mockVideoElement;

      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      // Mock cleanup
      service.cleanup = vi.fn();

      await service.stopCapture();

      expect(mockFetch).toHaveBeenCalledWith('/api/server-screencap/stop/session-123', {
        method: 'POST',
      });
      expect(service.cleanup).toHaveBeenCalled();
    });

    it('should handle stop errors gracefully', async () => {
      service.currentSession = {
        sessionId: 'session-123',
        mode: 'server',
      };

      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      service.cleanup = vi.fn();

      // Should not throw
      await service.stopCapture();

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to stop capture:', expect.any(Error));
      expect(service.cleanup).toHaveBeenCalled();
    });

    it('should do nothing if no active session', async () => {
      service.currentSession = undefined;

      await service.stopCapture();

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('should cleanup all resources', async () => {
      service.webSocket = mockWs;
      service.mediaSource = mockMediaSourceInstance;
      service.videoElement = mockVideoElement;
      service.currentSession = {
        mode: 'server',
        sessionId: 'session-123',
        streamUrl: '/stream/123',
      };

      const mockStream = {
        getTracks: vi.fn().mockReturnValue([{ stop: vi.fn(), kind: 'video' }]),
      };
      service.mediaStream = mockStream as any;

      await service.cleanup();

      expect(mockWs.close).toHaveBeenCalled();
      expect(mockMediaSourceInstance.endOfStream).toHaveBeenCalled();
      expect(mockStream.getTracks()[0].stop).toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });
  });
});
