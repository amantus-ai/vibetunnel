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
import { prettifyPath } from './utils/path-prettify.js';
import { BUILD_DATE, VERSION } from './version.js';
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
    // Use control directory from environment or default
    const controlDir = process.env.VIBETUNNEL_CONTROL_DIR || path.join(os.homedir(), '.vibetunnel');
    const socketDir = controlDir;

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
        // Check if we're in a git repo
        const { stdout: repoPathOutput } = await execGit(['rev-parse', '--show-toplevel'], { cwd });
        const repoPath = repoPathOutput.trim();

        // Check if this is a worktree
        const { stdout: gitDirOutput } = await execGit(['rev-parse', '--git-dir'], { cwd });
        const gitDir = gitDirOutput.trim();
        const isWorktree = gitDir.includes('/.git/worktrees/');

        // Find main repo path
        let mainRepoPath = repoPath;
        if (isWorktree) {
          mainRepoPath = gitDir.replace(/\/\.git\/worktrees\/.*$/, '');
        }

        // Check for new worktree-based follow mode
        try {
          const { stdout } = await execGit(['config', 'vibetunnel.followWorktree'], {
            cwd: mainRepoPath,
          });
          const followWorktree = stdout.trim();
          if (followWorktree) {
            // Get branch name from worktree for display
            let branchName = path.basename(followWorktree);
            try {
              const { stdout: branchOutput } = await execGit(['branch', '--show-current'], {
                cwd: followWorktree,
              });
              if (branchOutput.trim()) {
                branchName = branchOutput.trim();
              }
            } catch (_e) {
              // Use directory name as fallback
            }

            followMode = {
              enabled: true,
              branch: branchName,
              repoPath: prettifyPath(followWorktree),
            };
          }
        } catch (_e) {
          // No follow mode configured
        }
      } catch (_error) {
        // Not in a git repo
      }

      const response: StatusResponse = {
        running: true,
        port: this.serverPort,
        url: this.serverUrl,
        version: VERSION,
        buildDate: BUILD_DATE,
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
      const { repoPath, branch, enable, worktreePath, mainRepoPath } = request;

      // Use new fields if available, otherwise fall back to old fields
      const targetMainRepo = mainRepoPath || repoPath;
      if (!targetMainRepo) {
        throw new Error('No repository path provided');
      }

      const absoluteMainRepo = path.resolve(targetMainRepo);
      const absoluteWorktreePath = worktreePath ? path.resolve(worktreePath) : undefined;

      logger.debug(
        `${enable ? 'Enabling' : 'Disabling'} follow mode${absoluteWorktreePath ? ` for worktree: ${absoluteWorktreePath}` : branch ? ` for branch: ${branch}` : ''}`
      );

      if (enable) {
        // Check if Git hooks are already installed
        const hooksAlreadyInstalled = await areHooksInstalled(absoluteMainRepo);

        if (!hooksAlreadyInstalled) {
          // Install Git hooks
          logger.info('Installing Git hooks for follow mode');
          const installResult = await installGitHooks(absoluteMainRepo);

          if (!installResult.success) {
            const response: GitFollowResponse = {
              success: false,
              error: 'Failed to install Git hooks',
            };
            socket.write(MessageBuilder.gitFollowResponse(response));
            return;
          }
        }

        // If we have a worktree path, use that. Otherwise try to find worktree from branch
        let followPath: string;
        let displayName: string;

        if (absoluteWorktreePath) {
          // Direct worktree path provided
          followPath = absoluteWorktreePath;

          // Get the branch name from the worktree for display
          try {
            const { stdout } = await execGit(['branch', '--show-current'], {
              cwd: absoluteWorktreePath,
            });
            displayName = stdout.trim() || path.basename(absoluteWorktreePath);
          } catch {
            displayName = path.basename(absoluteWorktreePath);
          }
        } else if (branch) {
          // Try to find worktree for the branch
          try {
            const { stdout } = await execGit(['worktree', 'list', '--porcelain'], {
              cwd: absoluteMainRepo,
            });

            const lines = stdout.split('\n');
            let foundWorktree: string | undefined;

            for (let i = 0; i < lines.length; i++) {
              if (lines[i].startsWith('worktree ')) {
                const worktreePath = lines[i].substring(9);
                // Check if next lines contain our branch
                if (i + 2 < lines.length && lines[i + 2] === `branch refs/heads/${branch}`) {
                  if (worktreePath !== absoluteMainRepo) {
                    foundWorktree = worktreePath;
                    break;
                  }
                }
              }
            }

            if (!foundWorktree) {
              throw new Error(`No worktree found for branch '${branch}'`);
            }

            followPath = foundWorktree;
            displayName = branch;
          } catch (error) {
            throw new Error(
              `Failed to find worktree: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        } else {
          // No branch or worktree specified - try current branch
          try {
            const { stdout } = await execGit(['branch', '--show-current'], {
              cwd: absoluteMainRepo,
            });
            const currentBranch = stdout.trim();

            if (!currentBranch) {
              throw new Error('Not on a branch (detached HEAD)');
            }

            // Recursively call with the current branch
            return this.handleGitFollowRequest(socket, {
              ...request,
              branch: currentBranch,
            });
          } catch (error) {
            throw new Error(
              `Failed to get current branch: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }

        // Set the follow mode config with worktree path
        await execGit(['config', '--local', 'vibetunnel.followWorktree', followPath], {
          cwd: absoluteMainRepo,
        });

        // Install hooks in both locations
        const mainRepoHooksInstalled = await areHooksInstalled(absoluteMainRepo);
        if (!mainRepoHooksInstalled) {
          logger.info('Installing Git hooks in main repository');
          const installResult = await installGitHooks(absoluteMainRepo);
          if (!installResult.success) {
            throw new Error('Failed to install Git hooks in main repository');
          }
        }

        const worktreeHooksInstalled = await areHooksInstalled(followPath);
        if (!worktreeHooksInstalled) {
          logger.info('Installing Git hooks in worktree');
          const installResult = await installGitHooks(followPath);
          if (!installResult.success) {
            logger.warn('Failed to install Git hooks in worktree, continuing anyway');
          }
        }

        // Send notification to Mac app
        if (controlUnixHandler.isMacAppConnected()) {
          const notification = createControlEvent('system', 'notification', {
            level: 'info',
            title: 'Follow Mode Enabled',
            message: `Now following ${displayName} in ${path.basename(absoluteMainRepo)}`,
          });
          controlUnixHandler.sendToMac(notification);
        }

        const response: GitFollowResponse = {
          success: true,
          currentBranch: displayName,
        };
        socket.write(MessageBuilder.gitFollowResponse(response));
      } else {
        // Disable follow mode
        await execGit(['config', '--local', '--unset', 'vibetunnel.followWorktree'], {
          cwd: absoluteMainRepo,
        });

        // Get the worktree path that was being followed
        let followedWorktree: string | undefined;
        try {
          const { stdout } = await execGit(['config', 'vibetunnel.followWorktree'], {
            cwd: absoluteMainRepo,
          });
          followedWorktree = stdout.trim();
        } catch {
          // No worktree was being followed
        }

        // Uninstall Git hooks from main repo
        logger.info('Uninstalling Git hooks from main repository');
        const mainUninstallResult = await uninstallGitHooks(absoluteMainRepo);

        // Also uninstall from worktree if we know which one was being followed
        if (followedWorktree && followedWorktree !== absoluteMainRepo) {
          logger.info('Uninstalling Git hooks from worktree');
          const worktreeUninstallResult = await uninstallGitHooks(followedWorktree);
          if (!worktreeUninstallResult.success) {
            logger.warn(
              'Failed to uninstall some Git hooks from worktree:',
              worktreeUninstallResult.errors
            );
          }
        }

        if (!mainUninstallResult.success) {
          logger.warn(
            'Failed to uninstall some Git hooks from main repo:',
            mainUninstallResult.errors
          );
          // Continue anyway - follow mode is still disabled
        } else {
          logger.info('Git hooks uninstalled successfully from main repository');
        }

        // Send notification to Mac app
        if (controlUnixHandler.isMacAppConnected()) {
          const notification = createControlEvent('system', 'notification', {
            level: 'info',
            title: 'Follow Mode Disabled',
            message: `Follow mode disabled in ${path.basename(absoluteMainRepo)}`,
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
    logger.debug(`Git event notification received: ${event.type} for ${event.repoPath}`);

    try {
      // Forward the event to the HTTP endpoint which contains the sync logic
      const port = this.serverPort || 4020;
      const url = `http://localhost:${port}/api/git/event`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repoPath: event.repoPath,
          event: event.type,
          // Branch information would need to be extracted from git hooks
          // For now, we'll let the endpoint handle branch detection
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP endpoint returned ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      logger.debug('Git event processed successfully:', result);

      const ack: GitEventAck = {
        handled: true,
      };
      socket.write(MessageBuilder.gitEventAck(ack));
    } catch (error) {
      logger.error('Failed to forward git event to HTTP endpoint:', error);

      const ack: GitEventAck = {
        handled: false,
      };
      socket.write(MessageBuilder.gitEventAck(ack));
    }
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
