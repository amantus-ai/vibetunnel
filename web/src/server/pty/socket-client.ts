/**
 * Client for connecting to VibeTunnel Unix sockets
 */

import { EventEmitter } from 'events';
import * as net from 'net';
import { createLogger } from '../utils/logger.js';
import {
  type ErrorMessage,
  MessageBuilder,
  MessageParser,
  MessageType,
  parsePayload,
  type StatusUpdate,
} from './socket-protocol.js';

const logger = createLogger('socket-client');

export interface SocketClientEvents {
  connect: () => void;
  disconnect: (error?: Error) => void;
  error: (error: Error) => void;
  status: (status: StatusUpdate) => void;
  serverError: (error: ErrorMessage) => void;
}

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

      switch (type) {
        case MessageType.STATUS_UPDATE:
          this.emit('status', data as StatusUpdate);
          break;

        case MessageType.ERROR:
          this.emit('serverError', data as ErrorMessage);
          break;

        case MessageType.HEARTBEAT:
          this.lastHeartbeat = Date.now();
          // Echo heartbeat back
          this.sendHeartbeat();
          break;

        default:
          logger.debug(`Received unexpected message type: ${type}`);
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
