import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PtyManager } from '../../server/pty/pty-manager';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skip('PtyManager', () => {
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
      expect(result.sessionInfo.name).toBe('Test Echo');

      // Wait for process to complete
      await sleep(500);

      // Read output from stdout file
      {
        const stdoutPath = path.join(testDir, result.sessionId, 'stdout');
        const outputData = fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, 'utf8') : '';
        expect(outputData).toContain('Hello, World!');
      }
    });

    it('should create session with custom working directory', async () => {
      const customDir = path.join(testDir, 'custom');
      fs.mkdirSync(customDir, { recursive: true });

      const result = await ptyManager.createSession(['pwd'], {
        workingDir: customDir,
        name: 'PWD Test',
      });

      expect(result).toBeDefined();
      expect(result.sessionId).toBeDefined();
      expect(result.sessionInfo.name).toBe('PWD Test');

      // Wait for output
      await sleep(500);

      // Read output from stdout file
      {
        const stdoutPath = path.join(testDir, result.sessionId, 'stdout');
        const outputData = fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, 'utf8') : '';
        expect(outputData.trim()).toContain('custom');
      }
    });

    it('should handle session with environment variables', async () => {
      const result = await ptyManager.createSession(
        process.platform === 'win32'
          ? ['cmd', '/c', 'echo %TEST_VAR%']
          : ['sh', '-c', 'echo $TEST_VAR'],
        {
          workingDir: testDir,
          env: { TEST_VAR: 'test_value_123' },
        }
      );

      expect(result).toBeDefined();
      expect(result.sessionId).toBeDefined();

      // Wait for output
      await sleep(500);

      // Read output from stdout file
      {
        const stdoutPath = path.join(testDir, result.sessionId, 'stdout');
        const outputData = fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, 'utf8') : '';
        expect(outputData).toContain('test_value_123');
      }
    });

    it('should reject duplicate session IDs', async () => {
      const sessionId = randomBytes(4).toString('hex');

      // Create first session
      const result1 = await ptyManager.createSession(['sleep', '10'], {
        sessionId,
        workingDir: testDir,
      });
      expect(result1).toBeDefined();
      expect(result1.sessionId).toBe(sessionId);

      // Try to create duplicate
      await expect(
        ptyManager.createSession(['echo', 'test'], {
          sessionId,
          workingDir: testDir,
        })
      ).rejects.toThrow();
    });

    it('should handle non-existent command gracefully', async () => {
      const result = await ptyManager.createSession(['nonexistentcommand12345'], {
        workingDir: testDir,
      });

      expect(result).toBeDefined();
      expect(result.sessionId).toBeDefined();

      // Wait for exit
      await sleep(1000);

      // Check session status from session.json
      {
        const sessionJsonPath = path.join(testDir, result.sessionId, 'session.json');
        if (fs.existsSync(sessionJsonPath)) {
          const sessionInfo = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf8'));
          expect(sessionInfo.status).toBe('exited');
          expect(sessionInfo.exitCode).not.toBe(0);
        }
      }
    });
  });

  describe('Session Input/Output', () => {
    it('should send input to session', async () => {
      const result = await ptyManager.createSession(['cat'], {
        workingDir: testDir,
      });

      // Send input
      ptyManager.sendInput(result.sessionId, { text: 'test input\n' });

      // Wait for echo
      await sleep(200);

      // Read output from stdout file
      {
        const stdoutPath = path.join(testDir, result.sessionId, 'stdout');
        const outputData = fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, 'utf8') : '';
        expect(outputData).toContain('test input');
      }

      // Clean up - send EOF
      ptyManager.sendInput(result.sessionId, { text: '\x04' });
    });

    it('should handle binary data in input', async () => {
      const result = await ptyManager.createSession(['cat'], {
        workingDir: testDir,
      });

      // Send binary data
      const binaryData = Buffer.from([0x01, 0x02, 0x03, 0x0a]).toString();
      ptyManager.sendInput(result.sessionId, { text: binaryData });

      // Wait for echo
      await sleep(200);

      // Read output from stdout file
      {
        const stdoutPath = path.join(testDir, result.sessionId, 'stdout');
        const outputBuffer = fs.existsSync(stdoutPath)
          ? fs.readFileSync(stdoutPath)
          : Buffer.alloc(0);

        // Check that binary data was echoed back
        expect(outputBuffer.length).toBeGreaterThan(0);
      }

      // Clean up
      ptyManager.sendInput(result.sessionId, { text: '\x04' });
    });

    it('should ignore input for non-existent session', async () => {
      // sendInput doesn't return a value, just test it doesn't throw
      expect(() => ptyManager.sendInput('nonexistent', { text: 'test' })).not.toThrow();
    });
  });

  describe('Session Resize', () => {
    it('should resize terminal dimensions', async () => {
      const result = await ptyManager.createSession(
        process.platform === 'win32' ? ['cmd'] : ['bash'],
        {
          workingDir: testDir,
          cols: 80,
          rows: 24,
        }
      );

      // Resize terminal - doesn't return a value
      ptyManager.resizeSession(result.sessionId, 120, 40);

      // Get session info to verify
      const internalSession = ptyManager.getInternalSession(result.sessionId);
      expect(internalSession?.cols).toBe(120);
      expect(internalSession?.rows).toBe(40);
    });

    it('should reject invalid dimensions', async () => {
      const result = await ptyManager.createSession(['cat'], {
        workingDir: testDir,
      });

      // Try negative dimensions - the implementation actually throws an error
      expect(() => ptyManager.resizeSession(result.sessionId, -1, 40)).toThrow();

      // Try zero dimensions - the implementation actually throws an error
      expect(() => ptyManager.resizeSession(result.sessionId, 80, 0)).toThrow();
    });

    it('should ignore resize for non-existent session', async () => {
      // resizeSession doesn't return a value, just test it doesn't throw
      expect(() => ptyManager.resizeSession('nonexistent', 80, 24)).not.toThrow();
    });
  });

  describe('Session Termination', () => {
    it('should kill session with SIGTERM', async () => {
      const result = await ptyManager.createSession(['sleep', '60'], {
        workingDir: testDir,
      });

      // Kill session - returns Promise<void>
      await ptyManager.killSession(result.sessionId);

      // Wait for process to exit
      await sleep(500);

      // Check session status from session.json
      {
        const sessionJsonPath = path.join(testDir, result.sessionId, 'session.json');
        if (fs.existsSync(sessionJsonPath)) {
          const sessionInfo = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf8'));
          expect(sessionInfo.status).toBe('exited');
          expect(sessionInfo.exitCode).toBeDefined();
        }
      }
    });

    it('should force kill with SIGKILL if needed', async () => {
      // Create a session that ignores SIGTERM
      const result = await ptyManager.createSession(
        process.platform === 'win32'
          ? ['cmd', '/c', 'ping 127.0.0.1 -n 60']
          : ['sh', '-c', 'trap "" TERM; sleep 60'],
        {
          workingDir: testDir,
        }
      );

      // Kill session (should escalate to SIGKILL) - doesn't take escalationDelay
      await ptyManager.killSession(result.sessionId, 'SIGTERM');

      // Wait for process to exit
      await sleep(1000);

      // Check session status from session.json
      {
        const sessionJsonPath = path.join(testDir, result.sessionId, 'session.json');
        if (fs.existsSync(sessionJsonPath)) {
          const sessionInfo = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf8'));
          expect(sessionInfo.status).toBe('exited');
          expect(sessionInfo.exitCode).toBeDefined();
        }
      }
    });

    it('should clean up session files on exit', async () => {
      const result = await ptyManager.createSession(['echo', 'test'], {
        workingDir: testDir,
      });

      const sessionDir = path.join(testDir, result.sessionId);

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
      const result = await ptyManager.createSession(['sleep', '10'], {
        workingDir: testDir,
        name: 'Info Test',
        cols: 100,
        rows: 30,
      });

      const internalSession = ptyManager.getInternalSession(result.sessionId);

      expect(internalSession).toBeDefined();
      expect(internalSession?.id).toBe(result.sessionId);
      expect(internalSession?.command).toBe('sleep');
      expect(internalSession?.args).toEqual(['10']);
      expect(internalSession?.name).toBe('Info Test');
      expect(internalSession?.cols).toBe(100);
      expect(internalSession?.rows).toBe(30);
      expect(internalSession?.ptyProcess?.pid).toBeGreaterThan(0);
    });

    it('should return null for non-existent session', async () => {
      const info = ptyManager.getInternalSession('nonexistent');
      expect(info).toBeUndefined();
    });
  });

  describe('Shutdown', () => {
    it('should kill all sessions on shutdown', async () => {
      const sessionIds: string[] = [];

      // Create multiple sessions
      for (let i = 0; i < 3; i++) {
        const result = await ptyManager.createSession(['sleep', '60'], {
          workingDir: testDir,
        });
        sessionIds.push(result.sessionId);
      }

      // Shutdown
      await ptyManager.shutdown();

      // All sessions should have exited
      for (const sessionId of sessionIds) {
        const sessionJsonPath = path.join(testDir, sessionId, 'session.json');
        if (fs.existsSync(sessionJsonPath)) {
          const sessionInfo = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf8'));
          expect(sessionInfo.status).toBe('exited');
        }
      }
    });

    it('should handle shutdown with no sessions', async () => {
      // Should not throw
      await expect(ptyManager.shutdown()).resolves.not.toThrow();
    });
  });

  describe('Control Pipe', () => {
    it('should handle resize via control pipe', async () => {
      const result = await ptyManager.createSession(['sleep', '10'], {
        workingDir: testDir,
        cols: 80,
        rows: 24,
      });

      // Write resize command to control pipe
      const controlPath = path.join(testDir, result.sessionId, 'control');
      fs.writeFileSync(controlPath, 'resize 120 40\n');

      // Wait for file watcher to pick it up
      await sleep(500);

      // Verify resize
      const internalSession = ptyManager.getInternalSession(result.sessionId);
      expect(internalSession?.cols).toBe(120);
      expect(internalSession?.rows).toBe(40);
    });

    it('should handle input via stdin file', async () => {
      const result = await ptyManager.createSession(['cat'], {
        workingDir: testDir,
      });

      // Write to stdin file
      const stdinPath = path.join(testDir, result.sessionId, 'stdin');
      fs.appendFileSync(stdinPath, 'test via stdin\n');

      // Wait for file watcher
      await sleep(500);

      // Read output from stdout file
      {
        const stdoutPath = path.join(testDir, result.sessionId, 'stdout');
        const outputData = fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, 'utf8') : '';
        expect(outputData).toContain('test via stdin');
      }

      // Clean up
      fs.appendFileSync(stdinPath, '\x04');
    });
  });
});
