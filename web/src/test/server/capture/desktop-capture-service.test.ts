import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { FFmpegCapture } from '../../../server/capture/capture-providers/ffmpeg-capture.js';
import { DesktopCaptureService } from '../../../server/capture/desktop-capture-service.js';
import type { DisplayServer } from '../../../server/capture/display-detection.js';
import { detectDisplayServer } from '../../../server/capture/display-detection.js';
import { StreamHandler } from '../../../server/capture/stream-handler.js';
import { createLogger } from '../../../server/utils/logger.js';

vi.mock('../../../server/capture/capture-providers/ffmpeg-capture.js', () => ({
  FFmpegCapture: vi.fn(),
}));
vi.mock('../../../server/capture/display-detection.js');
vi.mock('../../../server/capture/stream-handler.js');
vi.mock('../../../server/utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('DesktopCaptureService', () => {
  let service: DesktopCaptureService;
  let mockFFmpegCapture: vi.Mocked<FFmpegCapture>;
  let mockStreamHandler: vi.Mocked<StreamHandler>;
  let mockDetectDisplayServer: Mock;
  let mockLogger: ReturnType<typeof createLogger>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLogger = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    vi.mocked(createLogger).mockReturnValue(mockLogger);

    mockFFmpegCapture = {
      checkFFmpegAvailable: vi.fn().mockResolvedValue(true),
      getFFmpegCodecs: vi.fn().mockResolvedValue(['vp8', 'vp9', 'h264']),
      startCapture: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
      // EventEmitter methods
      on: vi.fn().mockReturnThis(),
      once: vi.fn().mockReturnThis(),
      emit: vi.fn().mockReturnThis(),
      removeListener: vi.fn().mockReturnThis(),
      removeAllListeners: vi.fn().mockReturnThis(),
      setMaxListeners: vi.fn().mockReturnThis(),
      getMaxListeners: vi.fn().mockReturnValue(10),
      listeners: vi.fn().mockReturnValue([]),
      listenerCount: vi.fn().mockReturnValue(0),
      prependListener: vi.fn().mockReturnThis(),
      prependOnceListener: vi.fn().mockReturnThis(),
      eventNames: vi.fn().mockReturnValue([]),
      addListener: vi.fn().mockReturnThis(),
      off: vi.fn().mockReturnThis(),
      rawListeners: vi.fn().mockReturnValue([]),
    };

    mockStreamHandler = {
      addClient: vi.fn(),
      removeClient: vi.fn(),
      getClientCount: vi.fn().mockReturnValue(0),
      broadcastFrame: vi.fn(),
      stop: vi.fn(),
    };
    (StreamHandler as any).mockImplementation(() => mockStreamHandler);

    mockDetectDisplayServer = detectDisplayServer as Mock;
    mockDetectDisplayServer.mockResolvedValue({
      type: 'x11',
      display: ':0',
      captureMethod: 'x11grab',
      availableScreens: [],
    });

    // Set up mock before creating service
    vi.mocked(FFmpegCapture).mockImplementation(() => mockFFmpegCapture);
    service = new DesktopCaptureService();
  });

  describe('getCapabilities', () => {
    it('should return capabilities when capture is available', async () => {
      const capabilities = await service.getCapabilities();

      expect(capabilities).toEqual({
        available: true,
        displayServer: {
          type: 'x11',
          display: ':0',
          captureMethod: 'x11grab',
          availableScreens: [],
        },
        captureProvider: {
          formats: ['webm', 'mp4'],
          codecs: ['vp8', 'h264'],
          hardwareAcceleration: { vaapi: true, nvenc: false, qsv: false },
          maxResolution: { width: 3840, height: 2160 },
          features: { audio: true, cursor: true, region: true },
        },
      });
    });

    it('should return unavailable when no display server detected', async () => {
      mockDetectDisplayServer.mockResolvedValue(null);

      const capabilities = await service.getCapabilities();

      expect(capabilities).toEqual({
        available: false,
        error: 'No display server detected',
      });
    });

    it('should throw error when FFmpeg is not available during initialization', async () => {
      // Create a new service instance with FFmpeg unavailable
      const localMockFFmpegCapture = {
        ...mockFFmpegCapture,
        checkFFmpegAvailable: vi.fn().mockResolvedValue(false),
      };
      vi.mocked(FFmpegCapture).mockImplementation(() => localMockFFmpegCapture);
      const localService = new DesktopCaptureService();

      await expect(localService.getCapabilities()).rejects.toThrow(
        'FFmpeg is not available! Please install FFmpeg: sudo apt-get install ffmpeg'
      );
    });
  });

  describe('startCapture', () => {
    let mockStream: Readable & { on?: any; once?: any };
    const displayServer: DisplayServer = {
      type: 'x11',
      display: ':0',
      captureMethod: 'x11grab',
      availableScreens: [],
    };

    beforeEach(() => {
      mockStream = new Readable({ read() {} });
      mockStream.on = vi.fn().mockReturnThis();
      mockStream.once = vi.fn().mockReturnThis();

      mockFFmpegCapture.startCapture.mockResolvedValue({
        stream: mockStream,
        getStats: vi.fn().mockReturnValue({}),
        stop: vi.fn(),
      });
    });

    it('should start a new capture session', async () => {
      const session = await service.startCapture({
        codec: 'vp8',
        framerate: 30,
        width: 1920,
        height: 1080,
      });

      expect(session).toEqual({
        id: expect.any(String),
        userId: 'user123',
        startTime: expect.any(Date),
        status: 'active',
        options: {
          codec: 'vp8',
          fps: 30,
          resolution: { width: 1920, height: 1080 },
        },
      });
      expect(mockFFmpegCapture.startCapture).toHaveBeenCalledWith(
        displayServer,
        expect.any(Object)
      );
    });

    it('should throw when no display server is available', async () => {
      mockDetectDisplayServer.mockResolvedValue(null);

      await expect(service.startCapture({})).rejects.toThrow(
        'Server capture not available - no display server detected'
      );
    });

    it('should throw when FFmpeg is not available', async () => {
      // Create a new service instance with FFmpeg unavailable
      const localMockFFmpegCapture = {
        ...mockFFmpegCapture,
        checkFFmpegAvailable: vi.fn().mockResolvedValue(false),
      };
      vi.mocked(FFmpegCapture).mockImplementation(() => localMockFFmpegCapture);
      const localService = new DesktopCaptureService();

      await expect(localService.startCapture({})).rejects.toThrow(
        'FFmpeg is not available! Please install FFmpeg: sudo apt-get install ffmpeg'
      );
    });

    it('should handle multiple sessions from same user', async () => {
      const session1 = await service.startCapture({});
      const session2 = await service.startCapture({});

      expect(session1.id).not.toBe(session2.id);
      expect(mockFFmpegCapture.startCapture).toHaveBeenCalledTimes(2);
    });

    it('should pipe capture stream to stream handler', async () => {
      await service.startCapture({});

      // Verify stream data is piped to handler
      const dataCallback = mockStream.on.mock.calls.find((call: any) => call[0] === 'data')?.[1];

      const testData = Buffer.from('test frame data');
      dataCallback?.(testData);

      expect(mockStreamHandler.broadcastFrame).toHaveBeenCalledWith(testData);
    });
  });

  describe('stopCapture', () => {
    it('should stop an active capture session', async () => {
      const mockStream = new Readable({ read() {} });
      mockStream.on = vi.fn().mockReturnThis();
      mockStream.once = vi.fn().mockReturnThis();
      const mockCaptureStream = {
        stream: mockStream,
        getStats: vi.fn().mockReturnValue({}),
        stop: vi.fn().mockResolvedValue(undefined),
      };
      mockFFmpegCapture.startCapture.mockResolvedValue(mockCaptureStream);

      const session = await service.startCapture({});
      await service.stopCapture(session.id);

      expect(mockFFmpegCapture.stopCapture).toHaveBeenCalledWith(mockCaptureStream);
      expect(mockStreamHandler.stop).toHaveBeenCalled();
    });

    it('should throw when session not found', async () => {
      await expect(service.stopCapture('invalid-id')).rejects.toThrow(
        'Session invalid-id not found'
      );
    });

    it('should not throw when stopping already stopped session', async () => {
      const mockStream = new Readable({ read() {} });
      mockStream.on = vi.fn().mockReturnThis();
      mockStream.once = vi.fn().mockReturnThis();
      const mockCaptureStream = {
        stream: mockStream,
        getStats: vi.fn().mockReturnValue({}),
        stop: vi.fn().mockResolvedValue(undefined),
      };
      mockFFmpegCapture.startCapture.mockResolvedValue(mockCaptureStream);

      const session = await service.startCapture({});
      await service.stopCapture(session.id);

      // Second stop should not throw
      await service.stopCapture(session.id);

      expect(mockFFmpegCapture.stopCapture).toHaveBeenCalledTimes(1);
    });
  });

  describe('getAllSessions', () => {
    it('should return all sessions for a user', async () => {
      const mockStream = new Readable({ read() {} });
      mockStream.on = vi.fn().mockReturnThis();
      mockStream.once = vi.fn().mockReturnThis();
      const mockCaptureStream = {
        stream: mockStream,
        getStats: vi.fn().mockReturnValue({}),
        stop: vi.fn(),
      };
      mockFFmpegCapture.startCapture.mockResolvedValue(mockCaptureStream);

      const session1 = await service.startCapture({});
      const session2 = await service.startCapture({});
      await service.startCapture({}); // Different user

      const userSessions = service.getAllSessions('user123');

      expect(userSessions).toHaveLength(2);
      expect(userSessions).toContainEqual(session1);
      expect(userSessions).toContainEqual(session2);
    });

    it('should return empty array for user with no sessions', async () => {
      const sessions = await service.getAllSessions();
      expect(sessions).toEqual([]);
    });
  });

  describe('getSession', () => {
    it('should return session for active session', async () => {
      const mockStream = new Readable({ read() {} });
      mockStream.on = vi.fn().mockReturnThis();
      mockStream.once = vi.fn().mockReturnThis();
      const mockCaptureStream = {
        stream: mockStream,
        getStats: vi.fn().mockReturnValue({}),
        stop: vi.fn(),
      };
      mockFFmpegCapture.startCapture.mockResolvedValue(mockCaptureStream);

      const session = await service.startCapture({});
      const sessionResult = await service.getSession(session.id);

      expect(sessionResult).toBeDefined();
      expect(sessionResult?.id).toBe(session.id);
    });

    it('should return undefined for non-existent session', async () => {
      const result = await service.getSession('invalid-id');
      expect(result).toBeUndefined();
    });
  });

  describe('shutdown', () => {
    it('should stop all active sessions on cleanup', async () => {
      const mockCaptureStream = {
        stream: new Readable({ read() {} }),
        getStats: vi.fn().mockReturnValue({}),
        stop: vi.fn().mockResolvedValue(undefined),
      };
      mockFFmpegCapture.startCapture.mockResolvedValue(mockCaptureStream);

      await service.startCapture({});
      await service.startCapture({});

      await service.shutdown();

      expect(mockCaptureStream.stop).toHaveBeenCalledTimes(2);
    });

    it('should handle errors during cleanup gracefully', async () => {
      const mockCaptureStream = {
        stream: new Readable({ read() {} }),
        getStats: vi.fn().mockReturnValue({}),
        stop: vi.fn().mockRejectedValue(new Error('Stop failed')),
      };
      mockFFmpegCapture.startCapture.mockResolvedValue(mockCaptureStream);
      // The error is already handled by mockCaptureStream.stop rejecting

      await service.startCapture({});

      // Should not throw
      await service.shutdown();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error stopping session'),
        expect.any(Error)
      );
    });
  });
});
