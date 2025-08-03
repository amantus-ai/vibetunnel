import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PtyManager } from '../../server/pty/pty-manager.js';

// Hoist mock declarations
const { mockExecFileAsync, mockLogger } = vi.hoisted(() => {
  const mockLogger = {
    log: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  };
  return {
    mockExecFileAsync: vi.fn(),
    mockLogger,
  };
});

// Mock child_process
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

// Mock util.promisify to return our mock
vi.mock('util', () => ({
  promisify: vi.fn(() => mockExecFileAsync),
}));

// Mock logger
vi.mock('../../server/utils/logger.js', () => ({
  createLogger: () => mockLogger,
}));

// Import after mocks are set up
import { ZellijManager } from '../../server/services/zellij-manager.js';

// Mock PtyManager
const mockPtyManager = {
  createSession: vi.fn(),
} as unknown as PtyManager;

describe('ZellijManager', () => {
  let zellijManager: ZellijManager;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton instance
    // @ts-ignore - accessing private instance for test reset
    ZellijManager.instance = undefined;
    zellijManager = ZellijManager.getInstance(mockPtyManager);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isAvailable', () => {
    it('should return true when zellij is installed', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '/usr/local/bin/zellij', stderr: '' });

      const result = await zellijManager.isAvailable();
      expect(result).toBe(true);
      expect(mockExecFileAsync).toHaveBeenCalledWith('which', ['zellij']);
    });

    it('should return false when zellij is not installed', async () => {
      mockExecFileAsync.mockRejectedValue(new Error('zellij not found'));

      const result = await zellijManager.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe('listSessions', () => {
    it('should parse active zellij sessions correctly', async () => {
      const mockOutput = `\x1b[32;1mmain [Created 2h ago]\x1b[0m
\x1b[32;1mdev-session [Created 30m ago]\x1b[0m
\x1b[31;1mold-session [EXITED] [Created 1d ago]\x1b[0m`;

      mockExecFileAsync.mockResolvedValue({ stdout: mockOutput, stderr: '' });

      const sessions = await zellijManager.listSessions();

      expect(sessions).toHaveLength(3);
      expect(sessions[0]).toEqual({
        name: 'main',
        created: '2h ago',
        exited: false,
      });
      expect(sessions[1]).toEqual({
        name: 'dev-session',
        created: '30m ago',
        exited: false,
      });
      expect(sessions[2]).toEqual({
        name: 'old-session',
        created: '1d ago',
        exited: true,
      });
    });

    it('should strip ANSI codes from session names', async () => {
      const mockOutput = `\x1b[32;1mcolor-session [Created 15s ago]\x1b[0m`;

      mockExecFileAsync.mockResolvedValue({ stdout: mockOutput, stderr: '' });

      const sessions = await zellijManager.listSessions();

      expect(sessions).toHaveLength(1);
      expect(sessions[0].name).toBe('color-session');
      expect(sessions[0].name).not.toContain('\x1b');
    });

    it('should return empty array when no sessions exist', async () => {
      mockExecFileAsync.mockResolvedValue({
        stdout: 'No active zellij sessions found',
        stderr: '',
      });

      const sessions = await zellijManager.listSessions();
      expect(sessions).toEqual([]);
    });

    it('should handle error with "No active zellij sessions" message', async () => {
      mockExecFileAsync.mockRejectedValue(new Error('No active zellij sessions found'));

      const sessions = await zellijManager.listSessions();
      expect(sessions).toEqual([]);
    });
  });

  describe('getSessionTabs', () => {
    it('should return empty array and log warning', async () => {
      const tabs = await zellijManager.getSessionTabs('main');

      expect(tabs).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('createSession', () => {
    it('should log that session will be created on attach', async () => {
      await zellijManager.createSession('new-session');

      expect(mockExecFileAsync).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Zellij session will be created on first attach'),
        expect.any(Object)
      );
    });

    it('should log layout preference if provided', async () => {
      await zellijManager.createSession('new-session', 'compact');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Layout preference noted'),
        expect.objectContaining({ name: 'new-session', layout: 'compact' })
      );
    });
  });

  describe('attachToZellij', () => {
    it('should create a PTY session for zellij attach with -c flag', async () => {
      const mockSession = { sessionId: 'vt-123' };
      mockPtyManager.createSession.mockResolvedValue(mockSession);
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' }); // No sessions exist

      const sessionId = await zellijManager.attachToZellij('main');

      expect(sessionId).toBe('vt-123');
      expect(mockPtyManager.createSession).toHaveBeenCalledWith(
        ['zellij', 'attach', '-c', 'main'],
        expect.objectContaining({
          name: 'zellij: main',
          workingDir: expect.any(String),
          cols: 80,
          rows: 24,
        })
      );
    });

    it('should add layout for new session', async () => {
      const mockSession = { sessionId: 'vt-456' };
      mockPtyManager.createSession.mockResolvedValue(mockSession);
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' }); // No sessions exist

      const sessionId = await zellijManager.attachToZellij('dev', { layout: 'compact' });

      expect(sessionId).toBe('vt-456');
      expect(mockPtyManager.createSession).toHaveBeenCalledWith(
        ['zellij', 'attach', '-c', 'dev', '-l', 'compact'],
        expect.any(Object)
      );
    });

    it('should not add layout for existing session', async () => {
      const mockSession = { sessionId: 'vt-789' };
      mockPtyManager.createSession.mockResolvedValue(mockSession);
      mockExecFileAsync.mockImplementation((cmd, args) => {
        if (cmd === 'zellij' && args[0] === 'list-sessions') {
          return Promise.resolve({ stdout: 'dev [Created 10m ago]', stderr: '' });
        } else {
          return Promise.resolve({ stdout: '', stderr: '' });
        }
      });

      const sessionId = await zellijManager.attachToZellij('dev', { layout: 'compact' });

      expect(sessionId).toBe('vt-789');
      expect(mockPtyManager.createSession).toHaveBeenCalledWith(
        ['zellij', 'attach', '-c', 'dev'], // No layout flag
        expect.any(Object)
      );
    });
  });

  describe('killSession', () => {
    it('should kill a zellij session', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await zellijManager.killSession('old-session');

      expect(mockExecFileAsync).toHaveBeenCalledWith('zellij', [
        'delete-session',
        '--force',
        'old-session',
      ]);
    });
  });

  describe('deleteSession', () => {
    it('should delete a zellij session', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await zellijManager.deleteSession('old-session');

      expect(mockExecFileAsync).toHaveBeenCalledWith('zellij', ['delete-session', 'old-session']);
    });
  });

  describe('isInsideZellij', () => {
    it('should return true when inside zellij', () => {
      process.env.ZELLIJ = '1';
      expect(zellijManager.isInsideZellij()).toBe(true);
    });

    it('should return false when not inside zellij', () => {
      delete process.env.ZELLIJ;
      expect(zellijManager.isInsideZellij()).toBe(false);
    });
  });

  describe('getCurrentSession', () => {
    it('should return current session name when inside zellij', () => {
      process.env.ZELLIJ = '1';
      process.env.ZELLIJ_SESSION_NAME = 'main';

      const session = zellijManager.getCurrentSession();
      expect(session).toBe('main');
    });

    it('should return null when not inside zellij', () => {
      delete process.env.ZELLIJ;
      delete process.env.ZELLIJ_SESSION_NAME;

      const session = zellijManager.getCurrentSession();
      expect(session).toBeNull();
    });

    it('should return null when inside zellij but no session name', () => {
      process.env.ZELLIJ = '1';
      delete process.env.ZELLIJ_SESSION_NAME;

      const session = zellijManager.getCurrentSession();
      expect(session).toBeNull();
    });
  });

  describe('stripAnsiCodes', () => {
    it('should strip ANSI escape codes', () => {
      const input = '\x1b[32;1mGreen Bold Text\x1b[0m Normal \x1b[31mRed\x1b[0m';
      const result = (
        zellijManager as ZellijManager & { stripAnsiCodes: (input: string) => string }
      ).stripAnsiCodes(input);

      expect(result).toBe('Green Bold Text Normal Red');
      expect(result).not.toContain('\x1b');
    });
  });
});
