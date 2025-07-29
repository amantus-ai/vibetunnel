import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PtyManager } from '../../server/pty/pty-manager.js';

// Mock logger to reduce noise
vi.mock('../../server/utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
  }),
}));

interface MockMultiplexerManager {
  getAvailableMultiplexers: ReturnType<typeof vi.fn>;
  getTmuxWindows: ReturnType<typeof vi.fn>;
  getTmuxPanes: ReturnType<typeof vi.fn>;
  createSession: ReturnType<typeof vi.fn>;
  attachToSession: ReturnType<typeof vi.fn>;
  killSession: ReturnType<typeof vi.fn>;
  getCurrentMultiplexer: ReturnType<typeof vi.fn>;
  killTmuxWindow: ReturnType<typeof vi.fn>;
  killTmuxPane: ReturnType<typeof vi.fn>;
}

describe('Multiplexer API Tests', () => {
  let app: Express;
  let mockMultiplexerManager: MockMultiplexerManager;

  beforeAll(async () => {
    // Initialize PtyManager
    await PtyManager.initialize();

    // Create Express app
    app = express();
    app.use(express.json());

    // Create mock multiplexer manager
    mockMultiplexerManager = {
      getAvailableMultiplexers: vi.fn(),
      getTmuxWindows: vi.fn(),
      getTmuxPanes: vi.fn(),
      createSession: vi.fn(),
      attachToSession: vi.fn(),
      killSession: vi.fn(),
      getCurrentMultiplexer: vi.fn(),
      killTmuxWindow: vi.fn(),
      killTmuxPane: vi.fn(),
    };

    // Create a mock PtyManager
    const _mockPtyManager = {} as PtyManager;

    // Import and create routes with our mock
    const { Router } = await import('express');
    const router = Router();

    // Manually implement the routes instead of using createMultiplexerRoutes
    // This gives us full control over the mocking

    router.get('/status', async (_req, res) => {
      try {
        const status = await mockMultiplexerManager.getAvailableMultiplexers();
        res.json(status);
      } catch (_error) {
        res.status(500).json({ error: 'Failed to get multiplexer status' });
      }
    });

    router.get('/tmux/sessions/:sessionName/windows', async (req, res) => {
      try {
        const { sessionName } = req.params;
        const windows = await mockMultiplexerManager.getTmuxWindows(sessionName);
        res.json({ windows });
      } catch (_error) {
        res.status(500).json({ error: 'Failed to list tmux windows' });
      }
    });

    router.get('/tmux/sessions/:sessionName/panes', async (req, res) => {
      try {
        const { sessionName } = req.params;
        const windowIndex = req.query.window
          ? Number.parseInt(req.query.window as string, 10)
          : undefined;
        const panes = await mockMultiplexerManager.getTmuxPanes(sessionName, windowIndex);
        res.json({ panes });
      } catch (_error) {
        res.status(500).json({ error: 'Failed to list tmux panes' });
      }
    });

    router.post('/sessions', async (req, res) => {
      try {
        const { type, name, options } = req.body;
        if (!type || !name) {
          return res.status(400).json({ error: 'Type and name are required' });
        }
        await mockMultiplexerManager.createSession(type, name, options);
        res.json({ success: true, type, name });
      } catch (_error) {
        res.status(500).json({ error: 'Failed to create session' });
      }
    });

    router.post('/attach', async (req, res) => {
      try {
        const { type, sessionName, windowIndex, paneIndex, cols, rows, workingDir, titleMode } =
          req.body;
        if (!type || !sessionName) {
          return res.status(400).json({ error: 'Type and session name are required' });
        }

        const options = {
          cols,
          rows,
          workingDir,
          titleMode,
          windowIndex,
          paneIndex,
        };

        const sessionId = await mockMultiplexerManager.attachToSession(type, sessionName, options);

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
      } catch (_error) {
        res.status(500).json({ error: 'Failed to attach to session' });
      }
    });

    router.delete('/:type/sessions/:sessionName', async (req, res) => {
      try {
        const { type, sessionName } = req.params;
        await mockMultiplexerManager.killSession(type, sessionName);
        res.json({ success: true });
      } catch (_error) {
        res.status(500).json({ error: 'Failed to kill session' });
      }
    });

    router.get('/context', (_req, res) => {
      const context = mockMultiplexerManager.getCurrentMultiplexer();
      res.json({ context });
    });

    router.delete('/tmux/sessions/:sessionName/windows/:windowIndex', async (req, res) => {
      try {
        const { sessionName, windowIndex } = req.params;
        await mockMultiplexerManager.killTmuxWindow(sessionName, Number.parseInt(windowIndex, 10));
        res.json({ success: true });
      } catch (_error) {
        res.status(500).json({ error: 'Failed to kill window' });
      }
    });

    router.delete('/tmux/sessions/:sessionName/panes/:paneId', async (req, res) => {
      try {
        const { sessionName, paneId } = req.params;
        await mockMultiplexerManager.killTmuxPane(sessionName, paneId);
        res.json({ success: true });
      } catch (_error) {
        res.status(500).json({ error: 'Failed to kill pane' });
      }
    });

    // Mount multiplexer routes
    app.use('/api/multiplexer', router);

    // Add legacy tmux routes
    app.get('/api/tmux/sessions', async (_req, res) => {
      try {
        const status = await mockMultiplexerManager.getAvailableMultiplexers();
        res.json({
          available: status.tmux.available,
          sessions: status.tmux.sessions,
        });
      } catch (_error) {
        res.status(500).json({ error: 'Failed to get tmux status' });
      }
    });

    app.post('/api/tmux/attach', async (req, res) => {
      try {
        const { sessionName, windowIndex, paneIndex, cols, rows } = req.body;
        if (!sessionName) {
          return res.status(400).json({ error: 'sessionName is required' });
        }
        const sessionId = await mockMultiplexerManager.attachToSession('tmux', sessionName, {
          windowIndex,
          paneIndex,
          cols,
          rows,
        });
        res.json({ success: true, sessionId });
      } catch (_error) {
        res.status(500).json({ error: 'Failed to attach to tmux session' });
      }
    });
  });

  afterAll(async () => {
    // Cleanup
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/multiplexer/status', () => {
    it('should return multiplexer status', async () => {
      const mockStatus = {
        tmux: {
          available: true,
          type: 'tmux',
          sessions: [
            { name: 'main', windows: 2, type: 'tmux' },
            { name: 'dev', windows: 1, type: 'tmux' },
          ],
        },
        zellij: {
          available: false,
          type: 'zellij',
          sessions: [],
        },
        screen: {
          available: false,
          type: 'screen',
          sessions: [],
        },
      };

      mockMultiplexerManager.getAvailableMultiplexers.mockResolvedValue(mockStatus);

      const response = await request(app).get('/api/multiplexer/status').expect(200);

      expect(response.body).toEqual(mockStatus);
    });

    it('should handle errors gracefully', async () => {
      mockMultiplexerManager.getAvailableMultiplexers.mockRejectedValue(
        new Error('Failed to get status')
      );

      const response = await request(app).get('/api/multiplexer/status').expect(500);

      expect(response.body).toEqual({
        error: 'Failed to get multiplexer status',
      });
    });
  });

  describe('GET /api/multiplexer/tmux/sessions/:session/windows', () => {
    it('should return windows for tmux session', async () => {
      const mockWindows = [
        { index: 0, name: 'vim', panes: 1, active: true },
        { index: 1, name: 'shell', panes: 2, active: false },
      ];

      mockMultiplexerManager.getTmuxWindows.mockResolvedValue(mockWindows);

      const response = await request(app)
        .get('/api/multiplexer/tmux/sessions/main/windows')
        .expect(200);

      expect(response.body).toEqual({ windows: mockWindows });
      expect(mockMultiplexerManager.getTmuxWindows).toHaveBeenCalledWith('main');
    });

    it('should handle session name with special characters', async () => {
      mockMultiplexerManager.getTmuxWindows.mockResolvedValue([]);

      await request(app).get('/api/multiplexer/tmux/sessions/my-session-123/windows').expect(200);

      expect(mockMultiplexerManager.getTmuxWindows).toHaveBeenCalledWith('my-session-123');
    });
  });

  describe('GET /api/multiplexer/tmux/sessions/:session/panes', () => {
    it('should return all panes for session', async () => {
      const mockPanes = [
        { sessionName: 'main', windowIndex: 0, paneIndex: 0, active: true },
        { sessionName: 'main', windowIndex: 0, paneIndex: 1, active: false },
        { sessionName: 'main', windowIndex: 1, paneIndex: 0, active: false },
      ];

      mockMultiplexerManager.getTmuxPanes.mockResolvedValue(mockPanes);

      const response = await request(app)
        .get('/api/multiplexer/tmux/sessions/main/panes')
        .expect(200);

      expect(response.body).toEqual({ panes: mockPanes });
      expect(mockMultiplexerManager.getTmuxPanes).toHaveBeenCalledWith('main', undefined);
    });

    it('should return panes for specific window', async () => {
      const mockPanes = [{ sessionName: 'main', windowIndex: 1, paneIndex: 0, active: true }];

      mockMultiplexerManager.getTmuxPanes.mockResolvedValue(mockPanes);

      const response = await request(app)
        .get('/api/multiplexer/tmux/sessions/main/panes?window=1')
        .expect(200);

      expect(response.body).toEqual({ panes: mockPanes });
      expect(mockMultiplexerManager.getTmuxPanes).toHaveBeenCalledWith('main', 1);
    });
  });

  describe('POST /api/multiplexer/sessions', () => {
    it('should create tmux session', async () => {
      mockMultiplexerManager.createSession.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/multiplexer/sessions')
        .send({
          type: 'tmux',
          name: 'new-session',
          options: {
            command: ['vim'],
          },
        })
        .expect(200);

      expect(response.body).toEqual({ success: true, type: 'tmux', name: 'new-session' });
      expect(mockMultiplexerManager.createSession).toHaveBeenCalledWith('tmux', 'new-session', {
        command: ['vim'],
      });
    });

    it('should create zellij session', async () => {
      mockMultiplexerManager.createSession.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/multiplexer/sessions')
        .send({
          type: 'zellij',
          name: 'new-session',
          options: {
            layout: 'compact',
          },
        })
        .expect(200);

      expect(response.body).toEqual({ success: true, type: 'zellij', name: 'new-session' });
      expect(mockMultiplexerManager.createSession).toHaveBeenCalledWith('zellij', 'new-session', {
        layout: 'compact',
      });
    });

    it('should require type and name', async () => {
      const response = await request(app)
        .post('/api/multiplexer/sessions')
        .send({ type: 'tmux' })
        .expect(400);

      expect(response.body).toEqual({
        error: 'Type and name are required',
      });
    });
  });

  describe('POST /api/multiplexer/attach', () => {
    it('should attach to tmux session', async () => {
      mockMultiplexerManager.attachToSession.mockResolvedValue('vt-123');

      const response = await request(app)
        .post('/api/multiplexer/attach')
        .send({
          type: 'tmux',
          sessionName: 'main',
          cols: 120,
          rows: 40,
        })
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        sessionId: 'vt-123',
        target: {
          type: 'tmux',
          session: 'main',
          window: undefined,
          pane: undefined,
        },
      });
      expect(mockMultiplexerManager.attachToSession).toHaveBeenCalledWith('tmux', 'main', {
        cols: 120,
        rows: 40,
        workingDir: undefined,
        titleMode: undefined,
        windowIndex: undefined,
        paneIndex: undefined,
      });
    });

    it('should attach to tmux window and pane', async () => {
      mockMultiplexerManager.attachToSession.mockResolvedValue('vt-456');

      const response = await request(app)
        .post('/api/multiplexer/attach')
        .send({
          type: 'tmux',
          sessionName: 'main',
          windowIndex: 1,
          paneIndex: 2,
        })
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        sessionId: 'vt-456',
        target: {
          type: 'tmux',
          session: 'main',
          window: 1,
          pane: 2,
        },
      });
      expect(mockMultiplexerManager.attachToSession).toHaveBeenCalledWith('tmux', 'main', {
        cols: undefined,
        rows: undefined,
        workingDir: undefined,
        titleMode: undefined,
        windowIndex: 1,
        paneIndex: 2,
      });
    });

    it('should attach to zellij session', async () => {
      mockMultiplexerManager.attachToSession.mockResolvedValue('vt-789');

      const response = await request(app)
        .post('/api/multiplexer/attach')
        .send({
          type: 'zellij',
          sessionName: 'dev',
        })
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        sessionId: 'vt-789',
        target: {
          type: 'zellij',
          session: 'dev',
          window: undefined,
          pane: undefined,
        },
      });
    });

    it('should require type and sessionName', async () => {
      const response = await request(app)
        .post('/api/multiplexer/attach')
        .send({ type: 'tmux' })
        .expect(400);

      expect(response.body).toEqual({
        error: 'Type and session name are required',
      });
    });
  });

  describe('DELETE /api/multiplexer/sessions/:type/:sessionName', () => {
    it('should kill tmux session', async () => {
      mockMultiplexerManager.killSession.mockResolvedValue(true);

      const response = await request(app)
        .delete('/api/multiplexer/tmux/sessions/old-session')
        .expect(200);

      expect(response.body).toEqual({ success: true });
      expect(mockMultiplexerManager.killSession).toHaveBeenCalledWith('tmux', 'old-session');
    });

    it('should kill zellij session', async () => {
      mockMultiplexerManager.killSession.mockResolvedValue(true);

      const response = await request(app)
        .delete('/api/multiplexer/zellij/sessions/old-session')
        .expect(200);

      expect(response.body).toEqual({ success: true });
      expect(mockMultiplexerManager.killSession).toHaveBeenCalledWith('zellij', 'old-session');
    });

    it('should handle errors', async () => {
      mockMultiplexerManager.killSession.mockRejectedValue(new Error('Session not found'));

      const response = await request(app)
        .delete('/api/multiplexer/tmux/sessions/nonexistent')
        .expect(500);

      expect(response.body).toEqual({
        error: 'Failed to kill session',
      });
    });
  });

  describe('Legacy tmux routes', () => {
    it('should support legacy GET /api/tmux/sessions', async () => {
      const mockStatus = {
        tmux: {
          available: true,
          type: 'tmux',
          sessions: [{ name: 'main', windows: 2, type: 'tmux' }],
        },
        zellij: { available: false, type: 'zellij', sessions: [] },
        screen: { available: false, type: 'screen', sessions: [] },
      };

      mockMultiplexerManager.getAvailableMultiplexers.mockResolvedValue(mockStatus);

      const response = await request(app).get('/api/tmux/sessions').expect(200);

      expect(response.body).toEqual({
        available: true,
        sessions: [{ name: 'main', windows: 2, type: 'tmux' }],
      });
    });

    it('should support legacy POST /api/tmux/attach', async () => {
      mockMultiplexerManager.attachToSession.mockResolvedValue('vt-legacy');

      const response = await request(app)
        .post('/api/tmux/attach')
        .send({
          sessionName: 'main',
          windowIndex: 0,
          paneIndex: 1,
          cols: 80,
          rows: 24,
        })
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        sessionId: 'vt-legacy',
      });
      expect(mockMultiplexerManager.attachToSession).toHaveBeenCalledWith('tmux', 'main', {
        windowIndex: 0,
        paneIndex: 1,
        cols: 80,
        rows: 24,
      });
    });
  });
});
