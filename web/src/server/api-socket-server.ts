/**
 * API Socket Server for VibeTunnel control operations
 * Provides a Unix socket interface for CLI commands (vt) to communicate with the server
 */

import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import {
  type GitEventAck,
  type GitEventNotify,
  type GitFollowRequest,
  type GitFollowResponse,
  MessageBuilder,
  MessageParser,
  MessageType,
  parsePayload,
  type StatusResponse,
} from './pty/socket-protocol.js';
import { createGitError } from './utils/git-error.js';
import { areHooksInstalled, installGitHooks, uninstallGitHooks } from './utils/git-hooks.js';
import { createLogger } from './utils/logger.js';
import { createControlEvent } from './websocket/control-protocol.js';
import { controlUnixHandler } from './websocket/control-unix-handler.js';

const logger = createLogger('api-socket');
const execFile = promisify(require('child_process').execFile);

/**
 * Execute a git command with proper error handling
 */
async function execGit(
  args: string[],
  options: { cwd?: string; timeout?: number } = {}
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFile('git', args, {
      cwd: options.cwd || process.cwd(),
      timeout: options.timeout || 5000,
      maxBuffer: 1024 * 1024, // 1MB
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, // Disable git prompts
    });
    return { stdout: stdout.toString(), stderr: stderr.toString() };
  } catch (error) {
    throw createGitError(error, 'Git command failed');
  }
}

/**
 * API Socket Server that handles CLI commands via Unix socket
 */
export class ApiSocketServer {
  private server: net.Server | null = null;
  private readonly socketPath: string;
  private serverPort?: number;
  private serverUrl?: string;

  constructor() {
    const homeDir = os.homedir();
    const socketDir = path.join(homeDir, '.vibetunnel');

    // Ensure directory exists
    if (!fs.existsSync(socketDir)) {
      fs.mkdirSync(socketDir, { recursive: true });
    }

    // Use a different socket name to avoid conflicts
    this.socketPath = path.join(socketDir, 'api.sock');
  }

  /**
   * Set server info for status queries
   */
  setServerInfo(port: number, url: string): void {
    this.serverPort = port;
    this.serverUrl = url;
  }

  /**
   * Start the API socket server
   */
  async start(): Promise<void> {
    // Clean up any existing socket
    try {
      fs.unlinkSync(this.socketPath);
    } catch (_error) {
      // Ignore
    }

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.handleConnection(socket);
      });

      this.server.on('error', (error) => {
        logger.error('API socket server error:', error);
        reject(error);
      });

      this.server.listen(this.socketPath, () => {
        logger.log(`API socket server listening on ${this.socketPath}`);
        resolve();
      });
    });
  }

  /**
   * Stop the API socket server
   */
  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }

    // Clean up socket file
    try {
      fs.unlinkSync(this.socketPath);
    } catch (_error) {
      // Ignore
    }
  }

  /**
   * Handle incoming socket connections
   */
  private handleConnection(socket: net.Socket): void {
    const parser = new MessageParser();

    socket.on('data', (data) => {
      parser.addData(data);

      for (const { type, payload } of parser.parseMessages()) {
        this.handleMessage(socket, type, payload);
      }
    });

    socket.on('error', (error) => {
      logger.error('API socket connection error:', error);
    });
  }

  /**
   * Handle incoming messages
   */
  private async handleMessage(
    socket: net.Socket,
    type: MessageType,
    payload: Buffer
  ): Promise<void> {
    try {
      const data = parsePayload(type, payload);

      switch (type) {
        case MessageType.STATUS_REQUEST:
          await this.handleStatusRequest(socket);
          break;

        case MessageType.GIT_FOLLOW_REQUEST:
          await this.handleGitFollowRequest(socket, data as GitFollowRequest);
          break;

        case MessageType.GIT_EVENT_NOTIFY:
          await this.handleGitEventNotify(socket, data as GitEventNotify);
          break;

        default:
          logger.warn(`Unhandled message type: ${type}`);
      }
    } catch (error) {
      logger.error('Failed to handle message:', error);
      this.sendError(socket, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Handle status request
   */
  private async handleStatusRequest(socket: net.Socket): Promise<void> {
    try {
      // Get current working directory for follow mode check
      const cwd = process.cwd();

      // Check follow mode status
      let followMode: StatusResponse['followMode'];
      try {
        const { stdout } = await execGit(['config', 'vibetunnel.followBranch'], { cwd });
        const followBranch = stdout.trim();
        if (followBranch) {
          // Get repo path
          const { stdout: repoPath } = await execGit(['rev-parse', '--show-toplevel'], { cwd });
          followMode = {
            enabled: true,
            branch: followBranch,
            repoPath: repoPath.trim(),
          };
        }
      } catch (_error) {
        // Not in a git repo or follow mode not configured
      }

      const response: StatusResponse = {
        running: true,
        port: this.serverPort,
        url: this.serverUrl,
        followMode,
      };

      socket.write(MessageBuilder.statusResponse(response));
    } catch (error) {
      logger.error('Failed to get status:', error);
      this.sendError(socket, 'Failed to get server status');
    }
  }

  /**
   * Handle Git follow mode request
   */
  private async handleGitFollowRequest(
    socket: net.Socket,
    request: GitFollowRequest
  ): Promise<void> {
    try {
      const { repoPath, branch, enable } = request;
      const absoluteRepoPath = path.resolve(repoPath);

      logger.debug(
        `${enable ? 'Enabling' : 'Disabling'} follow mode${branch ? ` for branch: ${branch}` : ''}`
      );

      if (enable) {
        // Check if Git hooks are already installed
        const hooksAlreadyInstalled = await areHooksInstalled(absoluteRepoPath);

        if (!hooksAlreadyInstalled) {
          // Install Git hooks
          logger.info('Installing Git hooks for follow mode');
          const installResult = await installGitHooks(absoluteRepoPath);

          if (!installResult.success) {
            const response: GitFollowResponse = {
              success: false,
              error: 'Failed to install Git hooks',
            };
            socket.write(MessageBuilder.gitFollowResponse(response));
            return;
          }
        }

        // Set the follow mode config
        await execGit(['config', '--local', 'vibetunnel.followBranch', branch || ''], {
          cwd: absoluteRepoPath,
        });

        // Send notification to Mac app
        if (controlUnixHandler.isMacAppConnected()) {
          const notification = createControlEvent('system', 'notification', {
            level: 'info',
            title: 'Follow Mode Enabled',
            message: `Now following branch '${branch}' in ${path.basename(absoluteRepoPath)}`,
          });
          controlUnixHandler.sendToMac(notification);
        }

        const response: GitFollowResponse = {
          success: true,
          currentBranch: branch,
        };
        socket.write(MessageBuilder.gitFollowResponse(response));
      } else {
        // Disable follow mode
        await execGit(['config', '--local', '--unset', 'vibetunnel.followBranch'], {
          cwd: absoluteRepoPath,
        });

        // Uninstall Git hooks when disabling follow mode
        logger.info('Uninstalling Git hooks');
        const uninstallResult = await uninstallGitHooks(absoluteRepoPath);

        if (!uninstallResult.success) {
          logger.warn('Failed to uninstall some Git hooks:', uninstallResult.errors);
          // Continue anyway - follow mode is still disabled
        } else {
          logger.info('Git hooks uninstalled successfully');
        }

        // Send notification to Mac app
        if (controlUnixHandler.isMacAppConnected()) {
          const notification = createControlEvent('system', 'notification', {
            level: 'info',
            title: 'Follow Mode Disabled',
            message: `Follow mode disabled in ${path.basename(absoluteRepoPath)}`,
          });
          controlUnixHandler.sendToMac(notification);
        }

        const response: GitFollowResponse = {
          success: true,
        };
        socket.write(MessageBuilder.gitFollowResponse(response));
      }
    } catch (error) {
      const response: GitFollowResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      socket.write(MessageBuilder.gitFollowResponse(response));
    }
  }

  /**
   * Handle Git event notification
   */
  private async handleGitEventNotify(socket: net.Socket, event: GitEventNotify): Promise<void> {
    // For now, just acknowledge receipt
    // The git hooks will continue to use the HTTP endpoint directly
    logger.debug(`Git event notification received: ${event.type} for ${event.repoPath}`);

    const ack: GitEventAck = {
      handled: true,
    };
    socket.write(MessageBuilder.gitEventAck(ack));
  }

  /**
   * Send error response
   */
  private sendError(socket: net.Socket, message: string): void {
    socket.write(MessageBuilder.error('API_ERROR', message));
  }
}

// Export singleton instance
export const apiSocketServer = new ApiSocketServer();
