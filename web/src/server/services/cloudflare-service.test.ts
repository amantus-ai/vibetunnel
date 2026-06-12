import { type ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudflareService } from './cloudflare-service.js';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

class MockChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

describe('CloudflareService', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts a quick tunnel and returns the public URL', async () => {
    const versionProcess = new MockChildProcess();
    const tunnelProcess = new MockChildProcess();
    vi.mocked(spawn)
      .mockReturnValueOnce(versionProcess as unknown as ChildProcess)
      .mockReturnValueOnce(tunnelProcess as unknown as ChildProcess);

    const service = new CloudflareService(4020);
    const startPromise = service.start();

    setImmediate(() => {
      versionProcess.emit('close', 0);
      setImmediate(() => {
        tunnelProcess.stdout.emit('data', Buffer.from('https://example.trycloudflare.com'));
      });
    });

    const tunnel = await startPromise;

    expect(tunnel).toEqual({
      publicUrl: 'https://example.trycloudflare.com',
      proto: 'https',
      name: 'cloudflare-quick-tunnel',
      uri: 'http://localhost:4020',
    });
    expect(service.isActive()).toBe(true);

    expect(vi.mocked(spawn).mock.calls[0]).toEqual([
      'cloudflared',
      ['--version'],
      { stdio: 'ignore' },
    ]);
    const [command, args] = vi.mocked(spawn).mock.calls[1];
    expect(command).toBe('cloudflared');
    expect(args).toEqual(['tunnel', '--url', 'http://localhost:4020']);
  });
});
