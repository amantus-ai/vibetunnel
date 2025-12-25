import type { ServerEvent, ServerEventType } from '../../shared/types.js';
import { createLogger } from '../utils/logger.js';
import { terminalSocketClient } from './terminal-socket-client.js';

const logger = createLogger('server-event-service');

type EventHandler = (event: ServerEvent) => void;
type ConnectionStateHandler = (connected: boolean) => void;

export class ServerEventService {
  private initialized = false;
  private unsubscribeSocket?: () => void;

  private connectionHandlers: Set<ConnectionStateHandler> = new Set();
  private handlersByType: Map<string, Set<EventHandler>> = new Map();

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    Promise.resolve(terminalSocketClient.initialize()).catch((error) => {
      logger.warn('failed to initialize terminal socket client', error);
    });

    // Subscribe to "global" events (empty sessionId).
    this.unsubscribeSocket = terminalSocketClient.subscribe('', {
      events: true,
      onEvent: (data) => this.handleEventPayload(data),
      onError: (message) => logger.debug('global event channel error', message),
    });

    terminalSocketClient.onConnectionStateChange((connected) => {
      for (const handler of this.connectionHandlers) {
        try {
          handler(connected);
        } catch (error) {
          logger.debug('connection handler error', error);
        }
      }
    });
  }

  getConnectionStatus(): boolean {
    return terminalSocketClient.getConnectionStatus();
  }

  onConnectionStateChange(handler: ConnectionStateHandler): () => void {
    this.connectionHandlers.add(handler);
    return () => this.connectionHandlers.delete(handler);
  }

  on(type: ServerEventType | string, handler: EventHandler): () => void {
    const key = String(type);
    let handlers = this.handlersByType.get(key);
    if (!handlers) {
      handlers = new Set();
      this.handlersByType.set(key, handlers);
    }
    handlers.add(handler);

    return () => {
      const set = this.handlersByType.get(key);
      if (!set) return;
      set.delete(handler);
      if (set.size === 0) this.handlersByType.delete(key);
    };
  }

  dispose(): void {
    this.unsubscribeSocket?.();
    this.unsubscribeSocket = undefined;
    this.handlersByType.clear();
    this.connectionHandlers.clear();
    this.initialized = false;
  }

  private handleEventPayload(data: unknown) {
    if (!data || typeof data !== 'object') return;
    const event = data as Partial<ServerEvent>;
    if (typeof event.type !== 'string') return;

    const handlers = this.handlersByType.get(event.type);
    if (!handlers || handlers.size === 0) return;

    for (const handler of handlers) {
      try {
        handler(event as ServerEvent);
      } catch (error) {
        logger.debug('event handler error', error);
      }
    }
  }
}

export const serverEventService = new ServerEventService();
