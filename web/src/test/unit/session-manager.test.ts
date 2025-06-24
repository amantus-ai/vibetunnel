import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SessionManager } from '../../server/pty/session-manager';
import type { SessionInfo } from '../../server/types';

describe('SessionManager', () => {
  let sessionManager: SessionManager;
  let testDir: string;

  beforeAll(() => {
    // Create a test directory for control files
    testDir = path.join(os.tmpdir(), 'session-manager-test', Date.now().toString());
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    // Clean up test directory
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch (e) {
      console.error('Failed to clean test directory:', e);
    }
  });

  beforeEach(() => {
    sessionManager = new SessionManager(testDir);
  });

  afterEach(() => {
    // Clean up any created session directories
    const entries = fs.readdirSync(testDir);
    for (const entry of entries) {
      const entryPath = path.join(testDir, entry);
      if (fs.statSync(entryPath).isDirectory()) {
        fs.rmSync(entryPath, { recursive: true, force: true });
      }
    }
  });

  describe('Session Persistence', () => {
    it('should save session info to file', () => {
      const sessionId = 'test123';
      const sessionInfo: SessionInfo = {
        cmdline: ['echo', 'test'],
        name: 'Test Session',
        cwd: testDir,
        pid: 12345,
        status: 'running',
        started_at: new Date().toISOString(),
        term: 'xterm-256color',
        spawn_type: 'pty',
      };

      // Create session directory first
      sessionManager.createSessionDirectory(sessionId);

      // Save session info
      sessionManager.saveSessionInfo(sessionId, sessionInfo);

      // Verify file was created
      const sessionPath = path.join(testDir, sessionId, 'session.json');
      expect(fs.existsSync(sessionPath)).toBe(true);

      // Verify content
      const content = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
      expect(content).toMatchObject(sessionInfo);
    });

    it('should load session info from file', () => {
      const sessionId = 'test456';
      const sessionInfo: SessionInfo = {
        cmdline: ['bash', '-l'],
        name: 'Bash Session',
        cwd: '/home/user',
        pid: 54321,
        status: 'running',
        started_at: new Date().toISOString(),
        term: 'xterm',
        spawn_type: 'pty',
      };

      // Create session directory and save info
      sessionManager.createSessionDirectory(sessionId);
      sessionManager.saveSessionInfo(sessionId, sessionInfo);

      // Read it back
      const readInfo = sessionManager.loadSessionInfo(sessionId);
      expect(readInfo).toMatchObject(sessionInfo);
    });

    it('should return null for non-existent session', () => {
      const info = sessionManager.loadSessionInfo('nonexistent');
      expect(info).toBeNull();
    });

    it('should update existing session status', () => {
      const sessionId = 'test789';
      const initialInfo: SessionInfo = {
        cmdline: ['vim'],
        name: 'Editor',
        cwd: testDir,
        pid: 11111,
        status: 'running',
        started_at: new Date().toISOString(),
        term: 'xterm',
        spawn_type: 'pty',
      };

      // Create session directory and save initial info
      sessionManager.createSessionDirectory(sessionId);
      sessionManager.saveSessionInfo(sessionId, initialInfo);

      // Update session status
      sessionManager.updateSessionStatus(sessionId, 'exited', undefined, 0);

      // Verify update
      const readInfo = sessionManager.loadSessionInfo(sessionId);
      expect(readInfo?.status).toBe('exited');
      expect(readInfo?.exitCode).toBe(0);
    });
  });

  describe('Session Discovery', () => {
    it('should list all sessions', () => {
      // Create multiple sessions
      const sessions = [
        { id: 'session1', name: 'Session 1', status: 'running' as const },
        { id: 'session2', name: 'Session 2', status: 'running' as const },
        { id: 'session3', name: 'Session 3', status: 'exited' as const, exitCode: 0 },
      ];

      for (const session of sessions) {
        const sessionInfo: SessionInfo = {
          cmdline: ['echo', session.name],
          name: session.name,
          cwd: testDir,
          pid: Math.floor(Math.random() * 10000),
          status: session.status,
          exitCode: session.exitCode,
          started_at: new Date().toISOString(),
          term: 'xterm',
          spawn_type: 'pty',
        };
        sessionManager.createSessionDirectory(session.id);
        sessionManager.saveSessionInfo(session.id, sessionInfo);
      }

      // List sessions
      const listedSessions = sessionManager.listSessions();

      expect(listedSessions).toHaveLength(3);
      expect(listedSessions.map((s) => s.id).sort()).toEqual(['session1', 'session2', 'session3']);

      // Verify session data
      const session1 = listedSessions.find((s) => s.id === 'session1');
      expect(session1?.name).toBe('Session 1');
      expect(session1?.status).toBe('exited'); // Process is not actually running
    });

    it('should handle empty directory', () => {
      const sessions = sessionManager.listSessions();
      expect(sessions).toEqual([]);
    });

    it('should ignore files that are not directories', () => {
      // Create a file in the control directory
      fs.writeFileSync(path.join(testDir, 'not-a-session.txt'), 'test');

      // Create a valid session
      sessionManager.createSessionDirectory('validsession');
      sessionManager.saveSessionInfo('validsession', {
        cmdline: ['ls'],
        name: 'Valid',
        cwd: testDir,
        pid: 12345,
        status: 'running',
        started_at: new Date().toISOString(),
        term: 'xterm',
        spawn_type: 'pty',
      });

      const sessions = sessionManager.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('validsession');
    });

    it('should handle corrupted session files gracefully', () => {
      const sessionId = 'corrupted';
      const sessionDir = path.join(testDir, sessionId);
      fs.mkdirSync(sessionDir);

      // Write corrupted JSON
      fs.writeFileSync(path.join(sessionDir, 'session.json'), '{invalid json');

      const sessions = sessionManager.listSessions();
      expect(sessions).toHaveLength(0);
    });
  });

  describe('Zombie Detection', () => {
    it('should identify zombie sessions', () => {
      // Create sessions with different PIDs
      const runningPid = process.pid; // Current process PID (exists)
      const zombiePid = 99999; // Non-existent PID

      sessionManager.createSessionDirectory('running');
      sessionManager.saveSessionInfo('running', {
        cmdline: ['node'],
        name: 'Running',
        cwd: testDir,
        pid: runningPid,
        status: 'running',
        started_at: new Date().toISOString(),
        term: 'xterm',
        spawn_type: 'pty',
      });

      sessionManager.createSessionDirectory('zombie');
      sessionManager.saveSessionInfo('zombie', {
        cmdline: ['ghost'],
        name: 'Zombie',
        cwd: testDir,
        pid: zombiePid,
        status: 'running',
        started_at: new Date().toISOString(),
        term: 'xterm',
        spawn_type: 'pty',
      });

      sessionManager.createSessionDirectory('exited');
      sessionManager.saveSessionInfo('exited', {
        cmdline: ['done'],
        name: 'Exited',
        cwd: testDir,
        pid: 12345,
        status: 'exited',
        exitCode: 0,
        started_at: new Date().toISOString(),
        term: 'xterm',
        spawn_type: 'pty',
      });

      // Update zombie sessions
      sessionManager.updateZombieSessions();

      // Check results
      const sessions = sessionManager.listSessions();

      const runningSession = sessions.find((s) => s.id === 'running');
      expect(runningSession?.status).toBe('running');

      const zombieSession = sessions.find((s) => s.id === 'zombie');
      expect(zombieSession?.status).toBe('exited');
      expect(zombieSession?.exitCode).toBe(1);

      const exitedSession = sessions.find((s) => s.id === 'exited');
      expect(exitedSession?.status).toBe('exited');
      expect(exitedSession?.exitCode).toBe(0);
    });

    it('should handle sessions without PID', () => {
      sessionManager.createSessionDirectory('no-pid');
      sessionManager.saveSessionInfo('no-pid', {
        cmdline: ['test'],
        name: 'No PID',
        cwd: testDir,
        status: 'running',
        started_at: new Date().toISOString(),
        term: 'xterm',
        spawn_type: 'pty',
      } as SessionInfo); // Intentionally missing pid

      sessionManager.updateZombieSessions();

      const sessions = sessionManager.listSessions();
      const session = sessions.find((s) => s.id === 'no-pid');
      expect(session?.status).toBe('running'); // Should not be marked as zombie
    });
  });

  describe('Session Cleanup', () => {
    it('should cleanup session directory', () => {
      const sessionId = 'to-delete';
      sessionManager.createSessionDirectory(sessionId);
      sessionManager.saveSessionInfo(sessionId, {
        cmdline: ['rm', '-rf'],
        name: 'Clean Me',
        cwd: testDir,
        pid: 12345,
        status: 'exited',
        exitCode: 0,
        started_at: new Date().toISOString(),
        term: 'xterm',
        spawn_type: 'pty',
      });

      const sessionDir = path.join(testDir, sessionId);
      expect(fs.existsSync(sessionDir)).toBe(true);

      sessionManager.cleanupSession(sessionId);

      expect(fs.existsSync(sessionDir)).toBe(false);
    });

    it('should handle non-existent session cleanup gracefully', () => {
      // Should not throw
      expect(() => sessionManager.cleanupSession('nonexistent')).not.toThrow();
    });
  });

  describe('Control Files', () => {
    it('should create control files via createSessionDirectory', () => {
      const sessionId = 'control-test';

      const paths = sessionManager.createSessionDirectory(sessionId);

      expect(fs.existsSync(paths.controlDir)).toBe(true);
      expect(fs.existsSync(paths.stdinPath)).toBe(true);
      // stdout and control files are created by the PTY process, not by createSessionDirectory
    });

    it('should check if session exists', () => {
      const sessionId = 'exists-test';

      // Session doesn't exist yet
      expect(sessionManager.sessionExists(sessionId)).toBe(false);

      // Create session
      sessionManager.createSessionDirectory(sessionId);
      sessionManager.saveSessionInfo(sessionId, {
        cmdline: ['test'],
        name: 'Test',
        cwd: testDir,
        pid: 12345,
        status: 'running',
        started_at: new Date().toISOString(),
        term: 'xterm',
        spawn_type: 'pty',
      });

      // Now it exists
      expect(sessionManager.sessionExists(sessionId)).toBe(true);
    });
  });
});
