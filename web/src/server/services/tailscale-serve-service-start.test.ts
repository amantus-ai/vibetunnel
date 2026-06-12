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
      }
    ).checkTailscaleAvailable = vi.fn().mockResolvedValue(undefined);
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
});
