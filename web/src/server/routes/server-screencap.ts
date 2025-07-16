import { type Request, type Response, Router } from 'express';
import type { WebSocket } from 'ws';
import { desktopCaptureService } from '../capture/desktop-capture-service.js';
import { streamHandler } from '../capture/stream-handler.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('server-screencap-routes');

// Control message types to match Mac implementation
interface ControlMessage {
  id: string;
  type: 'request' | 'response' | 'event';
  category: 'screencap';
  action: string;
  payload?: unknown;
  sessionId?: string;
  userId?: string;
  error?: string;
}

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
        // Streaming is handled via WebSocket at /ws/server-capture?sessionId=...
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
