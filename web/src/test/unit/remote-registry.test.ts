import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteRegistry } from '../../server/services/remote-registry.js';

vi.mock('../../server/server.js', () => ({
  isShuttingDown: () => false,
}));

describe('RemoteRegistry health tolerance', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps remote registered after one transient health check failure', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    fetchMock.mockResolvedValue({ ok: true } as Response);

    const registry = new RemoteRegistry();
    const remote = registry.register({
      id: 'r1',
      name: 'remote-1',
      url: 'http://localhost:9999',
      token: 'token',
    });

    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    expect(registry.getRemote(remote.id)).toBeDefined();
    expect(registry.getRemote(remote.id)?.consecutiveFailures).toBe(1);

    registry.destroy();
  });

  it('removes remote after three consecutive health check failures', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValue(new Error('network down'));

    const registry = new RemoteRegistry();
    registry.register({
      id: 'r2',
      name: 'remote-2',
      url: 'http://localhost:9998',
      token: 'token',
    });

    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    expect(registry.getRemote('r2')).toBeDefined();

    await vi.advanceTimersByTimeAsync(15000);
    await Promise.resolve();
    expect(registry.getRemote('r2')).toBeDefined();

    await vi.advanceTimersByTimeAsync(15000);
    await Promise.resolve();
    expect(registry.getRemote('r2')).toBeUndefined();

    registry.destroy();
  });
});
