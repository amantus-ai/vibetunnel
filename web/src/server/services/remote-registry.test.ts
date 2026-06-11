import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteRegistry } from './remote-registry.js';

vi.mock('../server.js', () => ({
  isShuttingDown: () => false,
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    log: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('RemoteRegistry health checks', () => {
  let registry: RemoteRegistry;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    registry = new RemoteRegistry();
  });

  afterEach(() => {
    registry.destroy();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  function registerRemote(id: string) {
    return registry.register({
      id,
      name: `remote-${id}`,
      url: `http://remote-${id}.example`,
      token: 'token',
    });
  }

  function deferredResponse() {
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<Response>((_resolve, rejectPromise) => {
      reject = rejectPromise;
    });
    return { promise, reject };
  }

  it('keeps a remote registered after a transient failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('temporary network failure'));

    const remote = registerRemote('one-failure');
    await vi.advanceTimersByTimeAsync(0);

    expect(registry.getRemote(remote.id)).toBe(remote);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('unregisters a remote after three consecutive failures', async () => {
    fetchMock.mockRejectedValue(new Error('network unavailable'));

    registerRemote('three-failures');
    await vi.advanceTimersByTimeAsync(0);
    expect(registry.getRemote('three-failures')).toBeDefined();

    await vi.advanceTimersByTimeAsync(15000);
    expect(registry.getRemote('three-failures')).toBeDefined();

    await vi.advanceTimersByTimeAsync(15000);
    expect(registry.getRemote('three-failures')).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('resets the failure threshold after a successful health check', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockRejectedValue(new Error('network unavailable'));

    registerRemote('recovered');
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(15000);
    await vi.advanceTimersByTimeAsync(30000);
    expect(registry.getRemote('recovered')).toBeDefined();

    await vi.advanceTimersByTimeAsync(15000);
    expect(registry.getRemote('recovered')).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('ignores stale checks after a remote id is re-registered', async () => {
    const firstStaleCheck = deferredResponse();
    const secondStaleCheck = deferredResponse();
    fetchMock
      .mockReturnValueOnce(firstStaleCheck.promise)
      .mockReturnValueOnce(secondStaleCheck.promise)
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockRejectedValueOnce(new Error('replacement failure'));

    const original = registerRemote('reused');
    await vi.advanceTimersByTimeAsync(15000);

    expect(registry.unregister(original.id)).toBe(true);
    const replacement = registerRemote('reused');
    await vi.advanceTimersByTimeAsync(0);

    firstStaleCheck.reject(new Error('stale failure one'));
    secondStaleCheck.reject(new Error('stale failure two'));
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(15000);
    expect(registry.getRemote(replacement.id)).toBe(replacement);
  });
});
