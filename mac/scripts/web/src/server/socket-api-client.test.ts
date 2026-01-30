import * as net from 'net';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitFollowRequest, GitFollowResponse } from './pty/socket-protocol.js';

// Mock dependencies at module level
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

vi.mock('./utils/logger.js', () => ({
  createLogger: () => ({
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock net module
const mockConnect = vi.fn();
const mockSocket = {
  write: vi.fn(),
  on: vi.fn(),
  end: vi.fn(),
  destroy: vi.fn(),
  destroyed: false,
};

vi.mock('net', () => ({
  createConnection: () => {
    mockConnect();
    return mockSocket;
  },
}));

describe('SocketApiClient', () => {
  let SocketApiClient: any;
  let client: any;
  const testSocketPath = path.join(process.env.HOME || '/tmp', '.vibetunnel', 'api.sock');

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSocket.destroyed = false;
    
    // Import after mocks are set up
    const module = await import('./socket-api-client.js');
    SocketApiClient = module.SocketApiClient;
    client = new SocketApiClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getStatus', () => {
    it('should return not running when socket does not exist', async () => {
      const fs = await import('fs');
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const status = await client.getStatus();

      expect(status.running).toBe(false);
      expect(status.port).toBeUndefined();
      expect(status.url).toBeUndefined();
    });

    it('should return server status when socket exists', async () => {
      const fs = await import('fs');
      vi.mocked(fs.existsSync).mockReturnValue(true);

      // Mock the sendRequest method
      vi.spyOn(client as any, 'sendRequest').mockResolvedValue({
        running: true,
        port: 4020,
        url: 'http://localhost:4020',
        followMode: {
          enabled: true,
          branch: 'main',
          repoPath: '/Users/test/project',
        },
      });

      const status = await client.getStatus();

      expect(status.running).toBe(true);
      expect(status.port).toBe(4020);
      expect(status.url).toBe('http://localhost:4020');
      expect(status.followMode).toEqual({
        enabled: true,
        branch: 'main',
        repoPath: '/Users/test/project',
      });
    });

    it('should handle connection errors gracefully', async () => {
      const fs = await import('fs');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.spyOn(client as any, 'sendRequest').mockRejectedValue(new Error('Connection failed'));

      const status = await client.getStatus();

      expect(status.running).toBe(false);
    });
  });

  describe('setFollowMode', () => {
    it('should send follow mode request', async () => {
      const fs = await import('fs');
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const request: GitFollowRequest = {
        repoPath: '/Users/test/project',
        branch: 'feature-branch',
        enable: true,
      };

      const expectedResponse: GitFollowResponse = {
        success: true,
        currentBranch: 'feature-branch',
      };

      vi.spyOn(client as any, 'sendRequest').mockResolvedValue(expectedResponse);

      const response = await client.setFollowMode(request);

      expect(response).toEqual(expectedResponse);
      expect((client as any).sendRequest).toHaveBeenCalledWith(
        expect.anything(), // MessageType.GIT_FOLLOW_REQUEST
        request,
        expect.anything() // MessageType.GIT_FOLLOW_RESPONSE
      );
    });

    it('should throw error when socket is not available', async () => {
      const fs = await import('fs');
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const request: GitFollowRequest = {
        repoPath: '/Users/test/project',
        branch: 'main',
        enable: true,
      };

      await expect(client.setFollowMode(request)).rejects.toThrow('VibeTunnel server is not running');
    });
  });

  describe('sendGitEvent', () => {
    it('should send git event notification', async () => {
      const fs = await import('fs');
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const event = {
        repoPath: '/Users/test/project',
        type: 'checkout',
      };

      vi.spyOn(client as any, 'sendRequest').mockResolvedValue({ handled: true });

      const response = await client.sendGitEvent(event);

      expect(response.handled).toBe(true);
    });
  });

  describe('sendRequest', () => {
    it('should handle timeout', async () => {
      const fs = await import('fs');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      
      // Mock connect to succeed but never send response
      mockConnect.mockImplementation(() => {
        // Simulate connection but no data
        setTimeout(() => {
          const onHandler = mockSocket.on.mock.calls.find(call => call[0] === 'connect');
          if (onHandler && onHandler[1]) {
            onHandler[1]();
          }
        }, 10);
      });

      await expect(client.getStatus()).rejects.toThrow('Socket request timeout');
    });

    it('should handle server errors', async () => {
      const fs = await import('fs');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      
      mockConnect.mockImplementation(() => {
        // Simulate connection error
        setTimeout(() => {
          const onHandler = mockSocket.on.mock.calls.find(call => call[0] === 'error');
          if (onHandler && onHandler[1]) {
            onHandler[1](new Error('Connection refused'));
          }
        }, 10);
      });

      const status = await client.getStatus();
      expect(status.running).toBe(false);
    });
  });
});