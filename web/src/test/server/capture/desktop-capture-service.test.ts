import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { FFmpegCapture } from '../../../server/capture/capture-providers/ffmpeg-capture.js';
import { DesktopCaptureService } from '../../../server/capture/desktop-capture-service.js';
import type { DisplayServer } from '../../../server/capture/display-detection.js';
import { detectDisplayServer } from '../../../server/capture/display-detection.js';
import { StreamHandler } from '../../../server/capture/stream-handler.js';
import { createLogger } from '../../../server/utils/logger.js';

vi.mock('../../../server/capture/capture-providers/ffmpeg-capture.js');
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
  let mockFFmpegCapture: any;
  let mockStreamHandler: any;
  let mockDetectDisplayServer: Mock;
  let mockLogger: any;

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
      isAvailable: vi.fn().mockResolvedValue(true),
      getCapabilities: vi.fn().mockResolvedValue({
        formats: ['webm', 'mp4'],
        codecs: ['vp8', 'h264'],
        hardwareAcceleration: { vaapi: true, nvenc: false, qsv: false },
        maxResolution: { width: 3840, height: 2160 },
        features: { audio: true, cursor: true, region: true },
      }),
      startCapture: vi.fn(),
      stopCapture: vi.fn().mockResolvedValue(undefined),
    };
    (FFmpegCapture as any).mockImplementation(() => mockFFmpegCapture);

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

    it('should return unavailable when FFmpeg is not available', async () => {
      mockFFmpegCapture.isAvailable.mockResolvedValue(false);

      const capabilities = await service.getCapabilities();

      expect(capabilities).toEqual({
        available: false,
        error: 'FFmpeg not available',
      });
    });
  });

  describe('startCaptureSession', () => {
    const mockStream = new Readable({ read() {} });
    const displayServer: DisplayServer = {
      type: 'x11',
      display: ':0',
      captureMethod: 'x11grab',
      availableScreens: [],
    };

    beforeEach(() => {
      mockFFmpegCapture.startCapture.mockResolvedValue({
        stream: mockStream,
        process: { pid: 12345 },
        stop: vi.fn(),
      });
    });

    it('should start a new capture session', async () => {
      const session = await service.startCaptureSession('user123', {
        codec: 'vp8',
        fps: 30,
        resolution: { width: 1920, height: 1080 },
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

      await expect(service.startCaptureSession('user123', {})).rejects.toThrow(
        'No display server available'
      );
    });

    it('should throw when FFmpeg is not available', async () => {
      mockFFmpegCapture.isAvailable.mockResolvedValue(false);

      await expect(service.startCaptureSession('user123', {})).rejects.toThrow(
        'FFmpeg not available'
      );
    });

    it('should handle multiple sessions from same user', async () => {
      const session1 = await service.startCaptureSession('user123', {});
      const session2 = await service.startCaptureSession('user123', {});

      expect(session1.id).not.toBe(session2.id);
      expect(mockFFmpegCapture.startCapture).toHaveBeenCalledTimes(2);
    });

    it('should pipe capture stream to stream handler', async () => {
      await service.startCaptureSession('user123', {});

      // Verify stream data is piped to handler
      const dataCallback = mockStream.on.mock.calls.find((call: any) => call[0] === 'data')?.[1];

      const testData = Buffer.from('test frame data');
      dataCallback?.(testData);

      expect(mockStreamHandler.broadcastFrame).toHaveBeenCalledWith(testData);
    });
  });

  describe('stopCaptureSession', () => {
    it('should stop an active capture session', async () => {
      const mockStream = new Readable({ read() {} });
      const mockCaptureStream = {
        stream: mockStream,
        process: { pid: 12345 },
        stop: vi.fn().mockResolvedValue(undefined),
      };
      mockFFmpegCapture.startCapture.mockResolvedValue(mockCaptureStream);

      const session = await service.startCaptureSession('user123', {});
      await service.stopCaptureSession(session.id);

      expect(mockFFmpegCapture.stopCapture).toHaveBeenCalledWith(mockCaptureStream);
      expect(mockStreamHandler.stop).toHaveBeenCalled();
    });

    it('should throw when session not found', async () => {
      await expect(service.stopCaptureSession('invalid-id')).rejects.toThrow(
        'Capture session not found'
      );
    });

    it('should not throw when stopping already stopped session', async () => {
      const mockCaptureStream = {
        stream: new Readable({ read() {} }),
        process: { pid: 12345 },
        stop: vi.fn().mockResolvedValue(undefined),
      };
      mockFFmpegCapture.startCapture.mockResolvedValue(mockCaptureStream);

      const session = await service.startCaptureSession('user123', {});
      await service.stopCaptureSession(session.id);

      // Second stop should not throw
      await service.stopCaptureSession(session.id);

      expect(mockFFmpegCapture.stopCapture).toHaveBeenCalledTimes(1);
    });
  });

  describe('getSession', () => {
    it('should return active session', async () => {
      const mockCaptureStream = {
        stream: new Readable({ read() {} }),
        process: { pid: 12345 },
        stop: vi.fn(),
      };
      mockFFmpegCapture.startCapture.mockResolvedValue(mockCaptureStream);

      const session = await service.startCaptureSession('user123', {});
      const retrieved = service.getSession(session.id);

      expect(retrieved).toEqual(session);
    });

    it('should return undefined for non-existent session', () => {
      const session = service.getSession('invalid-id');
      expect(session).toBeUndefined();
    });
  });

  describe('getUserSessions', () => {
    it('should return all sessions for a user', async () => {
      const mockCaptureStream = {
        stream: new Readable({ read() {} }),
        process: { pid: 12345 },
        stop: vi.fn(),
      };
      mockFFmpegCapture.startCapture.mockResolvedValue(mockCaptureStream);

      const session1 = await service.startCaptureSession('user123', {});
      const session2 = await service.startCaptureSession('user123', {});
      await service.startCaptureSession('user456', {}); // Different user

      const userSessions = service.getUserSessions('user123');

      expect(userSessions).toHaveLength(2);
      expect(userSessions).toContainEqual(session1);
      expect(userSessions).toContainEqual(session2);
    });

    it('should return empty array for user with no sessions', () => {
      const sessions = service.getUserSessions('user123');
      expect(sessions).toEqual([]);
    });
  });

  describe('getStreamHandler', () => {
    it('should return stream handler for active session', async () => {
      const mockCaptureStream = {
        stream: new Readable({ read() {} }),
        process: { pid: 12345 },
        stop: vi.fn(),
      };
      mockFFmpegCapture.startCapture.mockResolvedValue(mockCaptureStream);

      const session = await service.startCaptureSession('user123', {});
      const handler = service.getStreamHandler(session.id);

      expect(handler).toBe(mockStreamHandler);
    });

    it('should return undefined for non-existent session', () => {
      const handler = service.getStreamHandler('invalid-id');
      expect(handler).toBeUndefined();
    });
  });

  describe('cleanup', () => {
    it('should stop all active sessions on cleanup', async () => {
      const mockCaptureStream = {
        stream: new Readable({ read() {} }),
        process: { pid: 12345 },
        stop: vi.fn().mockResolvedValue(undefined),
      };
      mockFFmpegCapture.startCapture.mockResolvedValue(mockCaptureStream);

      await service.startCaptureSession('user123', {});
      await service.startCaptureSession('user456', {});

      await service.cleanup();

      expect(mockFFmpegCapture.stopCapture).toHaveBeenCalledTimes(2);
      expect(mockStreamHandler.stop).toHaveBeenCalledTimes(2);
    });

    it('should handle errors during cleanup gracefully', async () => {
      const mockCaptureStream = {
        stream: new Readable({ read() {} }),
        process: { pid: 12345 },
        stop: vi.fn().mockRejectedValue(new Error('Stop failed')),
      };
      mockFFmpegCapture.startCapture.mockResolvedValue(mockCaptureStream);
      mockFFmpegCapture.stopCapture.mockRejectedValue(new Error('Stop failed'));

      await service.startCaptureSession('user123', {});

      // Should not throw
      await service.cleanup();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to stop capture'),
        expect.any(Error)
      );
    });
  });
});
