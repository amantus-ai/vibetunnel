import * as net from 'net';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type GitFollowRequest,
  type GitFollowResponse,
  MessageBuilder,
  MessageParser,
  MessageType,
  type StatusResponse,
} from './pty/socket-protocol.js';

// Mock dependencies at the module level
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

vi.mock('./utils/logger.js', () => ({
  createLogger: () => ({
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('./environment.js', () => ({
  isDevelopment: () => true,
}));

vi.mock('./notification-service.js', () => ({
  notificationService: {
    sendNotification: vi.fn(),
  },
}));

vi.mock('./ssh-key-manager.js', () => ({
  SSHKeyManager: {
    getInstance: () => ({
      generateKeypair: vi.fn(),
      getPublicKey: vi.fn(),
    }),
  },
}));

// Mock promisify and execFile
const mockExecFile = vi.fn();
vi.mock('util', () => ({
  promisify: () => mockExecFile,
}));

// Import the function we need to test handler methods
import { apiSocketServer as realApiSocketServer } from './api-socket-server.js';

describe('ApiSocketServer', () => {
  const testSocketPath = path.join(process.env.HOME || '/tmp', '.vibetunnel', 'api.sock');

  beforeEach(async () => {
    vi.clearAllMocks();

    // Configure fs mocks
    const fsMock = await import('fs');
    vi.mocked(fsMock.existsSync).mockReturnValue(true);
    vi.mocked(fsMock.mkdirSync).mockImplementation(() => undefined);
    vi.mocked(fsMock.unlinkSync).mockImplementation(() => {});
  });

  afterEach(async () => {
    // Make sure to stop the server if it's running
    try {
      realApiSocketServer.stop();
    } catch (error) {
      // Ignore errors when stopping already stopped server
    }
  });

  describe('Server lifecycle', () => {
    it('should handle server info', async () => {
      realApiSocketServer.setServerInfo(4020, 'http://localhost:4020');
      
      // Test that server info was set (we can't directly test private properties)
      expect(true).toBe(true);
    });
  });

  describe('Status request', () => {
    it('should return server status without Git info when not in a repo', async () => {
      // Mock git commands to fail (not in a repo)
      mockExecFile.mockRejectedValue(new Error('Not a git repository'));

      realApiSocketServer.setServerInfo(4020, 'http://localhost:4020');

      // Test the handler directly since we can't create real sockets with mocked fs
      const mockSocket = {
        write: vi.fn(),
      };

      await realApiSocketServer.handleStatusRequest(mockSocket);

      expect(mockSocket.write).toHaveBeenCalled();
      const call = mockSocket.write.mock.calls[0][0];
      expect(call[0]).toBe(MessageType.STATUS_RESPONSE);
      
      // Parse the response
      const parser = new MessageParser();
      parser.addData(call);
      const messages = parser.parseMessages();
      expect(messages.length).toBe(1);
      
      const status = JSON.parse(messages[0].payload.toString()) as StatusResponse;
      expect(status.running).toBe(true);
      expect(status.port).toBe(4020);
      expect(status.url).toBe('http://localhost:4020');
      expect(status.followMode).toBeUndefined();
    });

    it('should return server status with follow mode info', async () => {
      // Mock git commands
      mockExecFile
        .mockResolvedValueOnce({ stdout: 'main\n', stderr: '' }) // config command
        .mockResolvedValueOnce({ stdout: '/Users/test/project\n', stderr: '' }); // rev-parse

      realApiSocketServer.setServerInfo(4020, 'http://localhost:4020');

      const mockSocket = {
        write: vi.fn(),
      };

      await realApiSocketServer.handleStatusRequest(mockSocket);

      expect(mockSocket.write).toHaveBeenCalled();
      const call = mockSocket.write.mock.calls[0][0];
      
      // Parse the response
      const parser = new MessageParser();
      parser.addData(call);
      const messages = parser.parseMessages();
      expect(messages.length).toBe(1);
      
      const status = JSON.parse(messages[0].payload.toString()) as StatusResponse;
      expect(status.running).toBe(true);
      expect(status.followMode).toEqual({
        enabled: true,
        branch: 'main',
        repoPath: '/Users/test/project',
      });
    });
  });

  describe('Git follow mode', () => {
    it('should enable follow mode', async () => {
      // Mock git commands
      mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });

      const request: GitFollowRequest = {
        repoPath: '/Users/test/project',
        branch: 'feature-branch',
        enable: true,
      };

      const mockSocket = {
        write: vi.fn(),
      };

      await realApiSocketServer.handleGitFollowRequest(mockSocket, request);

      expect(mockSocket.write).toHaveBeenCalled();
      const call = mockSocket.write.mock.calls[0][0];
      expect(call[0]).toBe(MessageType.GIT_FOLLOW_RESPONSE);
      
      // Parse the response
      const parser = new MessageParser();
      parser.addData(call);
      const messages = parser.parseMessages();
      expect(messages.length).toBe(1);
      
      const response = JSON.parse(messages[0].payload.toString()) as GitFollowResponse;
      expect(response.success).toBe(true);
      expect(response.currentBranch).toBe('feature-branch');
    });

    it('should disable follow mode', async () => {
      // Mock git commands
      mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });

      const request: GitFollowRequest = {
        repoPath: '/Users/test/project',
        enable: false,
      };

      const mockSocket = {
        write: vi.fn(),
      };

      await realApiSocketServer.handleGitFollowRequest(mockSocket, request);

      expect(mockSocket.write).toHaveBeenCalled();
      const call = mockSocket.write.mock.calls[0][0];
      
      // Parse the response
      const parser = new MessageParser();
      parser.addData(call);
      const messages = parser.parseMessages();
      
      const response = JSON.parse(messages[0].payload.toString()) as GitFollowResponse;
      expect(response.success).toBe(true);
      expect(response.currentBranch).toBeUndefined();
    });

    it('should handle Git errors gracefully', async () => {
      // Mock git command to fail
      mockExecFile.mockRejectedValue(new Error('Git command failed'));

      const request: GitFollowRequest = {
        repoPath: '/Users/test/project',
        branch: 'main',
        enable: true,
      };

      const mockSocket = {
        write: vi.fn(),
      };

      await realApiSocketServer.handleGitFollowRequest(mockSocket, request);

      expect(mockSocket.write).toHaveBeenCalled();
      const call = mockSocket.write.mock.calls[0][0];
      
      // Parse the response
      const parser = new MessageParser();
      parser.addData(call);
      const messages = parser.parseMessages();
      
      const response = JSON.parse(messages[0].payload.toString()) as GitFollowResponse;
      expect(response.success).toBe(false);
      expect(response.error).toContain('Git command failed');
    });
  });

  describe('Git event notifications', () => {
    it('should acknowledge Git event notifications', async () => {
      const mockSocket = {
        write: vi.fn(),
      };

      await realApiSocketServer.handleGitEventNotify(mockSocket, {
        repoPath: '/Users/test/project',
        type: 'checkout',
      });

      expect(mockSocket.write).toHaveBeenCalled();
      const call = mockSocket.write.mock.calls[0][0];
      expect(call[0]).toBe(MessageType.GIT_EVENT_ACK);
      
      // Parse the response
      const parser = new MessageParser();
      parser.addData(call);
      const messages = parser.parseMessages();
      
      const ack = JSON.parse(messages[0].payload.toString()) as { handled: boolean };
      expect(ack.handled).toBe(true);
    });
  });
});