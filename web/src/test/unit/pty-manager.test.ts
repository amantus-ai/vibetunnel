import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { PtyManager } from '../../server/pty/pty-manager';
import { randomBytes } from 'crypto';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('PtyManager', () => {
  let ptyManager: PtyManager;
  let testDir: string;

  beforeAll(() => {
    // Create a test directory for control files
    testDir = path.join(os.tmpdir(), 'pty-manager-test', Date.now().toString());
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
    ptyManager = new PtyManager(testDir);
  });

  afterEach(async () => {
    // Ensure all sessions are cleaned up
    await ptyManager.shutdown();
  });

  describe('Session Creation', () => {
    it('should create a simple echo session', async () => {
      const result = await ptyManager.createSession(['echo', 'Hello, World!'], {
        workingDir: testDir,
        name: 'Test Echo',
      });

      expect(result).toBeDefined();
      expect(result.sessionId).toBeDefined();
      expect(result.sessionInfo).toBeDefined();

      // Wait for process to complete
      await sleep(500);

      expect(outputData).toContain('Hello, World!');
      expect(exitCode).toBe(0);
    });

    it('should create session with custom working directory', async () => {
      const sessionId = randomBytes(4).toString('hex');
      const customDir = path.join(testDir, 'custom');
      fs.mkdirSync(customDir, { recursive: true });

      const outputData = '';

      const result = await ptyManager.createSession(['pwd'], {
        sessionId,
        workingDir: customDir,
        name: 'PWD Test',
      });

      expect(result).toBeDefined();
      expect(result.sessionId).toBe(sessionId);

      // Wait for output
      await sleep(500);

      expect(outputData.trim()).toContain('custom');
    });

    it('should handle session with environment variables', async () => {
      const _sessionId = randomBytes(4).toString('hex');
      let outputData = '';

      const _result = await ptyManager.createSession(
        process.platform === 'win32'
          ? ['cmd', '/c', 'echo %TEST_VAR%']
          : ['sh', '-c', 'echo $TEST_VAR'],
        {
          cwd: testDir,
          env: { TEST_VAR: 'test_value_123' },
          onData: (data) => {
            outputData += data;
          },
        }
      );

      expect(success).toBe(true);

      // Wait for output
      await sleep(500);

      expect(outputData).toContain('test_value_123');
    });

    it('should reject duplicate session IDs', async () => {
      const sessionId = randomBytes(4).toString('hex');

      // Create first session
      const success1 = await ptyManager.createSession({
        sessionId,
        command: 'sleep',
        args: ['10'],
        cwd: testDir,
      });
      expect(success1).toBe(true);

      // Try to create duplicate
      const success2 = await ptyManager.createSession({
        sessionId,
        command: 'echo',
        args: ['test'],
        cwd: testDir,
      });
      expect(success2).toBe(false);
    });

    it('should handle non-existent command gracefully', async () => {
      const sessionId = randomBytes(4).toString('hex');
      let exitCode: number | null = null;

      const success = await ptyManager.createSession({
        sessionId,
        command: 'nonexistentcommand12345',
        args: [],
        cwd: testDir,
        onExit: (code) => {
          exitCode = code;
        },
      });

      expect(success).toBe(true);

      // Wait for exit
      await sleep(1000);

      // Should exit with non-zero code
      expect(exitCode).not.toBe(0);
      expect(exitCode).not.toBe(null);
    });
  });

  describe('Session Input/Output', () => {
    it('should send input to session', async () => {
      const sessionId = randomBytes(4).toString('hex');
      let outputData = '';

      await ptyManager.createSession({
        sessionId,
        command: 'cat',
        args: [],
        cwd: testDir,
        onData: (data) => {
          outputData += data;
        },
      });

      // Send input
      await ptyManager.sendInput(sessionId, 'test input\n');

      // Wait for echo
      await sleep(200);

      expect(outputData).toContain('test input');

      // Clean up - send EOF
      await ptyManager.sendInput(sessionId, '\x04');
    });

    it('should handle binary data in input', async () => {
      const sessionId = randomBytes(4).toString('hex');

      await ptyManager.createSession({
        sessionId,
        command: 'cat',
        args: [],
        cwd: testDir,
        onData: (_data) => {
          // Not used in this test
        },
      });

      // Send binary data
      const binaryData = Buffer.from([0x01, 0x02, 0x03, 0x0a]).toString();
      await ptyManager.sendInput(sessionId, binaryData);

      // Wait for echo
      await sleep(200);

      // Clean up
      await ptyManager.sendInput(sessionId, '\x04');
    });

    it('should ignore input for non-existent session', async () => {
      const result = await ptyManager.sendInput('nonexistent', 'test');
      expect(result).toBe(false);
    });
  });

  describe('Session Resize', () => {
    it('should resize terminal dimensions', async () => {
      const sessionId = randomBytes(4).toString('hex');

      await ptyManager.createSession({
        sessionId,
        command: process.platform === 'win32' ? 'cmd' : 'bash',
        args: [],
        cwd: testDir,
        cols: 80,
        rows: 24,
      });

      // Resize terminal
      const resized = await ptyManager.resizeSession(sessionId, 120, 40);
      expect(resized).toBe(true);

      // Get session info to verify
      const sessionInfo = await ptyManager.getSessionInfo(sessionId);
      expect(sessionInfo?.cols).toBe(120);
      expect(sessionInfo?.rows).toBe(40);
    });

    it('should reject invalid dimensions', async () => {
      const sessionId = randomBytes(4).toString('hex');

      await ptyManager.createSession({
        sessionId,
        command: 'cat',
        args: [],
        cwd: testDir,
      });

      // Try negative dimensions
      const resized1 = await ptyManager.resizeSession(sessionId, -1, 40);
      expect(resized1).toBe(false);

      // Try zero dimensions
      const resized2 = await ptyManager.resizeSession(sessionId, 80, 0);
      expect(resized2).toBe(false);
    });

    it('should ignore resize for non-existent session', async () => {
      const resized = await ptyManager.resizeSession('nonexistent', 80, 24);
      expect(resized).toBe(false);
    });
  });

  describe('Session Termination', () => {
    it('should kill session with SIGTERM', async () => {
      const sessionId = randomBytes(4).toString('hex');
      let exitCode: number | null = null;

      await ptyManager.createSession({
        sessionId,
        command: 'sleep',
        args: ['60'],
        cwd: testDir,
        onExit: (code) => {
          exitCode = code;
        },
      });

      // Kill session
      const killed = await ptyManager.killSession(sessionId);
      expect(killed).toBe(true);

      // Wait for process to exit
      await sleep(500);

      // Should have exited
      expect(exitCode).not.toBe(null);
    });

    it('should force kill with SIGKILL if needed', async () => {
      const sessionId = randomBytes(4).toString('hex');
      let exitCode: number | null = null;

      // Create a session that ignores SIGTERM
      await ptyManager.createSession({
        sessionId,
        command: process.platform === 'win32' ? 'cmd' : 'sh',
        args:
          process.platform === 'win32'
            ? ['/c', 'ping 127.0.0.1 -n 60']
            : ['-c', 'trap "" TERM; sleep 60'],
        cwd: testDir,
        onExit: (code) => {
          exitCode = code;
        },
      });

      // Kill session (should escalate to SIGKILL)
      const killed = await ptyManager.killSession(sessionId, { escalationDelay: 100 });
      expect(killed).toBe(true);

      // Wait for process to exit
      await sleep(1000);

      // Should have been force killed
      expect(exitCode).not.toBe(null);
    });

    it('should clean up session files on exit', async () => {
      const sessionId = randomBytes(4).toString('hex');
      const sessionDir = path.join(testDir, sessionId);

      await ptyManager.createSession({
        sessionId,
        command: 'echo',
        args: ['test'],
        cwd: testDir,
      });

      // Verify session directory exists
      expect(fs.existsSync(sessionDir)).toBe(true);

      // Wait for natural exit
      await sleep(500);

      // Session directory should still exist (not auto-cleaned)
      expect(fs.existsSync(sessionDir)).toBe(true);
    });
  });

  describe('Session Information', () => {
    it('should get session info', async () => {
      const sessionId = randomBytes(4).toString('hex');

      await ptyManager.createSession({
        sessionId,
        command: 'sleep',
        args: ['10'],
        cwd: testDir,
        name: 'Info Test',
        cols: 100,
        rows: 30,
      });

      const info = await ptyManager.getSessionInfo(sessionId);

      expect(info).toBeDefined();
      expect(info?.sessionId).toBe(sessionId);
      expect(info?.command).toBe('sleep');
      expect(info?.args).toEqual(['10']);
      expect(info?.name).toBe('Info Test');
      expect(info?.cols).toBe(100);
      expect(info?.rows).toBe(30);
      expect(info?.pid).toBeGreaterThan(0);
    });

    it('should return null for non-existent session', async () => {
      const info = await ptyManager.getSessionInfo('nonexistent');
      expect(info).toBeNull();
    });
  });

  describe('Shutdown', () => {
    it('should kill all sessions on shutdown', async () => {
      const exitCodes: Record<string, number | null> = {};

      // Create multiple sessions
      for (let i = 0; i < 3; i++) {
        const sessionId = `session${i}`;
        exitCodes[sessionId] = null;

        await ptyManager.createSession({
          sessionId,
          command: 'sleep',
          args: ['60'],
          cwd: testDir,
          onExit: (code) => {
            exitCodes[sessionId] = code;
          },
        });
      }

      // Shutdown
      await ptyManager.shutdown();

      // All sessions should have exited
      for (const sessionId in exitCodes) {
        expect(exitCodes[sessionId]).not.toBe(null);
      }
    });

    it('should handle shutdown with no sessions', async () => {
      // Should not throw
      await expect(ptyManager.shutdown()).resolves.not.toThrow();
    });
  });

  describe('Control Pipe', () => {
    it('should handle resize via control pipe', async () => {
      const sessionId = randomBytes(4).toString('hex');

      await ptyManager.createSession({
        sessionId,
        command: 'sleep',
        args: ['10'],
        cwd: testDir,
        cols: 80,
        rows: 24,
      });

      // Write resize command to control pipe
      const controlPath = path.join(testDir, sessionId, 'control');
      fs.writeFileSync(controlPath, 'resize 120 40\n');

      // Wait for file watcher to pick it up
      await sleep(500);

      // Verify resize
      const info = await ptyManager.getSessionInfo(sessionId);
      expect(info?.cols).toBe(120);
      expect(info?.rows).toBe(40);
    });

    it('should handle input via stdin file', async () => {
      const sessionId = randomBytes(4).toString('hex');
      let outputData = '';

      await ptyManager.createSession({
        sessionId,
        command: 'cat',
        args: [],
        cwd: testDir,
        onData: (data) => {
          outputData += data;
        },
      });

      // Write to stdin file
      const stdinPath = path.join(testDir, sessionId, 'stdin');
      fs.appendFileSync(stdinPath, 'test via stdin\n');

      // Wait for file watcher
      await sleep(500);

      expect(outputData).toContain('test via stdin');

      // Clean up
      fs.appendFileSync(stdinPath, '\x04');
    });
  });
});
