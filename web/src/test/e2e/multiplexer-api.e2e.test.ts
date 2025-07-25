import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Server } from 'http';
import type { Express } from 'express';
import request from 'supertest';
import { createTestServer } from '../utils/test-server.js';
import { TEST_CONFIG } from '../utils/test-config.js';
import { MultiplexerManager } from '../../server/services/multiplexer-manager.js';

describe('Multiplexer API Tests', () => {
  let app: Express;
  let server: Server;
  let mockMultiplexerManager: any;

  beforeAll(async () => {
    // Create test server
    const testSetup = await createTestServer({
      disableAuth: true,
      customSetup: (app, container) => {
        // Mock MultiplexerManager
        mockMultiplexerManager = {
          getAvailableMultiplexers: vi.fn(),
          getTmuxWindows: vi.fn(),
          getTmuxPanes: vi.fn(),
          createSession: vi.fn(),
          attachToSession: vi.fn(),
          killSession: vi.fn(),
        };
        
        // Replace the real MultiplexerManager with our mock
        container.register('multiplexerManager', { useValue: mockMultiplexerManager });
      },
    });

    app = testSetup.app;
    server = testSetup.server;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
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
      };

      mockMultiplexerManager.getAvailableMultiplexers.mockResolvedValue(mockStatus);

      const response = await request(app)
        .get('/api/multiplexer/status')
        .expect(200);

      expect(response.body).toEqual(mockStatus);
    });

    it('should handle errors gracefully', async () => {
      mockMultiplexerManager.getAvailableMultiplexers.mockRejectedValue(
        new Error('Failed to get status')
      );

      const response = await request(app)
        .get('/api/multiplexer/status')
        .expect(500);

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

      await request(app)
        .get('/api/multiplexer/tmux/sessions/my-session-123/windows')
        .expect(200);

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
      const mockPanes = [
        { sessionName: 'main', windowIndex: 1, paneIndex: 0, active: true },
      ];

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
          command: 'vim',
        })
        .expect(200);

      expect(response.body).toEqual({ success: true });
      expect(mockMultiplexerManager.createSession).toHaveBeenCalledWith(
        'tmux',
        'new-session',
        { command: 'vim' }
      );
    });

    it('should create zellij session', async () => {
      mockMultiplexerManager.createSession.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/multiplexer/sessions')
        .send({
          type: 'zellij',
          name: 'new-session',
          layout: 'compact',
        })
        .expect(200);

      expect(response.body).toEqual({ success: true });
      expect(mockMultiplexerManager.createSession).toHaveBeenCalledWith(
        'zellij',
        'new-session',
        { layout: 'compact' }
      );
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
          metadata: { source: 'test' },
        })
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        sessionId: 'vt-123',
      });
      expect(mockMultiplexerManager.attachToSession).toHaveBeenCalledWith(
        'tmux',
        'main',
        {
          cols: 120,
          rows: 40,
          metadata: { source: 'test' },
        }
      );
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
      });
      expect(mockMultiplexerManager.attachToSession).toHaveBeenCalledWith(
        'tmux',
        'main',
        {
          windowIndex: 1,
          paneIndex: 2,
        }
      );
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
      });
    });

    it('should require type and sessionName', async () => {
      const response = await request(app)
        .post('/api/multiplexer/attach')
        .send({ type: 'tmux' })
        .expect(400);

      expect(response.body).toEqual({
        error: 'Type and sessionName are required',
      });
    });
  });

  describe('DELETE /api/multiplexer/sessions/:type/:sessionName', () => {
    it('should kill tmux session', async () => {
      mockMultiplexerManager.killSession.mockResolvedValue(undefined);

      const response = await request(app)
        .delete('/api/multiplexer/sessions/tmux/old-session')
        .expect(200);

      expect(response.body).toEqual({ success: true });
      expect(mockMultiplexerManager.killSession).toHaveBeenCalledWith('tmux', 'old-session');
    });

    it('should kill zellij session', async () => {
      mockMultiplexerManager.killSession.mockResolvedValue(undefined);

      const response = await request(app)
        .delete('/api/multiplexer/sessions/zellij/old-session')
        .expect(200);

      expect(response.body).toEqual({ success: true });
      expect(mockMultiplexerManager.killSession).toHaveBeenCalledWith('zellij', 'old-session');
    });

    it('should handle errors', async () => {
      mockMultiplexerManager.killSession.mockRejectedValue(
        new Error('Session not found')
      );

      const response = await request(app)
        .delete('/api/multiplexer/sessions/tmux/nonexistent')
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
      };

      mockMultiplexerManager.getAvailableMultiplexers.mockResolvedValue(mockStatus);

      const response = await request(app)
        .get('/api/tmux/sessions')
        .expect(200);

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
      expect(mockMultiplexerManager.attachToSession).toHaveBeenCalledWith(
        'tmux',
        'main',
        {
          windowIndex: 0,
          paneIndex: 1,
          cols: 80,
          rows: 24,
        }
      );
    });
  });
});