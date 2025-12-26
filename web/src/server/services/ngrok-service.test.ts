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
    const processMock = new MockChildProcess();
    vi.mocked(spawn).mockReturnValue(processMock as unknown as ChildProcess);

    const service = new NgrokService({
      port: 4020,
      authToken: 'token-123',
      domain: 'example.ngrok.io',
      region: 'eu',
    });

    const serviceWithBinaryCheck = service as unknown as {
      checkNgrokBinary: () => Promise<string | null>;
    };
    serviceWithBinaryCheck.checkNgrokBinary = vi.fn().mockResolvedValue('/usr/bin/ngrok');

    const startPromise = service.start();

    setImmediate(() => {
      processMock.stdout.emit(
        'data',
        Buffer.from(
          `${JSON.stringify({ msg: 'started tunnel', url: 'https://example.ngrok.io' })}\n`
        )
      );
    });

    const tunnel = await startPromise;

    expect(tunnel.publicUrl).toBe('https://example.ngrok.io');
    expect(service.isActive()).toBe(true);

    const [command, args] = vi.mocked(spawn).mock.calls[0];
    expect(command).toBe('/usr/bin/ngrok');
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
});
