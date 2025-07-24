import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitFollowRequest, GitFollowResponse } from './pty/socket-protocol.js';
import { SocketApiClient } from './socket-api-client.js';

// Mock fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

// Mock dependencies
vi.mock('./utils/logger.js', () => ({
  createLogger: () => ({
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock VibeTunnelSocketClient
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockOn = vi.fn();

vi.mock('./pty/socket-client.js', () => ({
  VibeTunnelSocketClient: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    disconnect: mockDisconnect,
    on: mockOn,
  })),
}));

describe('SocketApiClient', () => {
  let client: SocketApiClient;
  const _testSocketPath = path.join(process.env.HOME || '/tmp', '.vibetunnel', 'api.sock');

  beforeEach(() => {
    vi.clearAllMocks();
    client = new SocketApiClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getStatus', () => {
    it('should return not running when socket does not exist', async () => {
      const { existsSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(false);

      const status = await client.getStatus();

      expect(status.running).toBe(false);
      expect(status.port).toBeUndefined();
      expect(status.url).toBeUndefined();
    });

    it('should return server status when socket exists', async () => {
      const { existsSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(true);

      // Mock the sendRequest method
      const mockStatus = {
        running: true,
        port: 4020,
        url: 'http://localhost:4020',
        followMode: {
          enabled: true,
          branch: 'main',
          repoPath: '/Users/test/project',
        },
      };

      vi.spyOn(
        client as unknown as { sendRequest: (...args: unknown[]) => unknown },
        'sendRequest'
      ).mockResolvedValue(mockStatus);

      const status = await client.getStatus();

      expect(status).toEqual(mockStatus);
    });

    it('should handle connection errors gracefully', async () => {
      const { existsSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(true);
      vi.spyOn(
        client as unknown as { sendRequest: (...args: unknown[]) => unknown },
        'sendRequest'
      ).mockRejectedValue(new Error('Connection failed'));

      const status = await client.getStatus();

      expect(status.running).toBe(false);
    });
  });

  describe('setFollowMode', () => {
    it('should send follow mode request', async () => {
      const { existsSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(true);

      const request: GitFollowRequest = {
        repoPath: '/Users/test/project',
        branch: 'feature-branch',
        enable: true,
      };

      const expectedResponse: GitFollowResponse = {
        success: true,
        currentBranch: 'feature-branch',
      };

      vi.spyOn(
        client as unknown as { sendRequest: (...args: unknown[]) => unknown },
        'sendRequest'
      ).mockResolvedValue(expectedResponse);

      const response = await client.setFollowMode(request);

      expect(response).toEqual(expectedResponse);
      expect(
        (client as unknown as { sendRequest: (...args: unknown[]) => unknown }).sendRequest
      ).toHaveBeenCalledWith(
        expect.anything(), // MessageType.GIT_FOLLOW_REQUEST
        request,
        expect.anything() // MessageType.GIT_FOLLOW_RESPONSE
      );
    });

    it('should throw error when socket is not available', async () => {
      const { existsSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(false);

      const request: GitFollowRequest = {
        repoPath: '/Users/test/project',
        branch: 'main',
        enable: true,
      };

      await expect(client.setFollowMode(request)).rejects.toThrow(
        'VibeTunnel server is not running'
      );
    });
  });

  describe('sendGitEvent', () => {
    it('should send git event notification', async () => {
      const { existsSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(true);

      const event = {
        repoPath: '/Users/test/project',
        type: 'checkout' as const,
      };

      const expectedAck = {
        handled: true,
      };

      vi.spyOn(
        client as unknown as { sendRequest: (...args: unknown[]) => unknown },
        'sendRequest'
      ).mockResolvedValue(expectedAck);

      const ack = await client.sendGitEvent(event);

      expect(ack).toEqual(expectedAck);
    });
  });

  describe('sendRequest', () => {
    it('should handle timeout', async () => {
      const { existsSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(true);

      // Mock connect to succeed but never send response
      mockConnect.mockResolvedValue(undefined);

      // Use a real client instance to test the actual sendRequest method
      const realClient = new SocketApiClient();

      // Override the timeout to be shorter for testing
      const promise = (
        realClient as unknown as { sendRequest: (...args: unknown[]) => unknown }
      ).sendRequest(
        0x20, // STATUS_REQUEST
        {},
        0x21, // STATUS_RESPONSE
        100 // 100ms timeout
      );

      await expect(promise).rejects.toThrow('Request timeout');
    });

    it('should handle server errors', async () => {
      const { existsSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(true);

      mockConnect.mockResolvedValue(undefined);

      // Set up the mock to call the error handler
      mockOn.mockImplementation((event, handler) => {
        if (event === 'error') {
          setTimeout(() => handler(new Error('Socket error')), 10);
        }
      });

      const realClient = new SocketApiClient();

      await expect(
        (realClient as unknown as { sendRequest: (...args: unknown[]) => unknown }).sendRequest(
          0x20,
          {},
          0x21
        )
      ).rejects.toThrow('Socket error');
    });
  });
});
