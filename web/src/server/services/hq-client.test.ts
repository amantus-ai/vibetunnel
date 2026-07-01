import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function response(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => `status ${status}`,
  } as Response;
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
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

  it('registers immediately and after each completed interval', async () => {
    fetchMock.mockResolvedValue(response(200));
    const client = makeClient();

    client.startHeartbeat(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    client.stopHeartbeat();
  });

  it('accepts an idempotent 204 refresh but still rejects a name collision', async () => {
    const client = makeClient();
    fetchMock.mockResolvedValueOnce(response(204)).mockResolvedValueOnce(response(409));

    await expect(client.register()).resolves.toBeUndefined();
    await expect(client.register()).rejects.toThrow('Registration failed (409)');
  });

  it('recovers after eviction when a later registration is created again', async () => {
    fetchMock
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(200));
    const client = makeClient();

    client.startHeartbeat(1000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    client.stopHeartbeat();
  });

  it('keeps retrying through transient HQ failures', async () => {
    fetchMock
      .mockResolvedValueOnce(response(500))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue(response(200));
    const client = makeClient();

    client.startHeartbeat(1000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    client.stopHeartbeat();
  });

  it('does not overlap registration requests', async () => {
    const pending = deferredResponse();
    fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValue(response(204));
    const client = makeClient();

    client.startHeartbeat(1000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    pending.resolve(response(200));
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    client.stopHeartbeat();
  });

  it('starts only one heartbeat loop', () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}));
    const client = makeClient();

    client.startHeartbeat(1000);
    client.startHeartbeat(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    client.stopHeartbeat();
  });

  it('stops scheduled registrations', async () => {
    fetchMock.mockResolvedValue(response(204));
    const client = makeClient();

    client.startHeartbeat(1000);
    await vi.advanceTimersByTimeAsync(0);
    client.stopHeartbeat();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('waits for an active registration before unregistering during teardown', async () => {
    const pending = deferredResponse();
    fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response(200));
    const client = makeClient();

    client.startHeartbeat(1000);
    const destroyPromise = client.destroy();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    pending.resolve(response(200));
    await destroyPromise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'DELETE']);
  });
});
