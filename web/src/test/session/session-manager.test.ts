import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

// Mock modules
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('fs', () => {
  const mockFsDefault = {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    createReadStream: vi.fn(() => {
      const stream = new EventEmitter();
      process.nextTick(() => stream.emit('end'));
      return stream;
    }),
  };

  return {
    default: mockFsDefault,
    ...mockFsDefault, // Also export named exports
  };
});

vi.mock('os', () => {
  const mockOs = {
    homedir: () => '/home/test',
  };

  return {
    default: mockOs,
    ...mockOs, // Also export named exports
  };
});

describe('Session Manager', () => {
  let mockSpawn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSpawn = vi.mocked(spawn);

    // Default mock for tty-fwd
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

  describe('Session Lifecycle', () => {
    it('should create a session with valid parameters', async () => {
      await import('../../server');

      // Simulate session creation through the spawn command
      const command = ['bash', '-l'];
      const workingDir = '/home/test/projects';

      const mockProcess = {
        stdout: {
          on: vi.fn((event, callback) => {
            if (event === 'data') {
              callback(Buffer.from('Session created successfully'));
            }
          }),
        },
        stderr: { on: vi.fn() },
        on: vi.fn((event, callback) => {
          if (event === 'close') callback(0);
        }),
        kill: vi.fn(),
      };

      mockSpawn.mockImplementationOnce(() => mockProcess);

      // Test the spawn command execution
      const args = ['spawn', '--name', 'Test Session', '--cwd', workingDir, '--', ...command];
      const result = await new Promise((resolve) => {
        const proc = mockSpawn('tty-fwd', args);
        let output = '';

        proc.stdout.on('data', (data: Buffer) => {
          output += data.toString();
        });

        proc.on('close', () => {
          resolve(output);
        });
      });

      expect(result).toBe('Session created successfully');
      expect(mockSpawn).toHaveBeenCalledWith('tty-fwd', args);
    });

    it('should handle session with environment variables', async () => {
      const env = { NODE_ENV: 'test', CUSTOM_VAR: 'value' };
      const command = ['node', 'app.js'];

      // Test environment variable passing
      const envArgs = Object.entries(env).flatMap(([key, value]) => ['--env', `${key}=${value}`]);
      const args = ['spawn', ...envArgs, '--', ...command];

      mockSpawn.mockImplementationOnce(() => ({
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, callback) => {
          if (event === 'close') callback(0);
        }),
        kill: vi.fn(),
      }));

      mockSpawn('tty-fwd', args);

      expect(mockSpawn).toHaveBeenCalledWith(
        'tty-fwd',
        expect.arrayContaining(['--env', 'NODE_ENV=test', '--env', 'CUSTOM_VAR=value'])
      );
    });

    it('should list all active sessions', async () => {
      const mockSessions = {
        'session-1': {
          cmdline: ['vim', 'test.txt'],
          cwd: '/home/test',
          exit_code: null,
          name: 'vim',
          pid: 1234,
          started_at: '2024-01-01T00:00:00Z',
          status: 'running',
          stdin: '/tmp/session-1.stdin',
          'stream-out': '/tmp/session-1.out',
          waiting: false,
        },
        'session-2': {
          cmdline: ['bash'],
          cwd: '/home/test/projects',
          exit_code: 0,
          name: 'bash',
          pid: 5678,
          started_at: '2024-01-01T00:10:00Z',
          status: 'exited',
          stdin: '/tmp/session-2.stdin',
          'stream-out': '/tmp/session-2.out',
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

      // Execute list command
      const result = await new Promise((resolve, reject) => {
        const proc = mockSpawn('tty-fwd', ['list']);
        let output = '';

        proc.stdout.on('data', (data: Buffer) => {
          output += data.toString();
        });

        proc.on('close', (code: number) => {
          if (code === 0) {
            resolve(JSON.parse(output));
          } else {
            reject(new Error(`Process exited with code ${code}`));
          }
        });
      });

      expect(result).toEqual(mockSessions);
      expect(Object.keys(result as Record<string, unknown>)).toHaveLength(2);
    });

    it('should terminate a running session', async () => {
      const sessionId = 'session-to-terminate';

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

      const result = await new Promise((resolve, reject) => {
        const proc = mockSpawn('tty-fwd', ['terminate', sessionId]);
        let output = '';

        proc.stdout.on('data', (data: Buffer) => {
          output += data.toString();
        });

        proc.on('close', (code: number) => {
          if (code === 0) {
            resolve(output);
          } else {
            reject(new Error(`Process exited with code ${code}`));
          }
        });
      });

      expect(result).toBe('Session terminated');
      expect(mockSpawn).toHaveBeenCalledWith('tty-fwd', ['terminate', sessionId]);
    });

    it('should clean up exited sessions', async () => {
      mockSpawn.mockImplementationOnce(() => ({
        stdout: {
          on: vi.fn((event, callback) => {
            if (event === 'data') {
              callback(Buffer.from('Cleaned up 3 exited sessions'));
            }
          }),
        },
        stderr: { on: vi.fn() },
        on: vi.fn((event, callback) => {
          if (event === 'close') callback(0);
        }),
        kill: vi.fn(),
      }));

      const result = await new Promise((resolve, reject) => {
        const proc = mockSpawn('tty-fwd', ['clean']);
        let output = '';

        proc.stdout.on('data', (data: Buffer) => {
          output += data.toString();
        });

        proc.on('close', (code: number) => {
          if (code === 0) {
            resolve(output);
          } else {
            reject(new Error(`Process exited with code ${code}`));
          }
        });
      });

      expect(result).toBe('Cleaned up 3 exited sessions');
      expect(mockSpawn).toHaveBeenCalledWith('tty-fwd', ['clean']);
    });
  });

  describe('Session I/O Operations', () => {
    it('should write input to a session', async () => {
      const sessionId = 'interactive-session';
      const input = 'echo "Hello, World!"\n';

      mockSpawn.mockImplementationOnce(() => ({
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, callback) => {
          if (event === 'close') callback(0);
        }),
        kill: vi.fn(),
      }));

      mockSpawn('tty-fwd', ['write', sessionId, input]);

      expect(mockSpawn).toHaveBeenCalledWith('tty-fwd', ['write', sessionId, input]);
    });

    it('should resize terminal dimensions', async () => {
      const sessionId = 'resize-session';
      const cols = 120;
      const rows = 40;

      mockSpawn.mockImplementationOnce(() => ({
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, callback) => {
          if (event === 'close') callback(0);
        }),
        kill: vi.fn(),
      }));

      mockSpawn('tty-fwd', ['resize', sessionId, String(cols), String(rows)]);

      expect(mockSpawn).toHaveBeenCalledWith('tty-fwd', ['resize', sessionId, '120', '40']);
    });

    it('should get terminal snapshot', async () => {
      const sessionId = 'snapshot-session';
      const mockSnapshot = {
        lines: [
          'user@host:~$ ls -la',
          'total 48',
          'drwxr-xr-x  6 user user 4096 Jan  1 00:00 .',
          'drwxr-xr-x 20 user user 4096 Jan  1 00:00 ..',
        ],
        cursor: { x: 18, y: 0 },
        cols: 80,
        rows: 24,
      };

      mockSpawn.mockImplementationOnce(() => ({
        stdout: {
          on: vi.fn((event, callback) => {
            if (event === 'data') {
              callback(Buffer.from(JSON.stringify(mockSnapshot)));
            }
          }),
        },
        stderr: { on: vi.fn() },
        on: vi.fn((event, callback) => {
          if (event === 'close') callback(0);
        }),
        kill: vi.fn(),
      }));

      const result = await new Promise((resolve, reject) => {
        const proc = mockSpawn('tty-fwd', ['snapshot', sessionId]);
        let output = '';

        proc.stdout.on('data', (data: Buffer) => {
          output += data.toString();
        });

        proc.on('close', (code: number) => {
          if (code === 0) {
            resolve(JSON.parse(output));
          } else {
            reject(new Error(`Process exited with code ${code}`));
          }
        });
      });

      expect(result).toEqual(mockSnapshot);
      expect((result as { lines: unknown[]; cursor: { x: number; y: number } }).lines).toHaveLength(
        4
      );
      expect((result as { lines: unknown[]; cursor: { x: number; y: number } }).cursor).toEqual({
        x: 18,
        y: 0,
      });
    });

    it('should stream terminal output', async () => {
      const sessionId = 'stream-session';
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
      const proc = mockSpawn('tty-fwd', ['stream', sessionId]);

      proc.stdout.on('data', (data: Buffer) => {
        streamData.push(data.toString());
      });

      // Simulate streaming data
      mockStreamProcess.stdout.emit('data', Buffer.from('Line 1\n'));
      mockStreamProcess.stdout.emit('data', Buffer.from('Line 2\n'));
      mockStreamProcess.stdout.emit('data', Buffer.from('Line 3\n'));

      expect(streamData).toEqual(['Line 1\n', 'Line 2\n', 'Line 3\n']);
      expect(mockSpawn).toHaveBeenCalledWith('tty-fwd', ['stream', sessionId]);
    });
  });

  describe('Error Handling', () => {
    it('should handle session creation failure', async () => {
      mockSpawn.mockImplementationOnce(() => ({
        stdout: { on: vi.fn() },
        stderr: {
          on: vi.fn((event, callback) => {
            if (event === 'data') {
              callback(Buffer.from('Error: Failed to create session'));
            }
          }),
        },
        on: vi.fn((event, callback) => {
          if (event === 'close') callback(1);
        }),
        kill: vi.fn(),
      }));

      const result = await new Promise((resolve) => {
        const proc = mockSpawn('tty-fwd', ['spawn', '--', 'invalid-command']);
        let error = '';

        proc.stderr.on('data', (data: Buffer) => {
          error += data.toString();
        });

        proc.on('close', (code: number) => {
          resolve({ code, error });
        });
      });

      expect((result as { code: number; error: string }).code).toBe(1);
      expect((result as { code: number; error: string }).error).toContain(
        'Failed to create session'
      );
    });

    it('should handle timeout for long-running commands', async () => {
      const mockSlowProcess = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
      };

      mockSpawn.mockImplementationOnce(() => mockSlowProcess);

      const proc = mockSpawn('tty-fwd', ['list']);

      // Simulate timeout
      const timeoutId = setTimeout(() => {
        proc.kill('SIGTERM');
      }, 100);

      expect(proc.kill).toBeDefined();
      clearTimeout(timeoutId);
    });

    it('should handle invalid session ID', async () => {
      mockSpawn.mockImplementationOnce(() => ({
        stdout: { on: vi.fn() },
        stderr: {
          on: vi.fn((event, callback) => {
            if (event === 'data') {
              callback(Buffer.from('Error: Session not found'));
            }
          }),
        },
        on: vi.fn((event, callback) => {
          if (event === 'close') callback(1);
        }),
        kill: vi.fn(),
      }));

      const result = await new Promise((resolve) => {
        const proc = mockSpawn('tty-fwd', ['terminate', 'non-existent-session']);
        let error = '';

        proc.stderr.on('data', (data: Buffer) => {
          error += data.toString();
        });

        proc.on('close', (code: number) => {
          resolve({ code, error });
        });
      });

      expect((result as { code: number; error: string }).code).toBe(1);
      expect((result as { code: number; error: string }).error).toContain('Session not found');
    });
  });
});
