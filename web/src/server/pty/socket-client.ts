/**
 * Client for connecting to VibeTunnel Unix sockets
 */

import { EventEmitter } from 'events';
import * as net from 'net';
import { createLogger } from '../utils/logger.js';
import {
  type ControlCommand,
  type ErrorMessage,
  frameMessage,
  type GitEventNotify,
  type GitFollowRequest,
  type KillCommand,
  MessageBuilder,
  MessageParser,
  type MessagePayload,
  MessageType,
  parsePayload,
  type ResizeCommand,
  type StatusUpdate,
  type UpdateTitleCommand,
} from './socket-protocol.js';

const logger = createLogger('socket-client');

export interface SocketClientEvents {
  connect: () => void;
  disconnect: (error?: Error) => void;
  error: (error: Error) => void;
  // Message-specific events are emitted using MessageType enum names
  // e.g., 'STATUS_UPDATE', 'ERROR', 'HEARTBEAT', etc.
}

/**
 * Unix socket client for communication between VibeTunnel web server and terminal processes.
 *
 * This class provides a robust client for connecting to Unix domain sockets with automatic
 * reconnection, heartbeat support, and message parsing using the VibeTunnel socket protocol.
 * It handles terminal control operations like stdin input, resizing, and process management.
 *
 * Key features:
 * - Automatic reconnection with configurable delay
 * - Heartbeat mechanism to detect connection health
 * - Binary message protocol with length-prefixed framing
 * - Event-based API for handling connection state and messages
 * - macOS socket path length validation (104 char limit)
 *
 * @example
 * ```typescript
 * // Create a client for a terminal session
 * const client = new VibeTunnelSocketClient('/tmp/vibetunnel/session-123.sock', {
 *   autoReconnect: true,
 *   heartbeatInterval: 30000
 * });
 *
 * // Listen for events
 * client.on('connect', () => console.log('Connected to terminal'));
 * client.on('status', (status) => console.log('Terminal status:', status));
 * client.on('error', (error) => console.error('Socket error:', error));
 *
 * // Connect and send commands
 * await client.connect();
 * client.sendStdin('ls -la\n');
 * client.resize(80, 24);
 * ```
 *
 * @extends EventEmitter
 */
export class VibeTunnelSocketClient extends EventEmitter {
  private socket?: net.Socket;
  private parser = new MessageParser();
  private connected = false;
  private reconnectTimer?: NodeJS.Timeout;
  private readonly reconnectDelay = 1000;
  private heartbeatInterval?: NodeJS.Timeout;
  private lastHeartbeat = Date.now();

  constructor(
    private readonly socketPath: string,
    private readonly options: {
      autoReconnect?: boolean;
      heartbeatInterval?: number;
    } = {}
  ) {
    super();

    // IMPORTANT: macOS has a 104 character limit for Unix socket paths
    // If you get EINVAL errors when connecting, the path is likely too long
    if (socketPath.length > 103) {
      logger.warn(`Socket path may be too long (${socketPath.length} chars): ${socketPath}`);
    }
  }

  /**
   * Connect to the socket
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.connected) {
        resolve();
        return;
      }

      this.socket = net.createConnection(this.socketPath);
      this.socket.setNoDelay(true);
      this.socket.setKeepAlive(true, 0);

      const onConnect = () => {
        this.connected = true;
        this.setupSocketHandlers();
        this.emit('connect');
        this.startHeartbeat();
        cleanup();
        resolve();
      };

      const onError = (error: Error) => {
        cleanup();
        // Destroy the socket to prevent further errors
        this.socket?.destroy();
        this.socket = undefined;
        reject(error);
      };

      const cleanup = () => {
        this.socket?.off('connect', onConnect);
        this.socket?.off('error', onError);
      };

      this.socket.once('connect', onConnect);
      this.socket.once('error', onError);
    });
  }

  /**
   * Setup socket event handlers
   */
  private setupSocketHandlers(): void {
    if (!this.socket) return;

    this.socket.on('data', (chunk) => {
      this.parser.addData(chunk);

      for (const { type, payload } of this.parser.parseMessages()) {
        this.handleMessage(type, payload);
      }
    });

    this.socket.on('close', () => {
      this.handleDisconnect();
    });

    this.socket.on('error', (error) => {
      logger.error(`Socket error on ${this.socketPath}:`, error);
      this.emit('error', error);
    });
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(type: MessageType, payload: Buffer): void {
    try {
      const data = parsePayload(type, payload);

      // Emit event with message type enum name
      this.emit(MessageType[type], data);

      // Handle heartbeat
      if (type === MessageType.HEARTBEAT) {
        this.lastHeartbeat = Date.now();
        // Echo heartbeat back
        this.sendHeartbeat();
      }
    } catch (error) {
      logger.error('Failed to parse message:', error);
    }
  }

  /**
   * Handle disconnection
   */
  private handleDisconnect(error?: Error): void {
    this.connected = false;
    this.stopHeartbeat();
    this.emit('disconnect', error);

    if (this.options.autoReconnect && !this.reconnectTimer) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = undefined;
        this.connect().catch((err) => {
          logger.debug(`Reconnection failed: ${err.message}`);
          this.handleDisconnect(err);
        });
      }, this.reconnectDelay);
    }
  }

  /**
   * Start heartbeat
   */
  private startHeartbeat(): void {
    if (this.options.heartbeatInterval) {
      this.heartbeatInterval = setInterval(() => {
        this.sendHeartbeat();
      }, this.options.heartbeatInterval);
    }
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }

  /**
   * Send data to stdin
   */
  sendStdin(data: string): boolean {
    return this.send(MessageBuilder.stdin(data));
  }

  /**
   * Send resize command
   */
  resize(cols: number, rows: number): boolean {
    return this.send(MessageBuilder.resize(cols, rows));
  }

  /**
   * Send kill command
   */
  kill(signal?: string | number): boolean {
    return this.send(MessageBuilder.kill(signal));
  }

  /**
   * Send reset size command
   */
  resetSize(): boolean {
    return this.send(MessageBuilder.resetSize());
  }

  /**
   * Send update title command
   */
  updateTitle(title: string): boolean {
    return this.send(MessageBuilder.updateTitle(title));
  }

  /**
   * Send status update
   */
  sendStatus(app: string, status: string, extra?: Record<string, unknown>): boolean {
    return this.send(MessageBuilder.status(app, status, extra));
  }

  /**
   * Send a message with type-safe payload
   */
  public sendMessage<T extends MessageType>(type: T, payload: MessagePayload<T>): boolean {
    const message = this.buildMessage(type, payload);
    return this.send(message);
  }

  /**
   * Send a message and wait for a response
   */
  public async sendMessageWithResponse<TRequest extends MessageType, TResponse extends MessageType>(
    requestType: TRequest,
    payload: MessagePayload<TRequest>,
    responseType: TResponse,
    timeout = 5000
  ): Promise<MessagePayload<TResponse>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off(MessageType[responseType], handleResponse);
        this.off('error', handleError);
        reject(new Error(`Request timeout waiting for ${MessageType[responseType]}`));
      }, timeout);

      const handleResponse = (data: MessagePayload<TResponse>) => {
        clearTimeout(timer);
        this.off('error', handleError);
        resolve(data);
      };

      const handleError = (error: Error | ErrorMessage) => {
        clearTimeout(timer);
        this.off(MessageType[responseType], handleResponse);
        if ('message' in error) {
          reject(new Error(error.message));
        } else {
          reject(error);
        }
      };

      // Listen for response
      this.once(MessageType[responseType], handleResponse);
      this.once('error', handleError);

      const sent = this.sendMessage(requestType, payload);
      if (!sent) {
        clearTimeout(timer);
        this.off(MessageType[responseType], handleResponse);
        this.off('error', handleError);
        reject(new Error('Failed to send message'));
      }
    });
  }

  /**
   * Build a message buffer from type and payload
   */
  private buildMessage<T extends MessageType>(type: T, payload: MessagePayload<T>): Buffer {
    switch (type) {
      case MessageType.STDIN_DATA:
        return MessageBuilder.stdin(payload as string);
      case MessageType.CONTROL_CMD: {
        const cmd = payload as ControlCommand;
        switch (cmd.cmd) {
          case 'resize':
            return MessageBuilder.resize((cmd as ResizeCommand).cols, (cmd as ResizeCommand).rows);
          case 'kill':
            return MessageBuilder.kill((cmd as KillCommand).signal);
          case 'reset-size':
            return MessageBuilder.resetSize();
          case 'update-title':
            return MessageBuilder.updateTitle((cmd as UpdateTitleCommand).title);
          default:
            // For generic control commands, use frameMessage directly
            return frameMessage(MessageType.CONTROL_CMD, cmd);
        }
      }
      case MessageType.STATUS_UPDATE: {
        const statusPayload = payload as StatusUpdate;
        return MessageBuilder.status(
          statusPayload.app,
          statusPayload.status,
          statusPayload.extra as Record<string, unknown> | undefined
        );
      }
      case MessageType.HEARTBEAT:
        return MessageBuilder.heartbeat();
      case MessageType.STATUS_REQUEST:
        return MessageBuilder.statusRequest();
      case MessageType.GIT_FOLLOW_REQUEST:
        return MessageBuilder.gitFollowRequest(payload as GitFollowRequest);
      case MessageType.GIT_EVENT_NOTIFY:
        return MessageBuilder.gitEventNotify(payload as GitEventNotify);
      default:
        throw new Error(`Unsupported message type: ${type}`);
    }
  }

  /**
   * Send heartbeat
   */
  private sendHeartbeat(): boolean {
    return this.send(MessageBuilder.heartbeat());
  }

  /**
   * Send raw message
   */
  private send(message: Buffer): boolean {
    if (!this.connected || !this.socket) {
      logger.debug('Cannot send message: not connected');
      return false;
    }

    try {
      return this.socket.write(message);
    } catch (error) {
      logger.error('Failed to send message:', error);
      return false;
    }
  }

  /**
   * Disconnect from the socket
   */
  disconnect(): void {
    this.options.autoReconnect = false;
    this.connected = false;
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.socket) {
      this.socket.destroy();
      this.socket = undefined;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get time since last heartbeat
   */
  getTimeSinceLastHeartbeat(): number {
    return Date.now() - this.lastHeartbeat;
  }
}
