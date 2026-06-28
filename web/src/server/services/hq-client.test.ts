import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Quiet logger so the heartbeat's debug/error lines don't clutter test output.
vi.mock('../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    warn: vi.fn(),
    log: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  })),
}));

const { HQClient } = await import('./hq-client.js');

function makeClient() {
  return new HQClient(
    'http://hq.test',
    'hq-user',
    'hq-pass',
    'laptop',
    'http://laptop.test:4020',
    'bearer-token'
  );
}

describe('HQClient re-registration heartbeat', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const ok = () => ({ ok: true, status: 200, text: async () => '' }) as unknown as Response;
  const conflict = () =>
    ({ ok: false, status: 409, text: async () => 'already registered' }) as unknown as Response;
  const serverError = () =>
    ({ ok: false, status: 500, text: async () => 'boom' }) as unknown as Response;

  it('re-registers on each interval', async () => {
    fetchMock.mockResolvedValue(ok());
    const client = makeClient();

    client.startHeartbeat(1000);
    expect(fetchMock).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    client.stopHeartbeat();
  });

  it('treats a 409 (already registered) as an idempotent success, not a throw', async () => {
    // The steady state: the remote is still registered, HQ replies 409 every beat.
    fetchMock.mockResolvedValue(conflict());
    const client = makeClient();

    // register() must resolve (not reject) on 409 so the heartbeat stays quiet.
    await expect(client.register()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1); // the manual register above

    client.startHeartbeat(1000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).toHaveBeenCalledTimes(4); // 1 manual + 3 beats, no unhandled rejection
    client.stopHeartbeat();
  });

  it('recovers after eviction: a later beat re-registers once HQ accepts again', async () => {
    // While registered → 409; after the host slept and HQ evicted it, the POST
    // succeeds again. The heartbeat must keep firing across that transition.
    fetchMock
      .mockResolvedValueOnce(conflict()) // beat 1 — still registered
      .mockResolvedValueOnce(conflict()) // beat 2 — still registered
      .mockResolvedValueOnce(ok()); // beat 3 — evicted, re-registered
    const client = makeClient();

    client.startHeartbeat(1000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    client.stopHeartbeat();
  });

  it('keeps beating through a transient HQ failure', async () => {
    // A 500 / network blip on one beat must not stop the heartbeat.
    fetchMock
      .mockResolvedValueOnce(serverError())
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue(ok());
    const client = makeClient();

    client.startHeartbeat(1000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    client.stopHeartbeat();
  });

  it('startHeartbeat is idempotent (a second call does not double the cadence)', async () => {
    fetchMock.mockResolvedValue(ok());
    const client = makeClient();

    client.startHeartbeat(1000);
    client.startHeartbeat(1000); // ignored — already running
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1); // one beat, not two
    client.stopHeartbeat();
  });

  it('stopHeartbeat halts further beats', async () => {
    fetchMock.mockResolvedValue(ok());
    const client = makeClient();

    client.startHeartbeat(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    client.stopHeartbeat();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no more beats
  });

  it('destroy() stops the heartbeat (no beat after teardown)', async () => {
    fetchMock.mockResolvedValue(ok());
    const client = makeClient();

    client.startHeartbeat(1000);
    await client.destroy(); // unregisters + stops heartbeat
    await vi.advanceTimersByTimeAsync(5000);

    // The only fetch was destroy()'s DELETE; no heartbeat POSTs after.
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method !== 'DELETE');
    expect(posts).toHaveLength(0);
  });
});
