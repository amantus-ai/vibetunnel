import { createLogger } from '../utils/logger.js';
import type { AuthClient } from './auth-client.js';
import { pushNotificationService } from './push-notification-service.js';

const logger = createLogger('notification-event-service');

type ConnectionStateHandler = (connected: boolean) => void;
type EventHandler = (data: unknown) => void;

export class NotificationEventService {
  private eventSource: EventSource | null = null;
  private isConnected = false;
  private connectionStateHandlers: Set<ConnectionStateHandler> = new Set();
  private eventListeners: Map<string, Set<EventHandler>> = new Map();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay = 1000; // Start with 1 second
  private maxReconnectDelay = 30000; // Max 30 seconds
  private shouldReconnect = true;
  private isConnecting = false;

  constructor(private authClient?: AuthClient) {}

  /**
   * Connect to the notification event stream
   */
  async connect(): Promise<void> {
    if (this.eventSource || this.isConnecting) {
      logger.debug('Already connected or connecting to notification event stream');
      return;
    }

    // Skip notification check in no-auth mode - always connect
    const isNoAuth = !this.authClient || !this.authClient.getAuthHeader().Authorization;

    if (!isNoAuth) {
      // Check if notifications are enabled before connecting
      try {
        logger.debug('Checking notification preferences...');
        await pushNotificationService.waitForInitialization();
        const preferences = await pushNotificationService.loadPreferences();
        logger.debug('Loaded notification preferences:', preferences);
        if (!preferences.enabled) {
          logger.debug('Notifications are disabled, not connecting to SSE');
          this.isConnecting = false;
          return;
        }
      } catch (error) {
        logger.warn('Could not check notification preferences:', error);
        // Continue anyway - let the user enable notifications later
      }
    } else {
      logger.debug('No-auth mode - connecting to SSE without checking preferences');
    }

    this.isConnecting = true;
    logger.log('Connecting to notification event stream...');

    let url = '/api/events';

    // EventSource doesn't support custom headers in browsers
    // In no-auth mode, we don't need to add a token
    if (!isNoAuth && this.authClient) {
      const authHeader = this.authClient.getAuthHeader();
      if (authHeader.Authorization?.startsWith('Bearer ')) {
        const token = authHeader.Authorization.substring(7);
        url = `${url}?token=${encodeURIComponent(token)}`;
        logger.debug('Added auth token to EventSource URL');
      }
    } else {
      logger.debug('No auth mode - connecting without token');
    }

    this.eventSource = new EventSource(url);

    // Add readyState logging
    logger.log(
      `EventSource created with URL: ${url}, readyState: ${this.eventSource.readyState} (0=CONNECTING, 1=OPEN, 2=CLOSED)`
    );

    this.eventSource.onopen = () => {
      logger.log('✅ SSE onopen event fired - connection established');
      this.isConnected = true;
      this.isConnecting = false;
      this.reconnectDelay = 1000; // Reset delay on successful connection
      this.notifyConnectionState(true);
    };

    // Add multiple timeouts to track connection state
    setTimeout(() => {
      logger.log(
        `SSE state after 100ms: readyState=${this.eventSource?.readyState}, isConnected=${this.isConnected}`
      );
    }, 100);

    setTimeout(() => {
      logger.log(
        `SSE state after 500ms: readyState=${this.eventSource?.readyState}, isConnected=${this.isConnected}`
      );
    }, 500);

    setTimeout(() => {
      logger.log(
        `SSE state after 1s: readyState=${this.eventSource?.readyState}, isConnected=${this.isConnected}`
      );
      // If we're connected but onopen didn't fire, manually set connected state
      if (this.eventSource?.readyState === EventSource.OPEN && !this.isConnected) {
        logger.warn('⚠️ SSE is OPEN but onopen never fired - manually setting connected state');
        this.isConnected = true;
        this.isConnecting = false;
        this.notifyConnectionState(true);
      }
    }, 1000);

    this.eventSource.onmessage = (event) => {
      logger.log('📨 Received SSE message:', event.data);
      try {
        const data = JSON.parse(event.data);
        logger.log('Parsed notification event:', data);

        // If we receive the initial "connected" event, mark as connected
        if (data.type === 'connected') {
          logger.log('✅ Received connected event from SSE');
          if (!this.isConnected) {
            this.isConnected = true;
            this.isConnecting = false;
            this.notifyConnectionState(true);
          }
        }

        // Notify listeners for this event type
        if (data.type) {
          this.notify(data.type, data);
        }
      } catch (_error) {
        logger.log('Received non-JSON event:', event.data);
      }
    };

    this.eventSource.onerror = (error) => {
      // EventSource error events don't contain much information
      // Check readyState to understand what happened
      const readyState = this.eventSource?.readyState;
      const currentUrl = this.eventSource?.url || 'unknown';

      if (readyState === EventSource.CONNECTING) {
        logger.warn(
          `⚠️ SSE connection failed while connecting to ${currentUrl} (likely auth or CORS issue)`
        );
      } else if (readyState === EventSource.OPEN) {
        logger.warn('⚠️ SSE connection error while open (network issue)');
      } else if (readyState === EventSource.CLOSED) {
        logger.debug('SSE connection closed');
      }

      logger.error('❌ Notification event stream error:', error);
      logger.log(
        `EventSource readyState on error: ${readyState} (0=CONNECTING, 1=OPEN, 2=CLOSED), URL: ${currentUrl}`
      );

      this.isConnected = false;
      this.isConnecting = false;
      this.notifyConnectionState(false);

      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    };
  }

  /**
   * Disconnect from the event stream
   */
  disconnect(): void {
    logger.log('Disconnecting from notification event stream');
    this.shouldReconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      this.isConnected = false;
      this.notifyConnectionState(false);
    }
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.shouldReconnect) {
      return;
    }

    logger.debug(`Scheduling reconnect in ${this.reconnectDelay}ms...`);

    // Clean up existing connection
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldReconnect) {
        this.connect();
        // Exponential backoff with max delay
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      }
    }, this.reconnectDelay);
  }

  /**
   * Get the current connection status
   */
  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  /**
   * Register a handler for connection state changes
   */
  onConnectionStateChange(handler: ConnectionStateHandler): () => void {
    this.connectionStateHandlers.add(handler);

    // Return unsubscribe function
    return () => {
      this.connectionStateHandlers.delete(handler);
    };
  }

  /**
   * Register a handler for a specific event type
   */
  on(eventType: string, handler: EventHandler): () => void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType)?.add(handler);

    // Return unsubscribe function
    return () => {
      this.off(eventType, handler);
    };
  }

  /**
   * Unregister a handler for a specific event type
   */
  off(eventType: string, handler: EventHandler): void {
    this.eventListeners.get(eventType)?.delete(handler);
  }

  /**
   * Notify all handlers of a specific event type
   */
  private notify(eventType: string, data: unknown): void {
    this.eventListeners.get(eventType)?.forEach((handler) => {
      try {
        handler(data);
      } catch (error) {
        logger.error(`Error in event handler for ${eventType}:`, error);
      }
    });
  }

  /**
   * Notify all handlers of connection state change
   */
  private notifyConnectionState(connected: boolean): void {
    this.connectionStateHandlers.forEach((handler) => {
      try {
        handler(connected);
      } catch (error) {
        logger.error('Error in connection state handler:', error);
      }
    });
  }

  /**
   * Set the auth client (for when it becomes available later)
   */
  setAuthClient(authClient: AuthClient): void {
    this.authClient = authClient;
    // Don't reconnect if we already have an event source
    // The EventSource API doesn't require auth headers in browsers
    // as it uses cookies for authentication
  }
}

// Create singleton instance
export const notificationEventService = new NotificationEventService();
