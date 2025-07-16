import { type Request, type Response, Router } from 'express';
import { desktopCaptureService } from '../capture/desktop-capture-service.js';
import { streamHandler } from '../capture/stream-handler.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('server-screencap-routes');

export function createServerScreencapRoutes(): Router {
  const router = Router();

  // Get server capture capabilities
  router.get('/capabilities', async (_req: Request, res: Response) => {
    try {
      const capabilities = await desktopCaptureService.getCapabilities();
      res.json(capabilities);
    } catch (error) {
      logger.error('Failed to get capabilities:', error);
      res.status(500).json({ error: 'Failed to get capture capabilities' });
    }
  });

  // Start server capture session
  router.post('/start', async (req: Request, res: Response) => {
    try {
      const { mode, displayIndex, quality, auth, width, height, framerate } = req.body;

      // Validate request
      if (mode === 'server' && !auth) {
        return res.status(401).json({ error: 'Authentication required for server capture' });
      }

      const session = await desktopCaptureService.startCapture({
        mode: mode || 'server',
        displayIndex,
        quality,
        auth,
        width,
        height,
        framerate,
      });

      res.json({
        sessionId: session.id,
        mode: session.mode,
        displayServer: session.displayServer,
        streamUrl: `/api/server-screencap/stream/${session.id}`,
      });
    } catch (error) {
      logger.error('Failed to start capture:', error);
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : 'Failed to start capture' });
    }
  });

  // Stop capture session
  router.post('/stop/:sessionId', async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;

      await desktopCaptureService.stopCapture(sessionId);

      res.json({ success: true });
    } catch (error) {
      logger.error('Failed to stop capture:', error);
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : 'Failed to stop capture' });
    }
  });

  // Get session info
  router.get('/session/:sessionId', async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const session = await desktopCaptureService.getSession(sessionId);

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      res.json({
        id: session.id,
        mode: session.mode,
        stats: session.stats,
        displayServer: session.displayServer,
      });
    } catch (error) {
      logger.error('Failed to get session:', error);
      res.status(500).json({ error: 'Failed to get session info' });
    }
  });

  // HTTP streaming endpoint for video
  router.get('/stream/:sessionId', async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const session = await desktopCaptureService.getSession(sessionId);

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      if (!session.captureStream) {
        return res.status(400).json({ error: 'No capture stream available' });
      }

      // Set appropriate headers for streaming
      res.setHeader('Content-Type', 'video/webm');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Transfer-Encoding', 'chunked');

      // Stream the video data
      session.captureStream.stream.pipe(res);

      // Handle client disconnect
      req.on('close', () => {
        logger.log(`Client disconnected from stream ${sessionId}`);
        // The stream will be cleaned up when the capture stops
      });
    } catch (error) {
      logger.error('Streaming error:', error);
      res.status(500).json({ error: 'Streaming failed' });
    }
  });

  // Get active sessions
  router.get('/sessions', async (_req: Request, res: Response) => {
    try {
      const sessions = await desktopCaptureService.getAllSessions();
      res.json(
        sessions.map((s) => ({
          id: s.id,
          mode: s.mode,
          startTime: s.startTime,
          stats: s.stats,
        }))
      );
    } catch (error) {
      logger.error('Failed to get sessions:', error);
      res.status(500).json({ error: 'Failed to get sessions' });
    }
  });

  return router;
}
