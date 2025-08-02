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
  type MessagePayload,
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
  private readonly controlDir: string;

  constructor() {
    // Use control directory from environment or default
    this.controlDir = process.env.VIBETUNNEL_CONTROL_DIR || path.join(os.homedir(), '.vibetunnel');
    // Use api.sock instead of control.sock to avoid conflicts with Mac app
    this.controlSocketPath = path.join(this.controlDir, 'api.sock');

    logger.debug(`SocketApiClient initialized with control directory: ${this.controlDir}`);
    logger.debug(`Socket path: ${this.controlSocketPath}`);
  }

  /**
   * Check if the control socket exists
   */
  private isSocketAvailable(): boolean {
    const available = fs.existsSync(this.controlSocketPath);
    logger.debug(
      `Socket availability check: ${this.controlSocketPath} - ${available ? 'available' : 'not available'}`
    );
    return available;
  }

  /**
   * Send a request and wait for response
   */
  private async sendRequest<TRequest extends MessageType, TResponse>(
    type: TRequest,
    payload: MessagePayload<TRequest>,
    responseType: MessageType,
    timeout = 5000
  ): Promise<TResponse> {
    if (!this.isSocketAvailable()) {
      throw new Error('VibeTunnel server is not running');
    }

    const client = new VibeTunnelSocketClient(this.controlSocketPath);

    try {
      await client.connect();
      const response = await client.sendMessageWithResponse(type, payload, responseType, timeout);
      return response as TResponse;
    } catch (error) {
      if (error instanceof Error && error.message.includes('ENOENT')) {
        throw new Error('VibeTunnel server is not running');
      }
      throw error;
    } finally {
      client.disconnect();
    }
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
      const response = await this.sendRequest<MessageType.STATUS_REQUEST, ServerStatus>(
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
    return this.sendRequest<MessageType.GIT_FOLLOW_REQUEST, GitFollowResponse>(
      MessageType.GIT_FOLLOW_REQUEST,
      request,
      MessageType.GIT_FOLLOW_RESPONSE
    );
  }

  /**
   * Send Git event notification
   */
  async sendGitEvent(event: GitEventNotify): Promise<GitEventAck> {
    return this.sendRequest<MessageType.GIT_EVENT_NOTIFY, GitEventAck>(
      MessageType.GIT_EVENT_NOTIFY,
      event,
      MessageType.GIT_EVENT_ACK
    );
  }
}
