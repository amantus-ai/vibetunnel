/**
 * WebSocket Input Client for VibeTunnel
 *
 * Provides low-latency input transmission via WebSocket connection
 * with automatic reconnection and fallback to HTTP.
 *
 * Optimized for absolute minimal latency:
 * - Fire-and-forget input (no ACKs)
 * - Raw text transmission (no JSON overhead)
 * - Single persistent connection per session
 */

import type { Session } from '../../shared/types.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('websocket-input-client');

export class WebSocketInputClient {
  private ws: WebSocket | null = null;
  private session: Session | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private connectionPromise: Promise<void> | null = null;
  private isConnecting = false;

  // Configuration
  private readonly RECONNECT_DELAY = 1000;
  private readonly MAX_RECONNECT_DELAY = 5000;

  constructor() {
    this.cleanup = this.cleanup.bind(this);
    window.addEventListener('beforeunload', this.cleanup);
  }

  /**
   * Connect to WebSocket server for a session
   */
  async connect(session: Session): Promise<void> {
    // If already connected to this session and WebSocket is open, no-op
    if (this.session?.id === session.id && this.ws?.readyState === WebSocket.OPEN) {
      logger.debug(`Already connected to session ${session.id}`);
      return;
    }

    // If we're connecting to a different session, disconnect first
    if (this.session?.id !== session.id) {
      logger.debug(`Switching from session ${this.session?.id} to ${session.id}`);
      this.disconnect();
    }

    this.session = session;
    logger.debug(`Connecting to WebSocket for session ${session.id}`);

    // If currently connecting to this session, wait for it
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = this.establishConnection();
    try {
      await this.connectionPromise;
    } finally {
      this.connectionPromise = null;
    }
  }

  private async establishConnection(): Promise<void> {
    if (!this.session) {
      throw new Error('No session provided');
    }

    this.isConnecting = true;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const sessionId = this.session.id;

    // Get auth token from localStorage or use a development token
    const authToken =
      localStorage.getItem('vibetunnel_auth_token') ||
      localStorage.getItem('auth_token') ||
      `dev-token-${Date.now()}`;

    const wsUrl = `${protocol}//${host}/ws/input?sessionId=${sessionId}&token=${encodeURIComponent(authToken)}`;

    try {
      logger.log(`Connecting to WebSocket: ${wsUrl}`);
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        logger.log('WebSocket connected successfully');
        this.isConnecting = false;
      };

      this.ws.onclose = (event) => {
        logger.log(`WebSocket closed: code=${event.code}, reason=${event.reason}`);
        this.isConnecting = false;
        this.ws = null;
        this.scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        logger.error('WebSocket error:', error);
        this.isConnecting = false;
      };

      // Wait for connection to establish
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('WebSocket connection timeout'));
        }, 5000);

        this.ws?.addEventListener('open', () => {
          clearTimeout(timeout);
          resolve();
        });

        this.ws?.addEventListener('error', () => {
          clearTimeout(timeout);
          reject(new Error('WebSocket connection failed'));
        });
      });
    } catch (error) {
      logger.error('Failed to establish WebSocket connection:', error);
      this.isConnecting = false;
      throw error;
    }
  }

  /**
   * Send input via WebSocket - fire and forget for minimal latency
   * Returns true if sent via WebSocket, false if should fallback to HTTP
   */
  sendInput(input: { text?: string; key?: string }): boolean {
    if (!this.session || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false; // Fallback to HTTP
    }

    try {
      // Ultra-minimal: send raw input with special key markers
      let rawInput: string;

      if (input.key) {
        // Special keys: wrap in null bytes to distinguish from literal text
        rawInput = `\x00${input.key}\x00`;
        logger.debug(`Sending special key: "${input.key}" as: ${JSON.stringify(rawInput)}`);
      } else if (input.text) {
        // Regular text: send as-is
        rawInput = input.text;
        logger.debug(`Sending text: ${JSON.stringify(rawInput)}`);
      } else {
        return false;
      }

      this.ws.send(rawInput);
      logger.debug('Sent raw input via WebSocket:', JSON.stringify(rawInput));
      return true;
    } catch (error) {
      logger.error('Failed to send via WebSocket:', error);
      return false; // Fallback to HTTP
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      return; // Already scheduled
    }

    const delay = Math.min(this.RECONNECT_DELAY * 2, this.MAX_RECONNECT_DELAY);

    logger.log(`Scheduling reconnect in ${delay}ms`);

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (this.session) {
        this.connect(this.session).catch((error) => {
          logger.error('Reconnection failed:', error);
        });
      }
    }, delay);
  }

  /**
   * Check if WebSocket is connected and ready
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Disconnect and cleanup
   */
  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.session = null;
    this.isConnecting = false;
  }

  private cleanup(): void {
    this.disconnect();
    window.removeEventListener('beforeunload', this.cleanup);
  }
}

// Singleton instance
export const websocketInputClient = new WebSocketInputClient();
