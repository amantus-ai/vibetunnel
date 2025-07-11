import { useCallback, useEffect, useRef, useState } from 'react';
import { createLogger } from '../../utils/logger';

const logger = createLogger('useWebSocket');

export interface UseWebSocketOptions {
  url: string;
  protocols?: string | string[];
  reconnect?: boolean;
  reconnectInterval?: number;
  reconnectAttempts?: number;
  onOpen?: (event: Event) => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (event: Event) => void;
  onMessage?: (event: MessageEvent) => void;
  shouldConnect?: boolean;
}

export interface UseWebSocketReturn {
  sendMessage: (message: string | ArrayBuffer | Blob) => void;
  lastMessage: MessageEvent | null;
  readyState: number;
  connect: () => void;
  disconnect: () => void;
}

const ReadyState = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

export function useWebSocket({
  url,
  protocols,
  reconnect = true,
  reconnectInterval = 1000,
  reconnectAttempts = 5,
  onOpen,
  onClose,
  onError,
  onMessage,
  shouldConnect = true,
}: UseWebSocketOptions): UseWebSocketReturn {
  const [lastMessage, setLastMessage] = useState<MessageEvent | null>(null);
  const [readyState, setReadyState] = useState<number>(ReadyState.CLOSED);
  const webSocketRef = useRef<WebSocket | null>(null);
  const reconnectCountRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (webSocketRef.current?.readyState === ReadyState.OPEN) return;

    try {
      const ws = new WebSocket(url, protocols);
      webSocketRef.current = ws;
      setReadyState(ReadyState.CONNECTING);

      ws.onopen = (event) => {
        if (!mountedRef.current) return;
        logger.log('WebSocket connected');
        setReadyState(ReadyState.OPEN);
        reconnectCountRef.current = 0;
        clearReconnectTimeout();
        onOpen?.(event);
      };

      ws.onclose = (event) => {
        if (!mountedRef.current) return;
        logger.log('WebSocket closed');
        setReadyState(ReadyState.CLOSED);
        webSocketRef.current = null;
        onClose?.(event);

        // Handle reconnection
        if (
          reconnect &&
          shouldConnect &&
          reconnectCountRef.current < reconnectAttempts &&
          !event.wasClean
        ) {
          const timeout = reconnectInterval * Math.pow(2, reconnectCountRef.current);
          logger.log(`Reconnecting in ${timeout}ms (attempt ${reconnectCountRef.current + 1})`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectCountRef.current++;
            connect();
          }, timeout);
        }
      };

      ws.onerror = (event) => {
        if (!mountedRef.current) return;
        logger.error('WebSocket error:', event);
        onError?.(event);
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        setLastMessage(event);
        onMessage?.(event);
      };
    } catch (error) {
      logger.error('Failed to create WebSocket:', error);
      setReadyState(ReadyState.CLOSED);
    }
  }, [
    url,
    protocols,
    reconnect,
    reconnectInterval,
    reconnectAttempts,
    shouldConnect,
    onOpen,
    onClose,
    onError,
    onMessage,
    clearReconnectTimeout,
  ]);

  const disconnect = useCallback(() => {
    clearReconnectTimeout();
    reconnectCountRef.current = reconnectAttempts; // Prevent reconnection
    
    if (webSocketRef.current) {
      webSocketRef.current.close();
      webSocketRef.current = null;
    }
  }, [clearReconnectTimeout, reconnectAttempts]);

  const sendMessage = useCallback((message: string | ArrayBuffer | Blob) => {
    if (webSocketRef.current?.readyState === ReadyState.OPEN) {
      webSocketRef.current.send(message);
    } else {
      logger.warn('WebSocket is not open. Current state:', readyState);
    }
  }, [readyState]);

  // Handle connection lifecycle
  useEffect(() => {
    if (shouldConnect) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      mountedRef.current = false;
      disconnect();
    };
  }, [shouldConnect, connect, disconnect]);

  return {
    sendMessage,
    lastMessage,
    readyState,
    connect,
    disconnect,
  };
}