/**
 * Socket API client for VibeTunnel control operations
 * Used by the vt command to communicate with the server via Unix socket
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { VibeTunnelSocketClient } from './pty/socket-client.js';
import {
  GitEventAck,
  GitEventNotify,
  GitFollowRequest,
  GitFollowResponse,
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
    const homeDir = os.homedir();
    this.controlSocketPath = path.join(homeDir, '.vibetunnel', 'control.sock');
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
          reject(new Error((data as any).message || 'Server error'));
        }
      };

      // Override the handleMessage method to intercept messages
      (client as any).handleMessage = handleMessage;

      client.connect()
        .then(() => {
          // Send the request
          const message = (type === MessageType.GIT_FOLLOW_REQUEST)
            ? (client as any).send((client as any).constructor.prototype.constructor.MessageBuilder.gitFollowRequest(payload))
            : (client as any).send((client as any).constructor.prototype.constructor.MessageBuilder.gitEventNotify(payload));
          
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
      // For now, we'll check if we can connect to the socket
      // In the future, we can add a STATUS_REQUEST message type
      const client = new VibeTunnelSocketClient(this.controlSocketPath);
      await client.connect();
      client.disconnect();
      
      // If we can connect, server is running
      // We don't have port info via socket yet
      return { 
        running: true,
        port: parseInt(process.env.VIBETUNNEL_PORT || '4020'),
        url: `http://localhost:${process.env.VIBETUNNEL_PORT || '4020'}`
      };
    } catch (error) {
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