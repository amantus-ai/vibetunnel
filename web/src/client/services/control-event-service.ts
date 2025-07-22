/**
 * Control Event Service
 *
 * Handles server-sent control events for real-time updates from the server.
 * This includes Git notifications, system events, and other control messages.
 */

import { createLogger } from '../utils/logger.js';
import type { AuthClient } from './auth-client.js';

const logger = createLogger('control-event-service');

export interface ControlEvent {
  category: string;
  action: string;
  data?: unknown;
}

export interface GitNotificationData {
  type: 'branch_switched' | 'branch_diverged' | 'follow_enabled' | 'follow_disabled';
  sessionTitle?: string;
  currentBranch?: string;
  divergedBranch?: string;
  aheadBy?: number;
  behindBy?: number;
  message?: string;
}

type EventHandler = (event: ControlEvent) => void;

export class ControlEventService {
  private eventSource: EventSource | null = null;
  private handlers: EventHandler[] = [];
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay = 1000; // Start with 1 second
  private maxReconnectDelay = 30000; // Max 30 seconds
  private isConnected = false;

  constructor(private authClient: AuthClient) {}

  connect(): void {
    if (this.eventSource) {
      return;
    }

    const url = '/api/control/stream';
    const headers = this.authClient.getAuthHeader();

    // EventSource doesn't support custom headers directly, so we'll use a query parameter
    const authHeader = headers.Authorization;
    const urlWithAuth = authHeader ? `${url}?auth=${encodeURIComponent(authHeader)}` : url;

    logger.debug('Connecting to control event stream:', url);

    this.eventSource = new EventSource(urlWithAuth);

    this.eventSource.onopen = () => {
      logger.debug('Control event stream connected');
      this.isConnected = true;
      this.reconnectDelay = 1000; // Reset delay on successful connection
    };

    this.eventSource.onmessage = (event) => {
      try {
        const controlEvent = JSON.parse(event.data) as ControlEvent;
        logger.debug('Received control event:', controlEvent);
        this.notifyHandlers(controlEvent);
      } catch (error) {
        logger.error('Failed to parse control event:', error, event.data);
      }
    };

    this.eventSource.onerror = (error) => {
      logger.error('Control event stream error:', error);
      this.isConnected = false;
      this.reconnect();
    };
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      this.isConnected = false;
    }
  }

  private reconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    logger.debug(`Reconnecting in ${this.reconnectDelay}ms...`);

    this.disconnect();

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();

      // Exponential backoff with max delay
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    }, this.reconnectDelay);
  }

  onEvent(handler: EventHandler): () => void {
    this.handlers.push(handler);

    // Return unsubscribe function
    return () => {
      const index = this.handlers.indexOf(handler);
      if (index >= 0) {
        this.handlers.splice(index, 1);
      }
    };
  }

  private notifyHandlers(event: ControlEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (error) {
        logger.error('Error in event handler:', error);
      }
    }
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }
}

// Singleton instance
let instance: ControlEventService | null = null;

export function getControlEventService(authClient: AuthClient): ControlEventService {
  if (!instance) {
    instance = new ControlEventService(authClient);
  }
  return instance;
}
