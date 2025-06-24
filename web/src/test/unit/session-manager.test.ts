import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
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
    it('should write session info to file', async () => {
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

      await sessionManager.writeSessionInfo(sessionId, sessionInfo);

      // Verify file was created
      const sessionPath = path.join(testDir, sessionId, 'session.json');
      expect(fs.existsSync(sessionPath)).toBe(true);

      // Verify content
      const content = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
      expect(content).toMatchObject(sessionInfo);
    });

    it('should read session info from file', async () => {
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

      // Write session info
      await sessionManager.writeSessionInfo(sessionId, sessionInfo);

      // Read it back
      const readInfo = await sessionManager.readSessionInfo(sessionId);
      expect(readInfo).toMatchObject(sessionInfo);
    });

    it('should return null for non-existent session', async () => {
      const info = await sessionManager.readSessionInfo('nonexistent');
      expect(info).toBeNull();
    });

    it('should update existing session info', async () => {
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

      await sessionManager.writeSessionInfo(sessionId, initialInfo);

      // Update with exit status
      const updatedInfo: SessionInfo = {
        ...initialInfo,
        status: 'exited',
        exit_code: 0,
      };

      await sessionManager.writeSessionInfo(sessionId, updatedInfo);

      // Verify update
      const readInfo = await sessionManager.readSessionInfo(sessionId);
      expect(readInfo?.status).toBe('exited');
      expect(readInfo?.exit_code).toBe(0);
    });
  });

  describe('Session Discovery', () => {
    it('should list all sessions', async () => {
      // Create multiple sessions
      const sessions = [
        { id: 'session1', name: 'Session 1', status: 'running' as const },
        { id: 'session2', name: 'Session 2', status: 'running' as const },
        { id: 'session3', name: 'Session 3', status: 'exited' as const, exit_code: 0 },
      ];

      for (const session of sessions) {
        const sessionInfo: SessionInfo = {
          cmdline: ['echo', session.name],
          name: session.name,
          cwd: testDir,
          pid: Math.floor(Math.random() * 10000),
          status: session.status,
          exit_code: session.exit_code,
          started_at: new Date().toISOString(),
          term: 'xterm',
          spawn_type: 'pty',
        };
        await sessionManager.writeSessionInfo(session.id, sessionInfo);
      }

      // List sessions
      const listedSessions = await sessionManager.listSessions();

      expect(listedSessions).toHaveLength(3);
      expect(listedSessions.map((s) => s.id).sort()).toEqual(['session1', 'session2', 'session3']);

      // Verify session data
      const session1 = listedSessions.find((s) => s.id === 'session1');
      expect(session1?.name).toBe('Session 1');
      expect(session1?.status).toBe('running');
    });

    it('should handle empty directory', async () => {
      const sessions = await sessionManager.listSessions();
      expect(sessions).toEqual([]);
    });

    it('should ignore files that are not directories', async () => {
      // Create a file in the control directory
      fs.writeFileSync(path.join(testDir, 'not-a-session.txt'), 'test');

      // Create a valid session
      await sessionManager.writeSessionInfo('validsession', {
        cmdline: ['ls'],
        name: 'Valid',
        cwd: testDir,
        pid: 12345,
        status: 'running',
        started_at: new Date().toISOString(),
        term: 'xterm',
        spawn_type: 'pty',
      });

      const sessions = await sessionManager.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('validsession');
    });

    it('should handle corrupted session files gracefully', async () => {
      const sessionId = 'corrupted';
      const sessionDir = path.join(testDir, sessionId);
      fs.mkdirSync(sessionDir);

      // Write corrupted JSON
      fs.writeFileSync(path.join(sessionDir, 'session.json'), '{invalid json');

      const sessions = await sessionManager.listSessions();
      expect(sessions).toHaveLength(0);
    });
  });

  describe('Zombie Detection', () => {
    it('should identify zombie sessions', async () => {
      // Create sessions with different PIDs
      const runningPid = process.pid; // Current process PID (exists)
      const zombiePid = 99999; // Non-existent PID

      await sessionManager.writeSessionInfo('running', {
        cmdline: ['node'],
        name: 'Running',
        cwd: testDir,
        pid: runningPid,
        status: 'running',
        started_at: new Date().toISOString(),
        term: 'xterm',
        spawn_type: 'pty',
      });

      await sessionManager.writeSessionInfo('zombie', {
        cmdline: ['ghost'],
        name: 'Zombie',
        cwd: testDir,
        pid: zombiePid,
        status: 'running',
        started_at: new Date().toISOString(),
        term: 'xterm',
        spawn_type: 'pty',
      });

      await sessionManager.writeSessionInfo('exited', {
        cmdline: ['done'],
        name: 'Exited',
        cwd: testDir,
        pid: 12345,
        status: 'exited',
        exit_code: 0,
        started_at: new Date().toISOString(),
        term: 'xterm',
        spawn_type: 'pty',
      });

      // Update zombie sessions
      await sessionManager.updateZombieSessions();

      // Check results
      const sessions = await sessionManager.listSessions();

      const runningSession = sessions.find((s) => s.id === 'running');
      expect(runningSession?.status).toBe('running');

      const zombieSession = sessions.find((s) => s.id === 'zombie');
      expect(zombieSession?.status).toBe('exited');
      expect(zombieSession?.exit_code).toBe(-1);

      const exitedSession = sessions.find((s) => s.id === 'exited');
      expect(exitedSession?.status).toBe('exited');
      expect(exitedSession?.exit_code).toBe(0);
    });

    it('should handle sessions without PID', async () => {
      await sessionManager.writeSessionInfo('no-pid', {
        cmdline: ['test'],
        name: 'No PID',
        cwd: testDir,
        status: 'running',
        started_at: new Date().toISOString(),
        term: 'xterm',
        spawn_type: 'pty',
      } as SessionInfo); // Intentionally missing pid

      await sessionManager.updateZombieSessions();

      const sessions = await sessionManager.listSessions();
      const session = sessions.find((s) => s.id === 'no-pid');
      expect(session?.status).toBe('running'); // Should not be marked as zombie
    });
  });

  describe('Session Deletion', () => {
    it('should delete session directory', async () => {
      const sessionId = 'to-delete';
      await sessionManager.writeSessionInfo(sessionId, {
        cmdline: ['rm', '-rf'],
        name: 'Delete Me',
        cwd: testDir,
        pid: 12345,
        status: 'exited',
        exit_code: 0,
        started_at: new Date().toISOString(),
        term: 'xterm',
        spawn_type: 'pty',
      });

      const sessionDir = path.join(testDir, sessionId);
      expect(fs.existsSync(sessionDir)).toBe(true);

      await sessionManager.deleteSession(sessionId);

      expect(fs.existsSync(sessionDir)).toBe(false);
    });

    it('should handle non-existent session deletion gracefully', async () => {
      // Should not throw
      await expect(sessionManager.deleteSession('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('Control Files', () => {
    it('should create control files', async () => {
      const sessionId = 'control-test';

      await sessionManager.createControlFiles(sessionId);

      const sessionDir = path.join(testDir, sessionId);
      expect(fs.existsSync(path.join(sessionDir, 'stdin'))).toBe(true);
      expect(fs.existsSync(path.join(sessionDir, 'control'))).toBe(true);
      expect(fs.existsSync(path.join(sessionDir, 'stream-out'))).toBe(true);
    });

    it('should create nested directories if needed', async () => {
      const sessionId = 'nested/session/id';

      await sessionManager.createControlFiles(sessionId);

      const sessionDir = path.join(testDir, sessionId);
      expect(fs.existsSync(sessionDir)).toBe(true);
      expect(fs.existsSync(path.join(sessionDir, 'stdin'))).toBe(true);
    });
  });
});
