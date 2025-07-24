import express, { type Router } from 'express';
import type { SessionManager } from '../pty/session-manager.js';
import { CodeServerManager } from '../services/code-server-manager.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
const logger = createLogger('code-server-routes');

let codeServerManager: CodeServerManager;

export function createCodeServerRoutes(options: {
  sessionManager: SessionManager;
  codeServerManager: CodeServerManager;
}): Router {
  codeServerManager = options.codeServerManager;
  const { sessionManager } = options;

  // Start code-server for a session
  router.post('/sessions/:sessionId/code-server', async (req, res) => {
    const { sessionId } = req.params;

    try {
      if (!sessionManager.sessionExists(sessionId)) {
        return res.status(404).json({ error: 'Session not found' });
      }

      const sessionInfo = sessionManager.loadSessionInfo(sessionId);
      if (!sessionInfo) {
        return res.status(404).json({ error: 'Session info not found' });
      }

      await codeServerManager.start(sessionId, sessionInfo.workingDir);

      res.json({
        success: true,
        message: 'code-server started',
        url: `/code-server/${sessionId}/`,
      });
    } catch (error) {
      logger.error(`Failed to start code-server for session ${sessionId}:`, error);
      res.status(500).json({ error: 'Failed to start code-server' });
    }
  });

  // Stop code-server for a session
  router.delete('/sessions/:sessionId/code-server', (req, res) => {
    const { sessionId } = req.params;

    try {
      codeServerManager.stop(sessionId);
      res.json({ success: true, message: 'code-server stopped' });
    } catch (error) {
      logger.error(`Failed to stop code-server for session ${sessionId}:`, error);
      res.status(500).json({ error: 'Failed to stop code-server' });
    }
  });

  // Get code-server status
  router.get('/sessions/:sessionId/code-server', (req, res) => {
    const { sessionId } = req.params;

    const isRunning = codeServerManager.isRunning(sessionId);
    const port = codeServerManager.getPort(sessionId);

    res.json({
      running: isRunning,
      port: port,
      url: isRunning ? `/code-server/${sessionId}/` : null,
    });
  });

  return router;
}

export { CodeServerManager };
