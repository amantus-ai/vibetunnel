import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PtyManager } from '../../server/pty/pty-manager.js';

// Hoist mock declarations
const { mockExecFileAsync, mockExecFileSync } = vi.hoisted(() => {
  return {
    mockExecFileAsync: vi.fn(),
    mockExecFileSync: vi.fn(),
  };
});

// Mock child_process
vi.mock('child_process', () => ({
  execFile: vi.fn(),
  execFileSync: mockExecFileSync,
}));

// Mock util.promisify to return our mock
vi.mock('util', () => ({
  promisify: vi.fn(() => mockExecFileAsync),
}));

// Import after mocks are set up
import { TmuxManager } from '../../server/services/tmux-manager.js';

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
      mockExecFileAsync.mockResolvedValue({ stdout: '/usr/local/bin/tmux', stderr: '' });

      const result = await tmuxManager.isAvailable();
      expect(result).toBe(true);
      expect(mockExecFileAsync).toHaveBeenCalledWith('which', ['tmux']);
    });

    it('should return false when tmux is not installed', async () => {
      mockExecFileAsync.mockRejectedValue(new Error('tmux not found'));

      const result = await tmuxManager.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe('listSessions', () => {
    it('should parse tmux sessions correctly', async () => {
      const mockOutput = `main|1|Thu Jul 25 10:00:00 2024|attached||
dev|2|Thu Jul 25 11:00:00 2024|detached||
test|1|Thu Jul 25 12:00:00 2024|detached||`;

      mockExecFileAsync.mockResolvedValue({ stdout: mockOutput, stderr: '' });

      const sessions = await tmuxManager.listSessions();

      expect(sessions).toHaveLength(3);
      expect(sessions[0]).toEqual({
        name: 'main',
        windows: 1,
        created: 'Thu Jul 25 10:00:00 2024',
        attached: true,
        activity: '',
        current: false,
      });
      expect(sessions[1]).toEqual({
        name: 'dev',
        windows: 2,
        created: 'Thu Jul 25 11:00:00 2024',
        attached: false,
        activity: '',
        current: false,
      });
    });

    it('should handle shell output pollution', async () => {
      const mockOutput = `stty: stdin isn't a terminal
main|1|Thu Jul 25 10:00:00 2024|attached||
/Users/test/.profile: line 10: command not found
dev|2|Thu Jul 25 11:00:00 2024|detached||`;

      mockExecFileAsync.mockResolvedValue({ stdout: mockOutput, stderr: '' });

      const sessions = await tmuxManager.listSessions();

      expect(sessions).toHaveLength(2);
      expect(sessions[0].name).toBe('main');
      expect(sessions[1].name).toBe('dev');
    });

    it('should return empty array when no sessions exist', async () => {
      const error = new Error('no server running on /tmp/tmux-501/default');
      mockExecFileAsync.mockRejectedValue(error);

      const sessions = await tmuxManager.listSessions();
      expect(sessions).toEqual([]);
    });
  });

  describe('listWindows', () => {
    it('should parse tmux windows correctly', async () => {
      const mockOutput = `main|0|vim|active|1
main|1|shell||1
main|2|logs||2`;

      mockExecFileAsync.mockResolvedValue({ stdout: mockOutput, stderr: '' });

      const windows = await tmuxManager.listWindows('main');

      expect(windows).toHaveLength(3);
      expect(windows[0]).toEqual({
        session: 'main',
        index: 0,
        name: 'vim',
        active: true,
        panes: 1,
      });
      expect(windows[2]).toEqual({
        session: 'main',
        index: 2,
        name: 'logs',
        active: false,
        panes: 2,
      });
    });
  });

  describe('listPanes', () => {
    it('should parse tmux panes correctly', async () => {
      const mockOutput = `main|0|0|active|vim|1234|vim|80|24|/Users/test/project
main|0|1||zsh|5678|npm|80|24|/Users/test/project
main|1|0|active|zsh|9012|ls|80|24|/Users/test`;

      mockExecFileAsync.mockResolvedValue({ stdout: mockOutput, stderr: '' });

      const panes = await tmuxManager.listPanes('main');

      expect(panes).toHaveLength(3);
      expect(panes[0]).toEqual({
        session: 'main',
        window: 0,
        index: 0,
        active: true,
        title: 'vim',
        pid: 1234,
        command: 'vim',
        width: 80,
        height: 24,
        currentPath: '/Users/test/project',
      });
      expect(panes[1]).toEqual({
        session: 'main',
        window: 0,
        index: 1,
        active: false,
        title: 'zsh',
        pid: 5678,
        command: 'npm',
        width: 80,
        height: 24,
        currentPath: '/Users/test/project',
      });
    });

    it('should handle panes for specific window', async () => {
      const mockOutput = `main|1|0|active|zsh|1234|ls|80|24|/Users/test
main|1|1||vim|5678|vim|80|24|/Users/test/docs`;

      mockExecFileAsync.mockResolvedValue({ stdout: mockOutput, stderr: '' });

      const panes = await tmuxManager.listPanes('main', 1);

      expect(panes).toHaveLength(2);
      expect(panes[0].window).toBe(1);
      expect(panes[1].window).toBe(1);
    });
  });

  describe('createSession', () => {
    it('should create a new tmux session', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await tmuxManager.createSession('new-session');

      expect(mockExecFileAsync).toHaveBeenCalledWith('tmux', [
        'new-session',
        '-d',
        '-s',
        'new-session',
      ]);
    });

    it('should create a session with initial command', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await tmuxManager.createSession('dev-session', ['npm', 'run', 'dev']);

      expect(mockExecFileAsync).toHaveBeenCalledWith('tmux', [
        'new-session',
        '-d',
        '-s',
        'dev-session',
        'npm',
        'run',
        'dev',
      ]);
    });
  });

  describe('killSession', () => {
    it('should kill a tmux session', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await tmuxManager.killSession('old-session');

      expect(mockExecFileAsync).toHaveBeenCalledWith('tmux', ['kill-session', '-t', 'old-session']);
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
        ['tmux', 'attach-session', '-t', 'main:1'],
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
    it('should return current session name when inside tmux', () => {
      process.env.TMUX = '/tmp/tmux-1000/default,12345,0';
      process.env.TMUX_PANE = '%0';

      mockExecFileSync.mockReturnValue('main\n');

      const session = tmuxManager.getCurrentSession();
      expect(session).toBe('main');
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'tmux',
        ['display-message', '-p', '#{session_name}'],
        expect.any(Object)
      );
    });

    it('should return null when not inside tmux', () => {
      delete process.env.TMUX;
      const session = tmuxManager.getCurrentSession();
      expect(session).toBeNull();
    });
  });
});
