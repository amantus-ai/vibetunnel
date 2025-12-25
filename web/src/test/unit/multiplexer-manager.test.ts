import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PtyManager } from '../../server/pty/pty-manager.js';
import { MultiplexerManager } from '../../server/services/multiplexer-manager.js';
import { ScreenManager } from '../../server/services/screen-manager.js';
import { TmuxManager } from '../../server/services/tmux-manager.js';
import { ZellijManager } from '../../server/services/zellij-manager.js';
import type { MultiplexerType } from '../../shared/multiplexer-types.js';
import { TitleMode } from '../../shared/types.js';

// Mock the managers
vi.mock('../../server/services/tmux-manager.js');
vi.mock('../../server/services/zellij-manager.js');
vi.mock('../../server/services/screen-manager.js');

// Mock PtyManager
const mockPtyManager = {
  createSession: vi.fn(),
} as unknown as PtyManager;

describe('MultiplexerManager', () => {
  let multiplexerManager: MultiplexerManager;
  let mockTmuxManager: Partial<{
    listSessions: () => Promise<unknown[]>;
    createSession: (options: unknown) => Promise<string>;
    attachToSession: (sessionId: string) => Promise<void>;
    killSession: (sessionId: string) => Promise<void>;
  }>;
  let mockZellijManager: Partial<{
    listSessions: () => Promise<unknown[]>;
    createSession: (options: unknown) => Promise<string>;
    attachToSession: (sessionId: string) => Promise<void>;
    killSession: (sessionId: string) => Promise<void>;
  }>;
  let mockScreenManager: Partial<{
    listSessions: () => Promise<unknown[]>;
    createSession: (options: unknown) => Promise<string>;
    attachToSession: (sessionId: string) => Promise<void>;
    killSession: (sessionId: string) => Promise<void>;
  }>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset singleton instance
    (MultiplexerManager as unknown as { instance?: MultiplexerManager }).instance = undefined;

    // Setup mock instances
    mockTmuxManager = {
      isAvailable: vi.fn(),
      listSessions: vi.fn(),
      listWindows: vi.fn(),
      listPanes: vi.fn(),
      createSession: vi.fn(),
      attachToTmux: vi.fn(),
      killSession: vi.fn(),
      isInsideTmux: vi.fn(),
      getCurrentSession: vi.fn(),
    };

    mockZellijManager = {
      isAvailable: vi.fn(),
      listSessions: vi.fn(),
      createSession: vi.fn(),
      attachToZellij: vi.fn(),
      killSession: vi.fn(),
      isInsideZellij: vi.fn(),
      getCurrentSession: vi.fn(),
    };

    mockScreenManager = {
      isAvailable: vi.fn(),
      listSessions: vi.fn(),
      createSession: vi.fn(),
      attachToSession: vi.fn(),
      killSession: vi.fn(),
      isInsideScreen: vi.fn(),
      getCurrentSession: vi.fn(),
    };

    // Mock getInstance methods
    vi.mocked(TmuxManager.getInstance).mockReturnValue(mockTmuxManager);
    vi.mocked(ZellijManager.getInstance).mockReturnValue(mockZellijManager);
    vi.mocked(ScreenManager.getInstance).mockReturnValue(mockScreenManager);

    multiplexerManager = MultiplexerManager.getInstance(mockPtyManager);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAvailableMultiplexers', () => {
    it('should return status for all multiplexers', async () => {
      mockTmuxManager.isAvailable.mockResolvedValue(true);
      mockZellijManager.isAvailable.mockResolvedValue(false);
      mockScreenManager.isAvailable.mockResolvedValue(false);
      mockTmuxManager.listSessions.mockResolvedValue([
        { name: 'main', windows: 2 },
        { name: 'dev', windows: 1 },
      ]);

      const result = await multiplexerManager.getAvailableMultiplexers();

      expect(result).toEqual({
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
      });
    });

    it('should handle errors when listing sessions', async () => {
      mockTmuxManager.isAvailable.mockResolvedValue(true);
      mockZellijManager.isAvailable.mockResolvedValue(true);
      mockScreenManager.isAvailable.mockResolvedValue(false);
      mockTmuxManager.listSessions.mockRejectedValue(new Error('tmux error'));
      mockZellijManager.listSessions.mockResolvedValue([
        { name: 'main', created: '1h ago', exited: false },
      ]);

      const result = await multiplexerManager.getAvailableMultiplexers();

      expect(result.tmux.sessions).toEqual([]);
      expect(result.zellij.sessions).toEqual([
        { name: 'main', created: '1h ago', exited: false, type: 'zellij' },
      ]);
      expect(result.screen.sessions).toEqual([]);
    });
  });

  describe('getTmuxWindows', () => {
    it('should return windows for tmux session', async () => {
      const mockWindows = [
        { index: 0, name: 'vim', panes: 1, active: true },
        { index: 1, name: 'shell', panes: 2, active: false },
      ];
      mockTmuxManager.listWindows.mockResolvedValue(mockWindows);

      const windows = await multiplexerManager.getTmuxWindows('main');

      expect(windows).toEqual(mockWindows);
      expect(mockTmuxManager.listWindows).toHaveBeenCalledWith('main');
    });
  });

  describe('getTmuxPanes', () => {
    it('should return panes for tmux session', async () => {
      const mockPanes = [
        { sessionName: 'main', windowIndex: 0, paneIndex: 0, active: true },
        { sessionName: 'main', windowIndex: 0, paneIndex: 1, active: false },
      ];
      mockTmuxManager.listPanes.mockResolvedValue(mockPanes);

      const panes = await multiplexerManager.getTmuxPanes('main');

      expect(panes).toEqual(mockPanes);
      expect(mockTmuxManager.listPanes).toHaveBeenCalledWith('main', undefined);
    });

    it('should return panes for specific window', async () => {
      const mockPanes = [{ sessionName: 'main', windowIndex: 1, paneIndex: 0, active: true }];
      mockTmuxManager.listPanes.mockResolvedValue(mockPanes);

      const panes = await multiplexerManager.getTmuxPanes('main', 1);

      expect(panes).toEqual(mockPanes);
      expect(mockTmuxManager.listPanes).toHaveBeenCalledWith('main', 1);
    });
  });

  describe('createSession', () => {
    it('should create tmux session', async () => {
      await multiplexerManager.createSession('tmux', 'new-session', { command: 'vim' });

      expect(mockTmuxManager.createSession).toHaveBeenCalledWith('new-session', 'vim');
      expect(mockZellijManager.createSession).not.toHaveBeenCalled();
    });

    it('should create zellij session', async () => {
      await multiplexerManager.createSession('zellij', 'new-session', { layout: 'compact' });

      expect(mockZellijManager.createSession).toHaveBeenCalledWith('new-session', 'compact');
      expect(mockTmuxManager.createSession).not.toHaveBeenCalled();
    });

    it('should create screen session', async () => {
      await multiplexerManager.createSession('screen', 'new-session');

      expect(mockScreenManager.createSession).toHaveBeenCalledWith('new-session', undefined);
      expect(mockTmuxManager.createSession).not.toHaveBeenCalled();
      expect(mockZellijManager.createSession).not.toHaveBeenCalled();
    });

    it('should throw error for unknown multiplexer type', async () => {
      await expect(
        multiplexerManager.createSession('unknown' as unknown as MultiplexerType, 'new-session')
      ).rejects.toThrow('Unknown multiplexer type: unknown');
    });
  });

  describe('attachToSession', () => {
    it('should attach to tmux session', async () => {
      mockTmuxManager.attachToTmux.mockResolvedValue('vt-123');

      const sessionId = await multiplexerManager.attachToSession('tmux', 'main');

      expect(sessionId).toBe('vt-123');
      expect(mockTmuxManager.attachToTmux).toHaveBeenCalledWith(
        'main',
        undefined,
        undefined,
        undefined
      );
    });

    it('should attach to tmux window and pane', async () => {
      mockTmuxManager.attachToTmux.mockResolvedValue('vt-456');

      const sessionId = await multiplexerManager.attachToSession('tmux', 'main', {
        windowIndex: 1,
        paneIndex: 2,
      });

      expect(sessionId).toBe('vt-456');
      expect(mockTmuxManager.attachToTmux).toHaveBeenCalledWith('main', 1, 2, {
        windowIndex: 1,
        paneIndex: 2,
      });
    });

    it('should attach to zellij session', async () => {
      mockZellijManager.attachToZellij.mockResolvedValue('vt-789');

      const sessionId = await multiplexerManager.attachToSession('zellij', 'main');

      expect(sessionId).toBe('vt-789');
      expect(mockZellijManager.attachToZellij).toHaveBeenCalledWith('main', undefined);
    });

    it('should attach to screen session', async () => {
      mockScreenManager.attachToSession.mockResolvedValue(['screen', '-r', 'main']);
      mockPtyManager.createSession.mockResolvedValue({ sessionId: 'vt-999' });

      const sessionId = await multiplexerManager.attachToSession('screen', 'main');

      expect(sessionId).toBe('vt-999');
      expect(mockScreenManager.attachToSession).toHaveBeenCalledWith('main');
      expect(mockPtyManager.createSession).toHaveBeenCalledWith(
        ['screen', '-r', 'main'],
        expect.objectContaining({ titleMode: TitleMode.STATIC })
      );
    });

    it('should throw error for unknown multiplexer type', async () => {
      await expect(
        multiplexerManager.attachToSession('unknown' as unknown as MultiplexerType, 'main')
      ).rejects.toThrow('Unknown multiplexer type: unknown');
    });
  });

  describe('killSession', () => {
    it('should kill tmux session', async () => {
      await multiplexerManager.killSession('tmux', 'old-session');

      expect(mockTmuxManager.killSession).toHaveBeenCalledWith('old-session');
      expect(mockZellijManager.killSession).not.toHaveBeenCalled();
    });

    it('should kill zellij session', async () => {
      await multiplexerManager.killSession('zellij', 'old-session');

      expect(mockZellijManager.killSession).toHaveBeenCalledWith('old-session');
      expect(mockTmuxManager.killSession).not.toHaveBeenCalled();
    });

    it('should kill screen session', async () => {
      await multiplexerManager.killSession('screen', 'old-session');

      expect(mockScreenManager.killSession).toHaveBeenCalledWith('old-session');
      expect(mockTmuxManager.killSession).not.toHaveBeenCalled();
      expect(mockZellijManager.killSession).not.toHaveBeenCalled();
    });

    it('should throw error for unknown multiplexer type', async () => {
      await expect(
        multiplexerManager.killSession('unknown' as unknown as MultiplexerType, 'old-session')
      ).rejects.toThrow('Unknown multiplexer type: unknown');
    });
  });

  describe('getCurrentMultiplexer', () => {
    it('should return tmux when inside tmux', () => {
      mockTmuxManager.isInsideTmux.mockReturnValue(true);
      mockTmuxManager.getCurrentSession.mockReturnValue('main');
      mockZellijManager.isInsideZellij.mockReturnValue(false);

      const result = multiplexerManager.getCurrentMultiplexer();

      expect(result).toEqual({ type: 'tmux', session: 'main' });
    });

    it('should return zellij when inside zellij', () => {
      mockTmuxManager.isInsideTmux.mockReturnValue(false);
      mockZellijManager.isInsideZellij.mockReturnValue(true);
      mockZellijManager.getCurrentSession.mockReturnValue('dev');
      mockScreenManager.isInsideScreen.mockReturnValue(false);

      const result = multiplexerManager.getCurrentMultiplexer();

      expect(result).toEqual({ type: 'zellij', session: 'dev' });
    });

    it('should return screen when inside screen', () => {
      mockTmuxManager.isInsideTmux.mockReturnValue(false);
      mockZellijManager.isInsideZellij.mockReturnValue(false);
      mockScreenManager.isInsideScreen.mockReturnValue(true);
      mockScreenManager.getCurrentSession.mockReturnValue('myscreen');

      const result = multiplexerManager.getCurrentMultiplexer();

      expect(result).toEqual({ type: 'screen', session: 'myscreen' });
    });

    it('should return null when not inside any multiplexer', () => {
      mockTmuxManager.isInsideTmux.mockReturnValue(false);
      mockZellijManager.isInsideZellij.mockReturnValue(false);
      mockScreenManager.isInsideScreen.mockReturnValue(false);

      const result = multiplexerManager.getCurrentMultiplexer();

      expect(result).toBeNull();
    });

    it('should return null when inside tmux but no session', () => {
      mockTmuxManager.isInsideTmux.mockReturnValue(true);
      mockTmuxManager.getCurrentSession.mockReturnValue(null);

      const result = multiplexerManager.getCurrentMultiplexer();

      expect(result).toBeNull();
    });
  });
});
