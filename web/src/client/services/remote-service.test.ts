/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthClient } from './auth-client';
import { RemoteService } from './remote-service';

describe('RemoteService', () => {
  let service: RemoteService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    service = new RemoteService({
      getAuthHeader: vi.fn(() => ({ Authorization: 'Bearer test-token' })),
    } as unknown as AuthClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns only the public fields needed by the machine picker', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { id: 'remote-1', name: 'Studio Mac', url: 'https://studio.example.com' },
        { id: 2, name: 'Invalid' },
      ],
    });

    await expect(service.listRemotes()).resolves.toEqual([{ id: 'remote-1', name: 'Studio Mac' }]);
  });

  it('rejects request failures instead of treating them as an empty HQ', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });

    await expect(service.listRemotes()).rejects.toThrow('Failed to load machines (503)');
  });

  it('rejects malformed responses', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ remotes: [] }) });

    await expect(service.listRemotes()).rejects.toThrow('invalid server response');
  });
});
