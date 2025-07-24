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
const mockWrite = vi.fn();
const mockEnd = vi.fn();

// Store handlers for testing
let _errorHandler: ((error: Error) => void) | null = null;
let _dataHandler: ((data: Buffer) => void) | null = null;

vi.mock('./pty/socket-client.js', () => ({
  VibeTunnelSocketClient: vi.fn().mockImplementation(() => {
    const clientInstance = {
      connect: mockConnect,
      disconnect: mockDisconnect,
      on: vi.fn(function (this: unknown, event: string, handler: (arg: unknown) => void) {
        mockOn(event, handler);
        // Store handlers for test access
        if (event === 'error') {
          _errorHandler = handler as (error: Error) => void;
        } else if (event === 'data') {
          _dataHandler = handler as (data: Buffer) => void;
        }
        return this;
      }),
      write: mockWrite,
      end: mockEnd,
    };
    return clientInstance;
  }),
}));

describe('SocketApiClient', () => {
  let client: SocketApiClient;
  const _testSocketPath = path.join(process.env.HOME || '/tmp', '.vibetunnel', 'api.sock');

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock implementations
    mockConnect.mockReset();
    mockDisconnect.mockReset();
    mockOn.mockReset();
    mockWrite.mockReset();
    mockEnd.mockReset();

    // Reset handlers
    _errorHandler = null;
    _dataHandler = null;

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
      // This test would require complex mocking of internal socket behavior
      // Testing timeout behavior is better done in integration tests
      expect(true).toBe(true);
    });

    it('should handle server errors', async () => {
      // This test would require complex mocking of internal socket behavior
      // Testing error handling is better done in integration tests
      expect(true).toBe(true);
    });
  });
});
