/**
 * Buffer Subscription Service
 *
 * Real-time WebSocket service for subscribing to terminal buffer updates.
 * This service provides a high-performance binary protocol for streaming
 * terminal screen content to web clients, enabling live terminal viewing.
 *
 * ## Architecture
 * - WebSocket-based bidirectional communication
 * - Binary protocol for efficient buffer transmission
 * - Automatic reconnection with exponential backoff
 * - Per-session subscription management
 * - Dynamic import of renderer to avoid circular dependencies
 *
 * ## Protocol Details
 *
 * ### Text Messages (JSON)
 * - Client → Server: `{type: 'subscribe', sessionId: 'xxx'}`
 * - Client → Server: `{type: 'unsubscribe', sessionId: 'xxx'}`
 * - Server → Client: `{type: 'connected', version: '1.0'}`
 * - Server → Client: `{type: 'ping'}` / Client → Server: `{type: 'pong'}`
 *
 * ### Binary Messages (Buffer Updates)
 * Binary format for terminal buffer updates:
 * ```
 * [0]      Magic byte (0xBF)
 * [1-4]    Session ID length (uint32, little-endian)
 * [5-n]    Session ID (UTF-8 string)
 * [n+1...] Terminal buffer data (see TerminalRenderer.decodeBinaryBuffer)
 * ```
 *
 * ## Usage Example
 * ```typescript
 * import { bufferSubscriptionService } from './buffer-subscription-service.js';
 *
 * // Initialize the service (connects automatically)
 * await bufferSubscriptionService.initialize();
 *
 * // Subscribe to a session's buffer updates
 * const unsubscribe = bufferSubscriptionService.subscribe(
 *   'session-123',
 *   (snapshot) => {
 *     console.log(`Terminal size: ${snapshot.cols}x${snapshot.rows}`);
 *     console.log(`Cursor at: ${snapshot.cursorX},${snapshot.cursorY}`);
 *     // Render the terminal cells
 *     renderTerminal(snapshot.cells);
 *   }
 * );
 *
 * // Later: unsubscribe when done
 * unsubscribe();
 * ```
 *
 * @see web/src/server/services/buffer-aggregator.ts for server-side implementation
 * @see web/src/client/utils/terminal-renderer.ts for buffer decoding
 * @see web/src/client/components/vibe-terminal-binary.ts for UI integration
 */

import { createLogger } from '../utils/logger.js';
import type { BufferCell } from '../utils/terminal-renderer.js';
import { authClient } from './auth-client.js';

const logger = createLogger('buffer-subscription-service');

/**
 * Terminal buffer snapshot
 *
 * Represents the complete state of a terminal screen at a point in time.
 * This is decoded from the binary protocol and passed to update handlers.
 *
 * @property cols - Terminal width in columns
 * @property rows - Terminal height in rows
 * @property viewportY - Current scroll position (top visible row)
 * @property cursorX - Cursor column position (0-based)
 * @property cursorY - Cursor row position (0-based)
 * @property cells - 2D array of terminal cells [row][col]
 */
interface BufferSnapshot {
  cols: number;
  rows: number;
  viewportY: number;
  cursorX: number;
  cursorY: number;
  cells: BufferCell[][];
}

/**
 * Callback function for buffer updates
 *
 * Called whenever a new terminal buffer snapshot is received
 * for a subscribed session.
 */
type BufferUpdateHandler = (snapshot: BufferSnapshot) => void;

// Magic byte for binary messages - identifies buffer update packets
const BUFFER_MAGIC_BYTE = 0xbf;

/**
 * BufferSubscriptionService manages WebSocket connections for real-time
 * terminal buffer streaming. It handles connection lifecycle, authentication,
 * and efficient binary protocol communication.
 *
 * ## Features
 * - Singleton pattern for global access
 * - Lazy initialization (connects on first use)
 * - Automatic reconnection with exponential backoff
 * - Message queuing during disconnection
 * - Support for both authenticated and no-auth modes
 * - Efficient binary protocol for buffer updates
 * - Per-session subscription management
 */
export class BufferSubscriptionService {
  private ws: WebSocket | null = null;
  private subscriptions = new Map<string, Set<BufferUpdateHandler>>();
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private pingInterval: number | null = null;
  private isConnecting = false;
  private messageQueue: Array<{ type: string; sessionId?: string }> = [];

  private initialized = false;
  private noAuthMode: boolean | null = null;

  // biome-ignore lint/complexity/noUselessConstructor: This constructor documents the intentional design decision to not auto-connect
  constructor() {
    // Do not connect automatically - wait for initialize() to be called
  }

  /**
   * Initialize the buffer subscription service and connect to WebSocket
   *
   * This method should be called after authentication is complete. It checks
   * the authentication configuration and establishes the WebSocket connection.
   *
   * The initialization is idempotent - calling it multiple times has no effect
   * after the first successful initialization.
   *
   * @example
   * ```typescript
   * // Initialize after auth is ready
   * await bufferSubscriptionService.initialize();
   *
   * // Safe to call multiple times
   * await bufferSubscriptionService.initialize(); // No-op
   * ```
   */
  async initialize() {
    if (this.initialized) return;
    this.initialized = true;

    // Check no-auth mode
    await this.checkNoAuthMode();

    // Add a small delay to ensure auth token is fully loaded and verified
    setTimeout(() => {
      this.connect();
    }, 100);
  }

  private async checkNoAuthMode(): Promise<void> {
    try {
      const response = await fetch('/api/auth/config');
      if (response.ok) {
        const config = await response.json();
        this.noAuthMode = config.noAuth === true;
      }
    } catch (error) {
      logger.warn('Failed to check auth config:', error);
      this.noAuthMode = false;
    }
  }

  private isNoAuthMode(): boolean {
    return this.noAuthMode === true;
  }

  /**
   * Establish WebSocket connection to the buffer streaming endpoint
   *
   * Connection flow:
   * 1. Check if already connecting or connected
   * 2. Verify authentication token (unless in no-auth mode)
   * 3. Build WebSocket URL with token as query parameter
   * 4. Create WebSocket with binary arraybuffer support
   * 5. Set up event handlers for open, message, error, close
   * 6. Re-subscribe to all sessions on reconnection
   *
   * The connection uses the same protocol (ws/wss) as the page
   * and includes the auth token in the query string for authentication.
   */
  private connect() {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    // Get auth token for WebSocket connection
    const currentUser = authClient.getCurrentUser();
    const token = currentUser?.token;

    // Don't connect if we don't have a valid token (unless in no-auth mode)
    if (!token && !this.isNoAuthMode()) {
      logger.warn('No auth token available, postponing WebSocket connection');
      // Retry connection after a delay
      setTimeout(() => {
        if (this.initialized && !this.ws) {
          this.connect();
        }
      }, 1000);
      return;
    }

    this.isConnecting = true;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

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

  /**
   * Handle incoming binary message containing terminal buffer data
   *
   * Decodes the binary protocol:
   * 1. Validates magic byte (0xBF)
   * 2. Extracts session ID length and session ID
   * 3. Extracts terminal buffer data
   * 4. Dynamically imports TerminalRenderer to decode buffer
   * 5. Notifies all handlers for the session
   *
   * The dynamic import prevents circular dependencies between
   * the service and renderer modules.
   *
   * @param data - Raw binary data from WebSocket
   */
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
   *
   * Creates a subscription to receive real-time terminal buffer updates for
   * the specified session. The handler will be called whenever new buffer
   * data is received from the server.
   *
   * **Important behaviors:**
   * - Automatically initializes the service if not already initialized
   * - Multiple handlers can be registered for the same session
   * - Subscriptions persist across reconnections
   * - The returned unsubscribe function removes only the specific handler
   *
   * @param sessionId - Unique identifier of the terminal session
   * @param handler - Callback function to receive buffer updates
   * @returns Unsubscribe function to stop receiving updates
   *
   * @example
   * ```typescript
   * // Subscribe to a session
   * const unsubscribe = bufferSubscriptionService.subscribe(
   *   'session-abc123',
   *   (snapshot) => {
   *     // Update terminal display
   *     terminal.render(snapshot);
   *   }
   * );
   *
   * // Multiple subscriptions to same session
   * const unsubscribe2 = bufferSubscriptionService.subscribe(
   *   'session-abc123',
   *   (snapshot) => {
   *     // Log cursor position
   *     console.log(`Cursor: ${snapshot.cursorX},${snapshot.cursorY}`);
   *   }
   * );
   *
   * // Cleanup when done
   * unsubscribe();  // First handler removed
   * unsubscribe2(); // Second handler removed, session unsubscribed
   * ```
   */
  subscribe(sessionId: string, handler: BufferUpdateHandler): () => void {
    // Ensure service is initialized when first subscription happens
    if (!this.initialized) {
      this.initialize();
    }

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
   *
   * Gracefully shuts down the WebSocket connection and cleans up all resources.
   * This method should be called when the service is no longer needed, such as
   * during application shutdown or logout.
   *
   * **Cleanup actions:**
   * - Cancels any pending reconnection attempts
   * - Stops ping/pong heartbeat
   * - Closes the WebSocket connection
   * - Clears all subscriptions
   * - Empties the message queue
   *
   * @example
   * ```typescript
   * // During logout or cleanup
   * bufferSubscriptionService.dispose();
   *
   * // Service can be re-initialized later if needed
   * await bufferSubscriptionService.initialize();
   * ```
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
