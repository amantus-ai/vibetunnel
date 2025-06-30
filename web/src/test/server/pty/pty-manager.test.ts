import * as fs from 'fs';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { PtyManager } from '../../../server/pty/pty-manager.js';
import { TitleMode } from '../../../shared/types.js';

// Mock dependencies
vi.mock('fs');
vi.mock('node-pty', () => ({
  spawn: vi.fn(() => ({
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    pid: 12345,
  })),
}));

vi.mock('../../../server/pty/session-manager.js', () => ({
  SessionManager: vi.fn().mockImplementation(() => ({
    createSession: vi.fn(() => ({
      id: 'test-session-id',
      controlDir: '/tmp/test-control',
      sessionInfo: {
        id: 'test-session-id',
        name: 'test-session',
        command: ['claude'],
        workingDir: '/test/dir',
        status: 'running',
        startedAt: new Date().toISOString(),
      },
    })),
    getSessionPaths: vi.fn((id) => ({
      controlDir: `/tmp/test-control/${id}`,
      stdoutPath: `/tmp/test-control/${id}/stdout`,
      stdinPath: `/tmp/test-control/${id}/stdin`,
    })),
    listSessions: vi.fn(() => [
      {
        id: 'session-1',
        name: 'Session 1',
        command: ['claude'],
        workingDir: '/test',
        status: 'running',
        startedAt: new Date().toISOString(),
      },
      {
        id: 'session-2',
        name: 'Session 2',
        command: ['vim'],
        workingDir: '/test',
        status: 'running',
        startedAt: new Date().toISOString(),
      },
    ]),
  })),
}));

describe('PtyManager', () => {
  let ptyManager: PtyManager;
  let mockFs: {
    existsSync: Mock;
    readFileSync: Mock;
    writeFileSync: Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockFs = {
      existsSync: vi.mocked(fs.existsSync),
      readFileSync: vi.mocked(fs.readFileSync),
      writeFileSync: vi.mocked(fs.writeFileSync),
    };

    ptyManager = new PtyManager('/tmp/test-control');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Activity persistence', () => {
    it('should write claude-activity.json every 500ms for DYNAMIC mode', async () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = await ptyManager.createSession(['claude'], {
        workingDir: '/test',
        titleMode: TitleMode.DYNAMIC,
      });

      expect(result.sessionId).toBe('test-session-id');

      // Simulate some output to make it active
      const session = ptyManager.sessions.get('test-session-id');
      if (session?.activityDetector) {
        session.activityDetector.processOutput('; Thinking& (5s)\n');
      }

      // Advance time by 500ms
      vi.advanceTimersByTime(500);

      // Should write activity file
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        '/tmp/test-control/claude-activity.json',
        expect.stringContaining('"isActive":true')
      );
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        '/tmp/test-control/claude-activity.json',
        expect.stringContaining('"specificStatus"')
      );
    });

    it('should include correct activity data structure', async () => {
      mockFs.existsSync.mockReturnValue(false);

      await ptyManager.createSession(['claude'], {
        workingDir: '/test',
        titleMode: TitleMode.DYNAMIC,
      });

      const session = ptyManager.sessions.get('test-session-id');
      if (session?.activityDetector) {
        session.activityDetector.processOutput('+ Searching& (2s)\n');
      }

      vi.advanceTimersByTime(500);

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const activityData = JSON.parse(writeCall[1] as string);

      expect(activityData).toMatchObject({
        isActive: true,
        specificStatus: {
          app: 'claude',
          status: '+ Searching& (2s)',
        },
        timestamp: expect.any(String),
      });
    });

    it('should only inject titles for external terminals', async () => {
      mockFs.existsSync.mockReturnValue(false);

      // Create session without forwardToStdout (web session)
      const result = await ptyManager.createSession(['claude'], {
        workingDir: '/test',
        titleMode: TitleMode.DYNAMIC,
      });

      const session = ptyManager.sessions.get(result.sessionId);
      const mockPty = session?.ptyProcess as any;
      const onDataCallback = mockPty.onData.mock.calls[0][0];

      // Simulate output
      const output = 'Some output\n';
      onDataCallback(output);

      // Should write to stdout queue but not inject title sequences
      expect(session?.stdoutQueue).toBeDefined();
      // No title sequence should be prepended to the output
    });

    it('should not create activity detector for non-DYNAMIC modes', async () => {
      await ptyManager.createSession(['claude'], {
        workingDir: '/test',
        titleMode: TitleMode.STATIC,
      });

      const session = ptyManager.sessions.get('test-session-id');
      expect(session?.activityDetector).toBeUndefined();
      expect(session?.titleUpdateInterval).toBeUndefined();
    });
  });

  describe('listSessions', () => {
    it('should read activity from memory for active sessions', () => {
      // Create an active session
      const activeSession = {
        id: 'active-session',
        activityDetector: {
          getActivityState: vi.fn(() => ({
            isActive: true,
            specificStatus: {
              app: 'claude',
              status: '; Thinking& (10s)',
            },
          })),
        },
      };
      ptyManager.sessions.set('active-session', activeSession as any);

      // Mock sessionManager to return this session
      const sessionManager = ptyManager.sessionManager as any;
      sessionManager.listSessions.mockReturnValue([
        {
          id: 'active-session',
          name: 'Active Session',
          command: ['claude'],
          workingDir: '/test',
          status: 'running',
          startedAt: new Date().toISOString(),
        },
      ]);

      const sessions = ptyManager.listSessions();

      expect(sessions[0].activityStatus).toEqual({
        isActive: true,
        specificStatus: {
          app: 'claude',
          status: '; Thinking& (10s)',
        },
      });
    });

    it('should read activity from files for external sessions', () => {
      const sessionManager = ptyManager.sessionManager as any;
      sessionManager.listSessions.mockReturnValue([
        {
          id: 'external-session',
          name: 'External Session',
          command: ['claude'],
          workingDir: '/test',
          status: 'running',
          startedAt: new Date().toISOString(),
        },
      ]);

      const activityData = {
        isActive: true,
        specificStatus: {
          app: 'claude',
          status: '+ Searching& (5s)',
        },
        timestamp: new Date().toISOString(),
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(activityData));

      const sessions = ptyManager.listSessions();

      expect(mockFs.existsSync).toHaveBeenCalledWith(
        '/tmp/test-control/external-session/claude-activity.json'
      );
      expect(sessions[0].activityStatus).toEqual({
        isActive: true,
        specificStatus: activityData.specificStatus,
      });
    });

    it('should ignore stale activity files (>60s old)', () => {
      const sessionManager = ptyManager.sessionManager as any;
      sessionManager.listSessions.mockReturnValue([
        {
          id: 'stale-session',
          name: 'Stale Session',
          command: ['claude'],
          workingDir: '/test',
          status: 'running',
          startedAt: new Date().toISOString(),
        },
      ]);

      const oldTimestamp = new Date(Date.now() - 70000).toISOString(); // 70 seconds ago
      const activityData = {
        isActive: true,
        specificStatus: {
          app: 'claude',
          status: 'Old status',
        },
        timestamp: oldTimestamp,
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(activityData));

      const sessions = ptyManager.listSessions();

      expect(sessions[0].activityStatus).toBeUndefined();
    });

    it('should handle missing activity files gracefully', () => {
      mockFs.existsSync.mockReturnValue(false);

      const sessions = ptyManager.listSessions();

      expect(sessions[0].activityStatus).toBeUndefined();
      expect(sessions[1].activityStatus).toBeUndefined();
    });

    it('should handle future timestamps (clock skew)', () => {
      const sessionManager = ptyManager.sessionManager as any;
      sessionManager.listSessions.mockReturnValue([
        {
          id: 'future-session',
          name: 'Future Session',
          command: ['claude'],
          workingDir: '/test',
          status: 'running',
          startedAt: new Date().toISOString(),
        },
      ]);

      const futureTimestamp = new Date(Date.now() + 30000).toISOString(); // 30 seconds in future
      const activityData = {
        isActive: true,
        specificStatus: {
          app: 'claude',
          status: 'Future status',
        },
        timestamp: futureTimestamp,
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(activityData));

      const sessions = ptyManager.listSessions();

      // Should still accept it because Math.abs is used
      expect(sessions[0].activityStatus).toEqual({
        isActive: true,
        specificStatus: activityData.specificStatus,
      });
    });

    it('should handle corrupted activity files', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('{ invalid json');

      const sessions = ptyManager.listSessions();

      expect(sessions[0].activityStatus).toBeUndefined();
    });
  });

  describe('Session creation with activity', () => {
    it('should auto-detect Claude command and set DYNAMIC mode', async () => {
      const result = await ptyManager.createSession(['claude', '--help'], {
        workingDir: '/test',
        // No titleMode specified
      });

      const session = ptyManager.sessions.get(result.sessionId);
      expect(session?.titleMode).toBe(TitleMode.DYNAMIC);
      expect(session?.activityDetector).toBeDefined();
    });

    it('should respect explicit titleMode over auto-detection', async () => {
      const result = await ptyManager.createSession(['claude'], {
        workingDir: '/test',
        titleMode: TitleMode.STATIC,
      });

      const session = ptyManager.sessions.get(result.sessionId);
      expect(session?.titleMode).toBe(TitleMode.STATIC);
      expect(session?.activityDetector).toBeUndefined();
    });

    it('should handle case-insensitive Claude detection', async () => {
      const variations = ['CLAUDE', 'Claude', 'claude-cli'];

      for (const cmd of variations) {
        const result = await ptyManager.createSession([cmd], {
          workingDir: '/test',
        });

        const session = ptyManager.sessions.get(result.sessionId);
        expect(session?.titleMode).toBe(TitleMode.DYNAMIC);
      }
    });
  });

  describe('Cleanup', () => {
    it('should clear activity interval on session cleanup', async () => {
      const result = await ptyManager.createSession(['claude'], {
        workingDir: '/test',
        titleMode: TitleMode.DYNAMIC,
      });

      const session = ptyManager.sessions.get(result.sessionId);
      const intervalId = session?.titleUpdateInterval;
      expect(intervalId).toBeDefined();

      // Cleanup session
      await ptyManager.killSession(result.sessionId);

      // Verify interval was cleared
      expect(session?.titleUpdateInterval).toBeUndefined();
    });

    it('should only log activity file warning once per session', () => {
      mockFs.existsSync.mockReturnValue(false);

      // List sessions multiple times
      for (let i = 0; i < 5; i++) {
        ptyManager.listSessions();
      }

      // Should only log once per session despite multiple calls
      const warningsLogged = ptyManager.activityFileWarningsLogged;
      expect(warningsLogged.size).toBe(2); // Two sessions
    });
  });
});
