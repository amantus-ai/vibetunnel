import { Router } from 'express';
import type { SessionCreateOptions } from '../../shared/types.js';
import type { PtyManager } from '../pty/pty-manager.js';
import { TmuxManager } from '../services/tmux-manager.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('tmux-routes');

export function createTmuxRoutes(options: { ptyManager: PtyManager }): Router {
  const { ptyManager } = options;
  const router = Router();
  const tmuxManager = TmuxManager.getInstance(ptyManager);

  /**
   * Check if tmux is available
   */
  router.get('/available', async (_req, res) => {
    try {
      const available = await tmuxManager.isAvailable();
      res.json({ available });
    } catch (error) {
      logger.error('Failed to check tmux availability', { error });
      res.status(500).json({ error: 'Failed to check tmux availability' });
    }
  });

  /**
   * List all tmux sessions
   */
  router.get('/sessions', async (_req, res) => {
    try {
      const sessions = await tmuxManager.listSessions();
      res.json({ sessions });
    } catch (error) {
      logger.error('Failed to list tmux sessions', { error });
      res.status(500).json({ error: 'Failed to list tmux sessions' });
    }
  });

  /**
   * List windows in a tmux session
   */
  router.get('/sessions/:sessionName/windows', async (req, res) => {
    try {
      const { sessionName } = req.params;
      const windows = await tmuxManager.listWindows(sessionName);
      res.json({ windows });
    } catch (error) {
      logger.error('Failed to list tmux windows', { error });
      res.status(500).json({ error: 'Failed to list tmux windows' });
    }
  });

  /**
   * List panes in a tmux session or window
   */
  router.get('/sessions/:sessionName/panes', async (req, res) => {
    try {
      const { sessionName } = req.params;
      const windowIndex = req.query.window
        ? Number.parseInt(req.query.window as string, 10)
        : undefined;
      const panes = await tmuxManager.listPanes(sessionName, windowIndex);
      res.json({ panes });
    } catch (error) {
      logger.error('Failed to list tmux panes', { error });
      res.status(500).json({ error: 'Failed to list tmux panes' });
    }
  });

  /**
   * Create a new tmux session
   */
  router.post('/sessions', async (req, res) => {
    try {
      const { name, command } = req.body;
      if (!name) {
        return res.status(400).json({ error: 'Session name is required' });
      }
      await tmuxManager.createSession(name, command);
      res.json({ success: true, name });
    } catch (error) {
      logger.error('Failed to create tmux session', { error });
      res.status(500).json({ error: 'Failed to create tmux session' });
    }
  });

  /**
   * Attach to a tmux session/window/pane
   */
  router.post('/attach', async (req, res) => {
    try {
      const { sessionName, windowIndex, paneIndex, cols, rows, workingDir, titleMode } = req.body;

      if (!sessionName) {
        return res.status(400).json({ error: 'Session name is required' });
      }

      const options: Partial<SessionCreateOptions> = {
        cols,
        rows,
        workingDir,
        titleMode,
      };

      const sessionId = await tmuxManager.attachToTmux(
        sessionName,
        windowIndex,
        paneIndex,
        options
      );

      res.json({
        success: true,
        sessionId,
        target: {
          session: sessionName,
          window: windowIndex,
          pane: paneIndex,
        },
      });
    } catch (error) {
      logger.error('Failed to attach to tmux session', { error });
      res.status(500).json({ error: 'Failed to attach to tmux session' });
    }
  });

  /**
   * Send command to a tmux pane
   */
  router.post('/sessions/:sessionName/send', async (req, res) => {
    try {
      const { sessionName } = req.params;
      const { command, windowIndex, paneIndex } = req.body;

      if (!command) {
        return res.status(400).json({ error: 'Command is required' });
      }

      await tmuxManager.sendToPane(sessionName, command, windowIndex, paneIndex);
      res.json({ success: true });
    } catch (error) {
      logger.error('Failed to send command to tmux pane', { error });
      res.status(500).json({ error: 'Failed to send command to tmux pane' });
    }
  });

  /**
   * Kill a tmux session
   */
  router.delete('/sessions/:sessionName', async (req, res) => {
    try {
      const { sessionName } = req.params;
      await tmuxManager.killSession(sessionName);
      res.json({ success: true });
    } catch (error) {
      logger.error('Failed to kill tmux session', { error });
      res.status(500).json({ error: 'Failed to kill tmux session' });
    }
  });

  /**
   * Get current tmux context (if inside tmux)
   */
  router.get('/context', (_req, res) => {
    const insideTmux = tmuxManager.isInsideTmux();
    const currentSession = tmuxManager.getCurrentSession();

    res.json({
      insideTmux,
      currentSession,
    });
  });

  return router;
}
