import { type ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NgrokService } from './ngrok-service.js';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

class MockChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

describe('NgrokService', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts a tunnel and parses the public URL', async () => {
    const versionProcess = new MockChildProcess();
    const tunnelProcess = new MockChildProcess();
    vi.mocked(spawn)
      .mockReturnValueOnce(versionProcess as unknown as ChildProcess)
      .mockReturnValueOnce(tunnelProcess as unknown as ChildProcess);

    const service = new NgrokService({
      port: 4020,
      authToken: 'token-123',
      domain: 'example.ngrok.io',
      region: 'eu',
    });

    const startPromise = service.start();

    setImmediate(() => {
      versionProcess.emit('close', 0);
      setImmediate(() => {
        tunnelProcess.stdout.emit(
          'data',
          Buffer.from(
            `${JSON.stringify({ msg: 'started tunnel', url: 'https://example.ngrok.io' })}\n`
          )
        );
      });
    });

    const tunnel = await startPromise;

    expect(tunnel).toEqual({
      publicUrl: 'https://example.ngrok.io',
      proto: 'http',
      name: 'command_line',
      uri: 'http://localhost:4020',
    });
    expect(service.isActive()).toBe(true);

    expect(vi.mocked(spawn).mock.calls[0]).toEqual(['ngrok', ['version'], { stdio: 'ignore' }]);
    const [command, args] = vi.mocked(spawn).mock.calls[1];
    expect(command).toBe('ngrok');
    expect(args).toEqual(
      expect.arrayContaining([
        'http',
        '4020',
        '--log=stdout',
        '--log-format=json',
        '--authtoken',
        'token-123',
        '--domain',
        'example.ngrok.io',
        '--region',
        'eu',
      ])
    );
  });

  it('logs stderr without treating it as tunnel startup output', async () => {
    const versionProcess = new MockChildProcess();
    const tunnelProcess = new MockChildProcess();
    vi.mocked(spawn)
      .mockReturnValueOnce(versionProcess as unknown as ChildProcess)
      .mockReturnValueOnce(tunnelProcess as unknown as ChildProcess);

    const service = new NgrokService({ port: 4020 });
    const startPromise = service.start();
    const rejection = expect(startPromise).rejects.toThrow(
      'ngrok process exited before tunnel startup (code 1)'
    );

    setImmediate(() => {
      versionProcess.emit('close', 0);
      setImmediate(() => {
        tunnelProcess.stderr.emit(
          'data',
          Buffer.from(
            `${JSON.stringify({ msg: 'started tunnel', url: 'https://example.ngrok.io' })}\n`
          )
        );
        tunnelProcess.emit('close', 1);
      });
    });

    await rejection;
    expect(service.isActive()).toBe(false);
  });
});
