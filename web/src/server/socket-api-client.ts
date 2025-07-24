/**
 * Socket API client for VibeTunnel control operations
 * Used by the vt command to communicate with the server via Unix socket
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { VibeTunnelSocketClient } from './pty/socket-client.js';
import {
  type GitEventAck,
  type GitEventNotify,
  type GitFollowRequest,
  type GitFollowResponse,
  MessageType,
} from './pty/socket-protocol.js';
import { createLogger } from './utils/logger.js';

const logger = createLogger('socket-api');

export interface ServerStatus {
  running: boolean;
  port?: number;
  url?: string;
  followMode?: {
    enabled: boolean;
    branch?: string;
    repoPath?: string;
  };
}

/**
 * Client for control socket operations
 */
export class SocketApiClient {
  private readonly controlSocketPath: string;

  constructor() {
    // Use control directory from environment or default
    const controlDir = process.env.VIBETUNNEL_CONTROL_DIR || path.join(os.homedir(), '.vibetunnel');
    // Use api.sock instead of control.sock to avoid conflicts with Mac app
    this.controlSocketPath = path.join(controlDir, 'api.sock');
  }

  /**
   * Check if the control socket exists
   */
  private isSocketAvailable(): boolean {
    return fs.existsSync(this.controlSocketPath);
  }

  /**
   * Send a request and wait for response
   */
  private async sendRequest<TRequest, TResponse>(
    type: MessageType,
    payload: TRequest,
    responseType: MessageType,
    timeout = 5000
  ): Promise<TResponse> {
    if (!this.isSocketAvailable()) {
      throw new Error('VibeTunnel server is not running');
    }

    const client = new VibeTunnelSocketClient(this.controlSocketPath);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        client.disconnect();
        reject(new Error('Request timeout'));
      }, timeout);

      let responseReceived = false;

      client.on('error', (error) => {
        clearTimeout(timer);
        if (!responseReceived) {
          reject(error);
        }
      });

      // Handle the specific response type we're expecting
      const handleMessage = (msgType: MessageType, data: unknown) => {
        if (msgType === responseType) {
          responseReceived = true;
          clearTimeout(timer);
          client.disconnect();
          resolve(data as TResponse);
        } else if (msgType === MessageType.ERROR) {
          responseReceived = true;
          clearTimeout(timer);
          client.disconnect();
          reject(new Error((data as { message?: string }).message || 'Server error'));
        }
      };

      // Override the handleMessage method to intercept messages
      (client as unknown as { handleMessage: typeof handleMessage }).handleMessage = handleMessage;

      client
        .connect()
        .then(() => {
          // Send the request
          let message: unknown;
          switch (type) {
            case MessageType.STATUS_REQUEST:
              message = (client as unknown as { send: (msg: unknown) => unknown }).send(
                (
                  client as unknown as {
                    constructor: {
                      prototype: {
                        constructor: {
                          MessageBuilder: Record<string, (...args: unknown[]) => unknown>;
                        };
                      };
                    };
                  }
                ).constructor.prototype.constructor.MessageBuilder.statusRequest()
              );
              break;
            case MessageType.GIT_FOLLOW_REQUEST:
              message = (client as unknown as { send: (msg: unknown) => unknown }).send(
                (
                  client as unknown as {
                    constructor: {
                      prototype: {
                        constructor: {
                          MessageBuilder: Record<string, (...args: unknown[]) => unknown>;
                        };
                      };
                    };
                  }
                ).constructor.prototype.constructor.MessageBuilder.gitFollowRequest(payload)
              );
              break;
            case MessageType.GIT_EVENT_NOTIFY:
              message = (client as unknown as { send: (msg: unknown) => unknown }).send(
                (
                  client as unknown as {
                    constructor: {
                      prototype: {
                        constructor: {
                          MessageBuilder: Record<string, (...args: unknown[]) => unknown>;
                        };
                      };
                    };
                  }
                ).constructor.prototype.constructor.MessageBuilder.gitEventNotify(payload)
              );
              break;
            default:
              clearTimeout(timer);
              reject(new Error(`Unsupported message type: ${type}`));
              return;
          }

          if (!message) {
            clearTimeout(timer);
            reject(new Error('Failed to send request'));
          }
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Get server status
   */
  async getStatus(): Promise<ServerStatus> {
    if (!this.isSocketAvailable()) {
      return { running: false };
    }

    try {
      // Send STATUS_REQUEST and wait for STATUS_RESPONSE
      const response = await this.sendRequest<Record<string, never>, ServerStatus>(
        MessageType.STATUS_REQUEST,
        {},
        MessageType.STATUS_RESPONSE
      );
      return response;
    } catch (error) {
      logger.error('Failed to get server status:', error);
      return { running: false };
    }
  }

  /**
   * Enable or disable Git follow mode
   */
  async setFollowMode(request: GitFollowRequest): Promise<GitFollowResponse> {
    return this.sendRequest<GitFollowRequest, GitFollowResponse>(
      MessageType.GIT_FOLLOW_REQUEST,
      request,
      MessageType.GIT_FOLLOW_RESPONSE
    );
  }

  /**
   * Send Git event notification
   */
  async sendGitEvent(event: GitEventNotify): Promise<GitEventAck> {
    return this.sendRequest<GitEventNotify, GitEventAck>(
      MessageType.GIT_EVENT_NOTIFY,
      event,
      MessageType.GIT_EVENT_ACK
    );
  }
}
