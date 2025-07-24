import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiSocketServer } from './api-socket-server.js';
import {
  type GitFollowRequest,
  type GitFollowResponse,
  MessageBuilder,
  MessageParser,
  MessageType,
  type StatusResponse,
} from './pty/socket-protocol.js';

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

vi.mock('./utils/git-hooks.js', () => ({
  areHooksInstalled: vi.fn().mockResolvedValue(true),
  installGitHooks: vi.fn().mockResolvedValue({ success: true }),
  uninstallGitHooks: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('./utils/git-error.js', () => ({
  createGitError: (error: any, message: string) => new Error(`${message}: ${error.message}`),
}));

vi.mock('./websocket/control-unix-handler.js', () => ({
  controlUnixHandler: {
    isMacAppConnected: vi.fn().mockReturnValue(false),
    sendToMac: vi.fn(),
  },
}));

vi.mock('./websocket/control-protocol.js', () => ({
  createControlEvent: vi.fn((category, action, payload) => ({
    category,
    action,
    payload,
  })),
}));

// Mock execFile before importing the module
const mockExecFileCallback = vi.fn();
const mockExecFile = vi.fn((cmd: string, args: string[], options: any) => {
  return new Promise((resolve, reject) => {
    // Simulate async callback
    setImmediate(() => {
      const result = mockExecFileCallback(cmd, args, options);
      if (result.error) {
        reject(result.error);
      } else {
        resolve({ stdout: result.stdout || '', stderr: result.stderr || '' });
      }
    });
  });
});

vi.mock('util', () => ({
  promisify: () => mockExecFile,
}));

describe('ApiSocketServer', () => {
  const testSocketPath = path.join(process.env.HOME || '/tmp', '.vibetunnel', 'api.sock');
  let client: net.Socket;

  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure socket directory exists
    const socketDir = path.dirname(testSocketPath);
    if (!fs.existsSync(socketDir)) {
      fs.mkdirSync(socketDir, { recursive: true });
    }
    // Clean up any existing socket
    try {
      fs.unlinkSync(testSocketPath);
    } catch (_error) {
      // Ignore
    }
  });

  afterEach(async () => {
    // Clean up client
    if (client && !client.destroyed) {
      client.destroy();
    }
    // Stop server
    apiSocketServer.stop();
    // Clean up socket file
    try {
      fs.unlinkSync(testSocketPath);
    } catch (_error) {
      // Ignore
    }
  });

  describe('Server lifecycle', () => {
    it('should start and stop the server', async () => {
      await apiSocketServer.start();
      expect(fs.existsSync(testSocketPath)).toBe(true);

      apiSocketServer.stop();
      expect(fs.existsSync(testSocketPath)).toBe(false);
    });

    it('should handle multiple start calls gracefully', async () => {
      await apiSocketServer.start();
      apiSocketServer.stop();

      // Should be able to start again
      await expect(apiSocketServer.start()).resolves.not.toThrow();
    });
  });

  describe('Status request', () => {
    it('should return server status without Git info when not in a repo', async () => {
      // Mock git commands to fail (not in a repo)
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(new Error('Not a git repository'), '', '');
      });

      apiSocketServer.setServerInfo(4020, 'http://localhost:4020');
      await apiSocketServer.start();

      const response = await sendMessageAndGetResponse(
        testSocketPath,
        MessageBuilder.statusRequest()
      );

      expect(response.type).toBe(MessageType.STATUS_RESPONSE);
      const status = response.payload as StatusResponse;
      expect(status.running).toBe(true);
      expect(status.port).toBe(4020);
      expect(status.url).toBe('http://localhost:4020');
      expect(status.followMode).toBeUndefined();
    });

    it('should return server status with follow mode info', async () => {
      // Mock git commands
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        if (args.includes('config') && args.includes('vibetunnel.followBranch')) {
          cb(null, 'main\n', '');
        } else if (args.includes('rev-parse')) {
          cb(null, '/Users/test/project\n', '');
        } else {
          cb(new Error('Unknown command'), '', '');
        }
      });

      apiSocketServer.setServerInfo(4020, 'http://localhost:4020');
      await apiSocketServer.start();

      const response = await sendMessageAndGetResponse(
        testSocketPath,
        MessageBuilder.statusRequest()
      );

      expect(response.type).toBe(MessageType.STATUS_RESPONSE);
      const status = response.payload as StatusResponse;
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
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        if (args.includes('config') && args.includes('--local')) {
          cb(null, '', '');
        } else {
          cb(new Error('Unknown command'), '', '');
        }
      });

      await apiSocketServer.start();

      const request: GitFollowRequest = {
        repoPath: '/Users/test/project',
        branch: 'feature-branch',
        enable: true,
      };

      const response = await sendMessageAndGetResponse(
        testSocketPath,
        MessageBuilder.gitFollowRequest(request)
      );

      expect(response.type).toBe(MessageType.GIT_FOLLOW_RESPONSE);
      const followResponse = response.payload as GitFollowResponse;
      expect(followResponse.success).toBe(true);
      expect(followResponse.currentBranch).toBe('feature-branch');
    });

    it('should disable follow mode', async () => {
      // Mock git commands
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        if (args.includes('config') && args.includes('--unset')) {
          cb(null, '', '');
        } else {
          cb(new Error('Unknown command'), '', '');
        }
      });

      await apiSocketServer.start();

      const request: GitFollowRequest = {
        repoPath: '/Users/test/project',
        enable: false,
      };

      const response = await sendMessageAndGetResponse(
        testSocketPath,
        MessageBuilder.gitFollowRequest(request)
      );

      expect(response.type).toBe(MessageType.GIT_FOLLOW_RESPONSE);
      const followResponse = response.payload as GitFollowResponse;
      expect(followResponse.success).toBe(true);
      expect(followResponse.currentBranch).toBeUndefined();
    });

    it('should handle Git errors gracefully', async () => {
      // Mock git command to fail
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        cb(new Error('Git command failed'), '', '');
      });

      await apiSocketServer.start();

      const request: GitFollowRequest = {
        repoPath: '/Users/test/project',
        branch: 'main',
        enable: true,
      };

      const response = await sendMessageAndGetResponse(
        testSocketPath,
        MessageBuilder.gitFollowRequest(request)
      );

      expect(response.type).toBe(MessageType.GIT_FOLLOW_RESPONSE);
      const followResponse = response.payload as GitFollowResponse;
      expect(followResponse.success).toBe(false);
      expect(followResponse.error).toContain('Git command failed');
    });
  });

  describe('Git event notifications', () => {
    it('should acknowledge Git event notifications', async () => {
      await apiSocketServer.start();

      const response = await sendMessageAndGetResponse(
        testSocketPath,
        MessageBuilder.gitEventNotify({
          repoPath: '/Users/test/project',
          type: 'checkout',
        })
      );

      expect(response.type).toBe(MessageType.GIT_EVENT_ACK);
      const ack = response.payload as { handled: boolean };
      expect(ack.handled).toBe(true);
    });
  });

  describe('Error handling', () => {
    it('should handle invalid message types', async () => {
      await apiSocketServer.start();

      client = net.createConnection(testSocketPath);
      await new Promise<void>((resolve) => {
        client.on('connect', resolve);
      });

      // Send an invalid message type
      const invalidMessage = Buffer.alloc(5);
      invalidMessage[0] = 0xff; // Invalid message type
      invalidMessage.writeUInt32BE(0, 1);

      client.write(invalidMessage);

      // Server should not crash, just log warning
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(client.destroyed).toBe(false);
    });
  });
});

/**
 * Helper function to send a message and get response
 */
async function sendMessageAndGetResponse(
  socketPath: string,
  message: Buffer
): Promise<{ type: MessageType; payload: any }> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);
    const parser = new MessageParser();

    client.on('connect', () => {
      client.write(message);
    });

    client.on('data', (data) => {
      parser.addData(data);
      for (const msg of parser.parseMessages()) {
        client.end();
        resolve({
          type: msg.type,
          payload: JSON.parse(msg.payload.toString('utf8')),
        });
      }
    });

    client.on('error', reject);

    // Timeout after 2 seconds
    setTimeout(() => {
      client.destroy();
      reject(new Error('Response timeout'));
    }, 2000);
  });
}