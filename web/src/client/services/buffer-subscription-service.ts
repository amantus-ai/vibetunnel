import { createLogger } from '../utils/logger.js';
import type { BufferCell } from '../utils/terminal-renderer.js';
import { authClient } from './auth-client.js';

const logger = createLogger('buffer-subscription-service');

interface BufferSnapshot {
  cols: number;
  rows: number;
  viewportY: number;
  cursorX: number;
  cursorY: number;
  cells: BufferCell[][];
}

type BufferUpdateHandler = (snapshot: BufferSnapshot) => void;

// Magic byte for binary messages
const BUFFER_MAGIC_BYTE = 0xbf;

export class BufferSubscriptionService {
  private ws: WebSocket | null = null;
  private subscriptions = new Map<string, Set<BufferUpdateHandler>>();
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private pingInterval: number | null = null;
  private isConnecting = false;
  private messageQueue: Array<{ type: string; sessionId?: string }> = [];

  constructor() {
    this.connect();
  }

  private connect() {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.isConnecting = true;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

    // Get auth token for WebSocket connection
    const currentUser = authClient.getCurrentUser();
    const token = currentUser?.token;

    // Build WebSocket URL with token as query parameter
    let wsUrl = `${protocol}//${window.location.host}/buffers`;
    if (token) {
      wsUrl += `?token=${encodeURIComponent(token)}`;
    }

    logger.log(`connecting to ${wsUrl}`);

    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        logger.log('connected');
        this.isConnecting = false;
        this.reconnectAttempts = 0;

        // Start ping/pong
        this.startPingPong();

        // Send any queued messages
        while (this.messageQueue.length > 0) {
          const message = this.messageQueue.shift();
          if (message) {
            this.sendMessage(message);
          }
        }

        // Re-subscribe to all sessions
        this.subscriptions.forEach((_, sessionId) => {
          this.sendMessage({ type: 'subscribe', sessionId });
        });
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onerror = (error) => {
        logger.error('websocket error', error);
      };

      this.ws.onclose = () => {
        logger.log('disconnected');
        this.isConnecting = false;
        this.ws = null;
        this.stopPingPong();
        this.scheduleReconnect();
      };
    } catch (error) {
      logger.error('failed to create websocket', error);
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;

    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);
    this.reconnectAttempts++;

    logger.log(`reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startPingPong() {
    this.stopPingPong();

    // Respond to pings with pongs
    this.pingInterval = window.setInterval(() => {
      // Ping handling is done in handleMessage
    }, 10000);
  }

  private stopPingPong() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private sendMessage(message: { type: string; sessionId?: string }) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Queue message for when we reconnect
      if (message.type === 'subscribe' || message.type === 'unsubscribe') {
        this.messageQueue.push(message);
      }
      return;
    }

    this.ws.send(JSON.stringify(message));
  }

  private handleMessage(data: ArrayBuffer | string) {
    // Check if it's binary (buffer update) or text (JSON)
    if (data instanceof ArrayBuffer) {
      this.handleBinaryMessage(data);
    } else {
      this.handleJsonMessage(data);
    }
  }

  private handleJsonMessage(data: string) {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case 'connected':
          // Server confirmed connection, version info available in message.version
          logger.log(`connected to server, version: ${message.version}`);
          break;

        case 'subscribed':
          // Server confirmed subscription to session
          logger.debug(`subscribed to session: ${message.sessionId}`);
          break;

        case 'ping':
          this.sendMessage({ type: 'pong' });
          break;

        case 'error':
          logger.error(`server error: ${message.message}`);
          break;

        default:
          logger.warn(`unknown message type: ${message.type}`);
      }
    } catch (error) {
      logger.error('failed to parse JSON message', error);
    }
  }

  private handleBinaryMessage(data: ArrayBuffer) {
    try {
      const view = new DataView(data);
      let offset = 0;

      // Check magic byte
      const magic = view.getUint8(offset);
      offset += 1;

      if (magic !== BUFFER_MAGIC_BYTE) {
        logger.error(`invalid magic byte: ${magic}`);
        return;
      }

      // Read session ID length
      const sessionIdLength = view.getUint32(offset, true);
      offset += 4;

      // Read session ID
      const sessionIdBytes = new Uint8Array(data, offset, sessionIdLength);
      const sessionId = new TextDecoder().decode(sessionIdBytes);
      offset += sessionIdLength;

      // Remaining data is the buffer
      const bufferData = data.slice(offset);

      // Import TerminalRenderer dynamically to avoid circular dependencies
      import('../utils/terminal-renderer.js')
        .then(({ TerminalRenderer }) => {
          try {
            const snapshot = TerminalRenderer.decodeBinaryBuffer(bufferData);

            // Notify all handlers for this session
            const handlers = this.subscriptions.get(sessionId);
            if (handlers) {
              handlers.forEach((handler) => {
                try {
                  handler(snapshot);
                } catch (error) {
                  logger.error('error in update handler', error);
                }
              });
            }
          } catch (error) {
            logger.error('failed to decode binary buffer', error);
          }
        })
        .catch((error) => {
          logger.error('failed to import terminal renderer', error);
        });
    } catch (error) {
      logger.error('failed to parse binary message', error);
    }
  }

  /**
   * Subscribe to buffer updates for a session
   * Returns an unsubscribe function
   */
  subscribe(sessionId: string, handler: BufferUpdateHandler): () => void {
    // Add handler to subscriptions
    if (!this.subscriptions.has(sessionId)) {
      this.subscriptions.set(sessionId, new Set());

      // Send subscribe message if connected
      this.sendMessage({ type: 'subscribe', sessionId });
    }

    const handlers = this.subscriptions.get(sessionId);
    if (handlers) {
      handlers.add(handler);
    }

    // Return unsubscribe function
    return () => {
      const handlers = this.subscriptions.get(sessionId);
      if (handlers) {
        handlers.delete(handler);

        // If no more handlers, unsubscribe from session
        if (handlers.size === 0) {
          this.subscriptions.delete(sessionId);
          this.sendMessage({ type: 'unsubscribe', sessionId });
        }
      }
    };
  }

  /**
   * Clean up and close connection
   */
  dispose() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.stopPingPong();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.subscriptions.clear();
    this.messageQueue = [];
  }
}

// Create singleton instance
export const bufferSubscriptionService = new BufferSubscriptionService();
