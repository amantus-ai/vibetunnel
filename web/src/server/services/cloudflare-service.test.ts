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
    const processMock = new MockChildProcess();
    vi.mocked(spawn).mockReturnValue(processMock as unknown as ChildProcess);

    const service = new CloudflareService(4020);
    const serviceWithBinaryCheck = service as unknown as {
      checkCloudflaredBinary: () => Promise<string | null>;
    };
    serviceWithBinaryCheck.checkCloudflaredBinary = vi
      .fn()
      .mockResolvedValue('/usr/local/bin/cloudflared');

    const startPromise = service.start();

    setImmediate(() => {
      processMock.stdout.emit('data', Buffer.from('https://example.trycloudflare.com'));
    });

    const tunnel = await startPromise;

    expect(tunnel.publicUrl).toBe('https://example.trycloudflare.com');
    expect(service.isActive()).toBe(true);

    const [command, args] = vi.mocked(spawn).mock.calls[0];
    expect(command).toBe('/usr/local/bin/cloudflared');
    expect(args).toEqual(['tunnel', '--url', 'http://localhost:4020']);
  });
});
