import type { ChildProcess, SpawnOptions, StdioOptions } from 'child_process';
import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
  spawn: spawnMock,
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
  })),
}));

import { TailscaleServeServiceImpl } from './tailscale-serve-service.js';

function fakeProcess(): ChildProcess {
  const process = new EventEmitter() as EventEmitter & Partial<ChildProcess>;
  process.stdout = new EventEmitter() as ChildProcess['stdout'];
  process.stderr = new EventEmitter() as ChildProcess['stderr'];
  process.killed = false;
  process.kill = vi.fn(() => {
    process.killed = true;
    return true;
  });
  return process as ChildProcess;
}

describe('TailscaleServeService startup', () => {
  let service: TailscaleServeServiceImpl;

  beforeEach(() => {
    vi.useFakeTimers();
    spawnMock.mockReset();
    service = new TailscaleServeServiceImpl();
    (
      service as unknown as {
        checkTailscaleAvailable(): Promise<void>;
        verifyServeConfiguration(port: number): Promise<boolean>;
      }
    ).checkTailscaleAvailable = vi.fn().mockResolvedValue(undefined);
    (
      service as unknown as {
        verifyServeConfiguration(port: number): Promise<boolean>;
      }
    ).verifyServeConfiguration = vi.fn().mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the configured port when --bg exits successfully near the startup deadline', async () => {
    const resetProcess = fakeProcess();
    const serveProcess = fakeProcess();
    const stopResetProcess = fakeProcess();

    spawnMock
      .mockImplementationOnce(
        (_command: string, _args: readonly string[], _options: SpawnOptions) => {
          queueMicrotask(() => resetProcess.emit('exit', 0, null));
          return resetProcess;
        }
      )
      .mockImplementationOnce(
        (_command: string, _args: readonly string[], _options: StdioOptions) => {
          setTimeout(() => serveProcess.emit('exit', 0, null), 2_500);
          return serveProcess;
        }
      )
      .mockImplementationOnce(
        (_command: string, _args: readonly string[], _options: SpawnOptions) => {
          queueMicrotask(() => stopResetProcess.emit('exit', 0, null));
          return stopResetProcess;
        }
      );

    const startPromise = service.start(43213);
    await vi.advanceTimersByTimeAsync(3_001);

    await expect(startPromise).resolves.toBeUndefined();
    expect(service.isRunning()).toBe(true);
    expect(await service.getStatus()).toMatchObject({
      isRunning: true,
      port: 43213,
    });

    await service.stop();
    expect(service.isRunning()).toBe(false);
  });

  it('waits for the persistent proxy to become observable before resolving startup', async () => {
    const resetProcess = fakeProcess();
    const serveProcess = fakeProcess();
    const verificationMock = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    (
      service as unknown as {
        verifyServeConfiguration(port: number): Promise<boolean>;
      }
    ).verifyServeConfiguration = verificationMock;

    spawnMock
      .mockImplementationOnce(
        (_command: string, _args: readonly string[], _options: SpawnOptions) => {
          queueMicrotask(() => resetProcess.emit('exit', 0, null));
          return resetProcess;
        }
      )
      .mockImplementationOnce(
        (_command: string, _args: readonly string[], _options: StdioOptions) => {
          queueMicrotask(() => serveProcess.emit('exit', 0, null));
          return serveProcess;
        }
      );

    const startPromise = service.start(43213);
    let resolved = false;
    void startPromise.then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(200);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(200);
    await expect(startPromise).resolves.toBeUndefined();
    expect(verificationMock).toHaveBeenCalledTimes(3);
  });

  it('clears tracked state after Serve reset succeeds', async () => {
    const resetProcess = fakeProcess();
    const internals = service as unknown as {
      currentPort: number | null;
      isStarting: boolean;
    };
    internals.currentPort = 43213;
    internals.isStarting = false;

    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => resetProcess.emit('exit', 0, null));
      return resetProcess;
    });

    await expect(service.stop()).resolves.toBeUndefined();
    expect(service.isRunning()).toBe(false);
    expect(internals.currentPort).toBeNull();
  });

  it('preserves tracked state when Serve reset exits non-zero', async () => {
    const resetProcess = fakeProcess();
    const internals = service as unknown as {
      currentPort: number | null;
      isStarting: boolean;
      lastError: string | undefined;
    };
    internals.currentPort = 43213;
    internals.isStarting = false;

    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => resetProcess.emit('exit', 1, null));
      return resetProcess;
    });

    await expect(service.stop()).resolves.toBeUndefined();
    expect(service.isRunning()).toBe(true);
    expect(internals.currentPort).toBe(43213);

    const retryResetProcess = fakeProcess();
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => retryResetProcess.emit('exit', 0, null));
      return retryResetProcess;
    });

    await expect(service.stop()).resolves.toBeUndefined();
    expect(service.isRunning()).toBe(false);
    expect(internals.currentPort).toBeNull();
    expect(internals.lastError).toBeUndefined();
  });

  it('preserves tracked state when Serve reset emits an error', async () => {
    const resetProcess = fakeProcess();
    const internals = service as unknown as {
      currentPort: number | null;
      isStarting: boolean;
    };
    internals.currentPort = 43213;
    internals.isStarting = false;

    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => resetProcess.emit('error', new Error('reset unavailable')));
      return resetProcess;
    });

    await expect(service.stop()).resolves.toBeUndefined();
    expect(service.isRunning()).toBe(true);
    expect(internals.currentPort).toBe(43213);
  });

  it('preserves tracked state when Serve reset times out', async () => {
    const resetProcess = fakeProcess();
    const internals = service as unknown as {
      currentPort: number | null;
      isStarting: boolean;
    };
    internals.currentPort = 43213;
    internals.isStarting = false;
    spawnMock.mockReturnValueOnce(resetProcess);

    const stopExpectation = expect(service.stop()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(2_001);

    await stopExpectation;
    expect(resetProcess.kill).toHaveBeenCalledWith('SIGTERM');
    expect(service.isRunning()).toBe(true);
    expect(internals.currentPort).toBe(43213);
  });

  it('terminates a tracked Serve child without hiding state when reset fails', async () => {
    const resetProcess = fakeProcess();
    const serveProcess = fakeProcess();
    const startTime = new Date('2026-06-12T23:00:00.000Z');
    serveProcess.kill = vi.fn((signal) => {
      serveProcess.killed = true;
      queueMicrotask(() => serveProcess.emit('exit', null, signal));
      return true;
    });
    const internals = service as unknown as {
      currentPort: number | null;
      isStarting: boolean;
      lastError: string | undefined;
      serveProcess: ChildProcess | null;
      startTime: Date | undefined;
      handleServeProcessExit(code: number | null, signal: NodeJS.Signals | null): void;
    };
    internals.currentPort = 43213;
    internals.isStarting = false;
    internals.serveProcess = serveProcess;
    internals.startTime = startTime;
    serveProcess.on('exit', (code, signal) => {
      internals.handleServeProcessExit(code, signal);
    });

    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => resetProcess.emit('exit', 1, null));
      return resetProcess;
    });

    await expect(service.stop()).resolves.toBeUndefined();
    expect(serveProcess.kill).toHaveBeenCalledWith('SIGTERM');
    expect(internals.serveProcess).toBeNull();
    expect(internals.currentPort).toBe(43213);
    expect(internals.lastError).toBe('Failed to reset Tailscale Serve configuration');
    expect(internals.startTime).toBe(startTime);
    expect(service.isRunning()).toBe(true);
    await expect(service.getStatus()).resolves.toMatchObject({
      isRunning: true,
      port: 43213,
      lastError: undefined,
      startTime,
    });
  });
});
