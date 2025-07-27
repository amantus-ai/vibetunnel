import { Router } from 'express';
import type { MultiplexerType } from '../../shared/multiplexer-types.js';
import type { SessionCreateOptions } from '../../shared/types.js';
import type { PtyManager } from '../pty/pty-manager.js';
import { MultiplexerManager } from '../services/multiplexer-manager.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('multiplexer-routes');

export function createMultiplexerRoutes(options: { ptyManager: PtyManager }): Router {
  const { ptyManager } = options;
  const router = Router();
  const multiplexerManager = MultiplexerManager.getInstance(ptyManager);

  /**
   * Get available multiplexers and their sessions
   */
  router.get('/status', async (_req, res) => {
    try {
      const status = await multiplexerManager.getAvailableMultiplexers();
      res.json(status);
    } catch (error) {
      logger.error('Failed to get multiplexer status', { error });
      res.status(500).json({ error: 'Failed to get multiplexer status' });
    }
  });

  /**
   * Get windows for a tmux session
   */
  router.get('/tmux/sessions/:sessionName/windows', async (req, res) => {
    try {
      const { sessionName } = req.params;
      const windows = await multiplexerManager.getTmuxWindows(sessionName);
      res.json({ windows });
    } catch (error) {
      logger.error('Failed to list tmux windows', { error });
      res.status(500).json({ error: 'Failed to list tmux windows' });
    }
  });

  /**
   * Get panes for a tmux window
   */
  router.get('/tmux/sessions/:sessionName/panes', async (req, res) => {
    try {
      const { sessionName } = req.params;
      const windowIndex = req.query.window
        ? Number.parseInt(req.query.window as string, 10)
        : undefined;
      const panes = await multiplexerManager.getTmuxPanes(sessionName, windowIndex);
      res.json({ panes });
    } catch (error) {
      logger.error('Failed to list tmux panes', { error });
      res.status(500).json({ error: 'Failed to list tmux panes' });
    }
  });

  /**
   * Create a new session
   */
  router.post('/sessions', async (req, res) => {
    try {
      const { type, name, options } = req.body;

      if (!type || !name) {
        return res.status(400).json({ error: 'Type and name are required' });
      }

      await multiplexerManager.createSession(type, name, options);
      res.json({ success: true, type, name });
    } catch (error) {
      logger.error('Failed to create session', { error });
      res.status(500).json({ error: 'Failed to create session' });
    }
  });

  /**
   * Attach to a session
   */
  router.post('/attach', async (req, res) => {
    try {
      const { type, sessionName, windowIndex, paneIndex, cols, rows, workingDir, titleMode } =
        req.body;

      if (!type || !sessionName) {
        return res.status(400).json({ error: 'Type and session name are required' });
      }

      const options: Partial<SessionCreateOptions> & {
        windowIndex?: number;
        paneIndex?: number;
      } = {
        cols,
        rows,
        workingDir,
        titleMode,
        windowIndex,
        paneIndex,
      };

      const sessionId = await multiplexerManager.attachToSession(type, sessionName, options);

      res.json({
        success: true,
        sessionId,
        target: {
          type,
          session: sessionName,
          window: windowIndex,
          pane: paneIndex,
        },
      });
    } catch (error) {
      logger.error('Failed to attach to session', { error });
      res.status(500).json({ error: 'Failed to attach to session' });
    }
  });

  /**
   * Kill a session
   */
  router.delete('/:type/sessions/:sessionName', async (req, res) => {
    try {
      const { type, sessionName } = req.params;
      await multiplexerManager.killSession(type as MultiplexerType, sessionName);
      res.json({ success: true });
    } catch (error) {
      logger.error('Failed to kill session', { error });
      res.status(500).json({ error: 'Failed to kill session' });
    }
  });

  /**
   * Kill a tmux window
   */
  router.delete('/tmux/sessions/:sessionName/windows/:windowIndex', async (req, res) => {
    try {
      const { sessionName, windowIndex } = req.params;
      await multiplexerManager.killTmuxWindow(sessionName, Number.parseInt(windowIndex, 10));
      res.json({ success: true });
    } catch (error) {
      logger.error('Failed to kill window', { error });
      res.status(500).json({ error: 'Failed to kill window' });
    }
  });

  /**
   * Kill a tmux pane
   */
  router.delete('/tmux/sessions/:sessionName/panes/:paneId', async (req, res) => {
    try {
      const { sessionName, paneId } = req.params;
      await multiplexerManager.killTmuxPane(sessionName, paneId);
      res.json({ success: true });
    } catch (error) {
      logger.error('Failed to kill pane', { error });
      res.status(500).json({ error: 'Failed to kill pane' });
    }
  });

  /**
   * Get current multiplexer context
   */
  router.get('/context', (_req, res) => {
    const context = multiplexerManager.getCurrentMultiplexer();
    res.json({ context });
  });

  return router;
}
