import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PtyManager } from '../../server/pty/pty-manager.js';

// Mock util.promisify to return a mock function
vi.mock('util', () => ({
  promisify: vi.fn(() => vi.fn()),
}));

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn(),
  execSync: vi.fn(),
}));

import { promisify } from 'util';
// Import after mocks are set up
import { TmuxManager } from '../../server/services/tmux-manager.js';

// Get the mocked execAsync function
const mockExecAsync = vi.mocked(promisify((() => {}) as any));

// Mock PtyManager
const mockPtyManager = {
  createSession: vi.fn(),
} as unknown as PtyManager;

describe('TmuxManager', () => {
  let tmuxManager: TmuxManager;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton instance
    (TmuxManager as any).instance = undefined;
    tmuxManager = TmuxManager.getInstance(mockPtyManager);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isAvailable', () => {
    it('should return true when tmux is installed', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '/usr/local/bin/tmux', stderr: '' });

      const result = await tmuxManager.isAvailable();
      expect(result).toBe(true);
      expect(mockExecAsync).toHaveBeenCalledWith('which tmux', { shell: '/bin/sh' });
    });

    it('should return false when tmux is not installed', async () => {
      mockExecAsync.mockRejectedValue(new Error('tmux not found'));

      const result = await tmuxManager.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe('listSessions', () => {
    it('should parse tmux sessions correctly', async () => {
      const mockOutput = `main: 1 windows (created Thu Jul 25 10:00:00 2024) [80x24] (attached)
dev: 2 windows (created Thu Jul 25 11:00:00 2024) [80x24]
test: 1 windows (created Thu Jul 25 12:00:00 2024) [80x24]`;

      mockExecAsync.mockResolvedValue({ stdout: mockOutput, stderr: '' });

      const sessions = await tmuxManager.listSessions();

      expect(sessions).toHaveLength(3);
      expect(sessions[0]).toEqual({
        name: 'main',
        windows: 1,
        created: 'Thu Jul 25 10:00:00 2024',
        size: '80x24',
        attached: true,
        current: false,
      });
      expect(sessions[1]).toEqual({
        name: 'dev',
        windows: 2,
        created: 'Thu Jul 25 11:00:00 2024',
        size: '80x24',
        attached: false,
        current: false,
      });
    });

    it('should handle shell output pollution', async () => {
      const mockOutput = `stty: stdin isn't a terminal
main: 1 windows (created Thu Jul 25 10:00:00 2024) [80x24] (attached)
/Users/test/.profile: line 10: command not found
dev: 2 windows (created Thu Jul 25 11:00:00 2024) [80x24]`;

      mockExecAsync.mockResolvedValue({ stdout: mockOutput, stderr: '' });

      const sessions = await tmuxManager.listSessions();

      expect(sessions).toHaveLength(2);
      expect(sessions[0].name).toBe('main');
      expect(sessions[1].name).toBe('dev');
    });

    it('should return empty array when no sessions exist', async () => {
      const error = new Error('no server running on /tmp/tmux-501/default');
      mockExecAsync.mockRejectedValue(error);

      const sessions = await tmuxManager.listSessions();
      expect(sessions).toEqual([]);
    });
  });

  describe('listWindows', () => {
    it('should parse tmux windows correctly', async () => {
      const mockOutput = `0: vim* (1 panes) [80x24] [layout abcd,80x24,0,0,0] @0 (active)
1: shell- (1 panes) [80x24] [layout efgh,80x24,0,0,1] @1
2: logs (2 panes) [80x24] [layout ijkl,80x24,0,0{40x24,0,0,2,39x24,41,0,3}] @2`;

      mockExecAsync.mockResolvedValue({ stdout: mockOutput, stderr: '' });

      const windows = await tmuxManager.listWindows('main');

      expect(windows).toHaveLength(3);
      expect(windows[0]).toEqual({
        index: 0,
        name: 'vim',
        panes: 1,
        size: '80x24',
        layout: 'abcd,80x24,0,0,0',
        active: true,
      });
      expect(windows[2]).toEqual({
        index: 2,
        name: 'logs',
        panes: 2,
        size: '80x24',
        layout: 'ijkl,80x24,0,0{40x24,0,0,2,39x24,41,0,3}',
        active: false,
      });
    });
  });

  describe('listPanes', () => {
    it('should parse tmux panes correctly', async () => {
      const mockOutput = `0.0|vim|/Users/test/project|vim src/index.ts|1
0.1|zsh|/Users/test/project|npm run dev|0
1.0|zsh|/Users/test|ls -la|1`;

      mockExecAsync.mockResolvedValue({ stdout: mockOutput, stderr: '' });

      const panes = await tmuxManager.listPanes('main');

      expect(panes).toHaveLength(3);
      expect(panes[0]).toEqual({
        sessionName: 'main',
        windowIndex: 0,
        paneIndex: 0,
        title: 'vim',
        currentPath: '/Users/test/project',
        command: 'vim src/index.ts',
        active: true,
      });
      expect(panes[1]).toEqual({
        sessionName: 'main',
        windowIndex: 0,
        paneIndex: 1,
        title: 'zsh',
        currentPath: '/Users/test/project',
        command: 'npm run dev',
        active: false,
      });
    });

    it('should handle panes for specific window', async () => {
      const mockOutput = `1.0|zsh|/Users/test|ls -la|1
1.1|vim|/Users/test/docs|vim README.md|0`;

      mockExecAsync.mockResolvedValue({ stdout: mockOutput, stderr: '' });

      const panes = await tmuxManager.listPanes('main', 1);

      expect(panes).toHaveLength(2);
      expect(panes[0].windowIndex).toBe(1);
      expect(panes[1].windowIndex).toBe(1);
    });
  });

  describe('createSession', () => {
    it('should create a new tmux session', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await tmuxManager.createSession('new-session');

      expect(mockExecAsync).toHaveBeenCalledWith("tmux new-session -d -s 'new-session'", {
        shell: '/bin/sh',
      });
    });

    it('should create a session with initial command', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await tmuxManager.createSession('dev-session', 'npm run dev');

      expect(mockExecAsync).toHaveBeenCalledWith(
        "tmux new-session -d -s 'dev-session' 'npm run dev'",
        { shell: '/bin/sh' }
      );
    });
  });

  describe('killSession', () => {
    it('should kill a tmux session', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await tmuxManager.killSession('old-session');

      expect(mockExecAsync).toHaveBeenCalledWith("tmux kill-session -t 'old-session'", {
        shell: '/bin/sh',
      });
    });
  });

  describe('attachToTmux', () => {
    it('should create a PTY session for tmux attach', async () => {
      const mockSession = { sessionId: 'vt-123' };
      mockPtyManager.createSession.mockResolvedValue(mockSession);

      const sessionId = await tmuxManager.attachToTmux('main');

      expect(sessionId).toBe('vt-123');
      expect(mockPtyManager.createSession).toHaveBeenCalledWith(
        ['tmux', 'attach-session', '-t', 'main'],
        expect.objectContaining({
          name: 'tmux: main',
          workingDir: expect.any(String),
          cols: 80,
          rows: 24,
        })
      );
    });

    it('should attach to specific window', async () => {
      const mockSession = { sessionId: 'vt-456' };
      mockPtyManager.createSession.mockResolvedValue(mockSession);

      const sessionId = await tmuxManager.attachToTmux('main', 2);

      expect(sessionId).toBe('vt-456');
      expect(mockPtyManager.createSession).toHaveBeenCalledWith(
        ['tmux', 'attach-session', '-t', 'main:2'],
        expect.any(Object)
      );
    });

    it('should attach to specific pane', async () => {
      const mockSession = { sessionId: 'vt-789' };
      mockPtyManager.createSession.mockResolvedValue(mockSession);

      const sessionId = await tmuxManager.attachToTmux('main', 1, 2);

      expect(sessionId).toBe('vt-789');
      expect(mockPtyManager.createSession).toHaveBeenCalledWith(
        ['tmux', 'attach-session', '-t', 'main:1.2'],
        expect.any(Object)
      );
    });
  });

  describe('isInsideTmux', () => {
    it('should return true when inside tmux', () => {
      process.env.TMUX = '/tmp/tmux-1000/default,12345,0';
      expect(tmuxManager.isInsideTmux()).toBe(true);
    });

    it('should return false when not inside tmux', () => {
      delete process.env.TMUX;
      expect(tmuxManager.isInsideTmux()).toBe(false);
    });
  });

  describe('getCurrentSession', () => {
    it('should return current session name when inside tmux', async () => {
      process.env.TMUX = '/tmp/tmux-1000/default,12345,0';
      process.env.TMUX_PANE = '%0';

      mockExecAsync.mockResolvedValue({ stdout: 'main', stderr: '' });

      const session = await tmuxManager.getCurrentSession();
      expect(session).toBe('main');
    });

    it('should return null when not inside tmux', async () => {
      delete process.env.TMUX;
      const session = await tmuxManager.getCurrentSession();
      expect(session).toBeNull();
    });
  });
});
