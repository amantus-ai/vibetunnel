import { type ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type TunnelInfo,
  type TunnelOutputSource,
  TunnelServiceBase,
} from './tunnel-service-base.js';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

class MockChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

class TestTunnelService extends TunnelServiceBase {
  constructor() {
    super('test-tunnel-service', 4020, { shutdownTimeoutMs: 10 });
  }

  protected getServiceName(): string {
    return 'Test';
  }

  protected getProcessName(): string {
    return 'test-tunnel';
  }

  protected getBinaryPaths(): string[] {
    return ['missing-tunnel', 'test-tunnel'];
  }

  protected getBinaryVersionArgs(): string[] {
    return ['--version'];
  }

  protected getBinaryNotFoundMessage(): string {
    return 'test tunnel is not installed';
  }

  protected getStartupTimeoutMessage(): string {
    return 'test tunnel startup timeout';
  }

  protected buildStartArgs(): string[] {
    return ['serve', '4020'];
  }

  protected parseOutput(output: string, _source: TunnelOutputSource): string | null {
    return output.match(/https:\/\/\S+/)?.[0] ?? null;
  }

  protected createTunnelInfo(publicUrl: string): TunnelInfo {
    return {
      publicUrl,
      proto: 'https',
      name: 'test',
      uri: 'http://localhost:4020',
    };
  }
}

describe('TunnelServiceBase', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('searches binary paths, starts once, and reuses the active tunnel', async () => {
    const missingProcess = new MockChildProcess();
    const versionProcess = new MockChildProcess();
    const tunnelProcess = new MockChildProcess();
    vi.mocked(spawn)
      .mockReturnValueOnce(missingProcess as unknown as ChildProcess)
      .mockReturnValueOnce(versionProcess as unknown as ChildProcess)
      .mockReturnValueOnce(tunnelProcess as unknown as ChildProcess);

    const service = new TestTunnelService();
    const startPromise = service.start();

    setImmediate(() => {
      missingProcess.emit('error', new Error('not found'));
      setImmediate(() => {
        versionProcess.emit('close', 0);
        setImmediate(() => {
          tunnelProcess.stdout.emit('data', Buffer.from('ready https://example.test'));
        });
      });
    });

    const tunnel = await startPromise;
    expect(tunnel.publicUrl).toBe('https://example.test');
    await expect(service.start()).resolves.toBe(tunnel);
    expect(spawn).toHaveBeenCalledTimes(3);
  });

  it('stops gracefully and clears tunnel state', async () => {
    const versionProcess = new MockChildProcess();
    const tunnelProcess = new MockChildProcess();
    vi.mocked(spawn)
      .mockReturnValueOnce(versionProcess as unknown as ChildProcess)
      .mockReturnValueOnce(tunnelProcess as unknown as ChildProcess);

    const service = new TestTunnelService();
    const startPromise = service.start();
    setImmediate(() => {
      versionProcess.emit('close', 0);
      setImmediate(() => {
        tunnelProcess.stdout.emit('data', Buffer.from('https://example.test'));
      });
    });
    await startPromise;

    const stopPromise = service.stop();
    expect(tunnelProcess.kill).toHaveBeenCalledWith('SIGTERM');
    tunnelProcess.emit('close', 0);
    await stopPromise;

    expect(service.isActive()).toBe(false);
    expect(service.getTunnel()).toBeNull();
    expect(service.getPublicUrl()).toBeNull();
  });

  it('forces shutdown when the process does not close', async () => {
    const versionProcess = new MockChildProcess();
    const tunnelProcess = new MockChildProcess();
    vi.mocked(spawn)
      .mockReturnValueOnce(versionProcess as unknown as ChildProcess)
      .mockReturnValueOnce(tunnelProcess as unknown as ChildProcess);

    const service = new TestTunnelService();
    const startPromise = service.start();
    setImmediate(() => {
      versionProcess.emit('close', 0);
      setImmediate(() => {
        tunnelProcess.stdout.emit('data', Buffer.from('https://example.test'));
      });
    });
    await startPromise;

    const stopPromise = service.stop();
    await stopPromise;

    expect(tunnelProcess.kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
    expect(tunnelProcess.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
    expect(service.isActive()).toBe(false);
  });
});
