import express, { type Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { desktopCaptureService } from '../../../server/capture/desktop-capture-service.js';
import { createServerScreencapRoutes } from '../../../server/routes/server-screencap.js';
import { createLogger } from '../../../server/utils/logger.js';

vi.mock('../../../server/capture/desktop-capture-service.js');
vi.mock('../../../server/utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('Server Screencap Routes', () => {
  let app: Express;
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

    // Mock desktopCaptureService
    vi.mocked(desktopCaptureService).getCapabilities = vi.fn().mockResolvedValue({
      available: true,
      displayServer: {
        type: 'x11',
        display: ':0',
        captureMethod: 'x11grab',
      },
      captureProvider: {
        formats: ['webm'],
        codecs: ['vp8'],
      },
    });

    vi.mocked(desktopCaptureService).startCapture = vi.fn().mockResolvedValue({
      id: 'session-123',
      userId: 'user-123',
      startTime: new Date(),
      status: 'active',
      mode: 'server',
      displayServer: undefined,
      options: {},
    });

    vi.mocked(desktopCaptureService).stopCapture = vi.fn().mockResolvedValue(undefined);
    vi.mocked(desktopCaptureService).getSession = vi.fn();

    // Create Express app with authentication middleware
    app = express();
    app.use(express.json());

    // Mock authentication middleware
    app.use((req, res, next) => {
      req.session = { userId: 'user-123' } as any;
      next();
    });

    const router = createServerScreencapRoutes();
    app.use('/api/server-screencap', router);
  });

  describe('GET /capabilities', () => {
    it('should return capabilities when available', async () => {
      const response = await request(app).get('/api/server-screencap/capabilities');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        available: true,
        displayServer: {
          type: 'x11',
          display: ':0',
          captureMethod: 'x11grab',
        },
        captureProvider: {
          formats: ['webm'],
          codecs: ['vp8'],
        },
      });
    });

    it('should return 401 when not authenticated', async () => {
      // Override auth middleware
      app = express();
      app.use(express.json());
      const router = createServerScreencapRouter();
      app.use('/api/server-screencap', router);

      const response = await request(app).get('/api/server-screencap/capabilities');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: 'Authentication required',
      });
    });

    it('should handle service errors', async () => {
      mockDesktopCaptureService.getCapabilities.mockRejectedValueOnce(new Error('Service error'));

      const response = await request(app).get('/api/server-screencap/capabilities');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: 'Failed to get capabilities',
      });
    });
  });

  describe('POST /start', () => {
    it('should start capture session with default options', async () => {
      const response = await request(app).post('/api/server-screencap/start').send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        sessionId: 'session-123',
        mode: 'server',
        displayServer: undefined,
        streamUrl: '/api/server-screencap/stream/session-123',
      });
      expect(vi.mocked(desktopCaptureService).startCapture).toHaveBeenCalledWith({
        mode: 'server',
      });
    });

    it('should start capture session with custom options', async () => {
      const response = await request(app).post('/api/server-screencap/start').send({
        mode: 'server',
        quality: 'high',
        width: 1920,
        height: 1080,
        framerate: 60,
        auth: 'test-token',
      });

      expect(response.status).toBe(200);
      expect(vi.mocked(desktopCaptureService).startCapture).toHaveBeenCalledWith({
        mode: 'server',
        quality: 'high',
        width: 1920,
        height: 1080,
        framerate: 60,
        auth: 'test-token',
      });
    });

    it('should return 401 when server mode without auth', async () => {
      const response = await request(app)
        .post('/api/server-screencap/start')
        .send({ mode: 'server' });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: 'Authentication required for server capture',
      });
    });

    it('should handle start session errors', async () => {
      vi.mocked(desktopCaptureService).startCapture.mockRejectedValueOnce(
        new Error('FFmpeg not found')
      );

      const response = await request(app)
        .post('/api/server-screencap/start')
        .send({ mode: 'server', auth: 'test-token' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: 'FFmpeg not found',
      });
    });
  });

  describe('POST /stop/:sessionId', () => {
    it('should stop capture session', async () => {
      const response = await request(app).post('/api/server-screencap/stop/session-123');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect(vi.mocked(desktopCaptureService).stopCapture).toHaveBeenCalledWith('session-123');
    });

    it('should handle stop errors', async () => {
      vi.mocked(desktopCaptureService).stopCapture.mockRejectedValueOnce(new Error('Stop failed'));

      const response = await request(app).post('/api/server-screencap/stop/session-123');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: 'Stop failed',
      });
    });
  });

  describe('GET /session/:sessionId', () => {
    it('should return session info', async () => {
      vi.mocked(desktopCaptureService).getSession.mockResolvedValue({
        id: 'session-123',
        userId: 'user-123',
        mode: 'server',
        status: 'active',
        stats: {},
        displayServer: { type: 'x11' },
      } as any);

      const response = await request(app).get('/api/server-screencap/session/session-123');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: 'session-123',
        mode: 'server',
        stats: {},
        displayServer: { type: 'x11' },
      });
    });

    it('should return 404 for non-existent session', async () => {
      vi.mocked(desktopCaptureService).getSession.mockResolvedValue(undefined);

      const response = await request(app).get('/api/server-screencap/session/invalid-session');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: 'Session not found',
      });
    });
  });
});
