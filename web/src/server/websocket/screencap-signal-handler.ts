import { type WebSocket, WebSocket as WS } from 'ws';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('screencap-signal');

interface SignalMessage {
  type:
    | 'start-capture'
    | 'offer'
    | 'answer'
    | 'ice-candidate'
    | 'error'
    | 'ready'
    | 'mac-ready'
    // New API message types
    | 'api-request'
    | 'api-response';
  mode?: 'desktop' | 'window' | 'api-only';
  windowId?: number;
  displayIndex?: number;
  data?: unknown; // Will contain SDP or ICE candidate data
  // API request/response fields
  requestId?: string;
  method?: string;
  endpoint?: string;
  params?: unknown;
  result?: unknown;
  error?: string;
  sessionId?: string;
}

export class ScreencapSignalHandler {
  private macSocket: WebSocket | null = null;
  private browserSocket: WebSocket | null = null;
  private macMode: string | null = null;

  handleConnection(ws: WebSocket, userId: string) {
    logger.log(`New WebSocket connection from user ${userId}`);

    // Send initial ready message
    this.sendMessage(ws, { type: 'ready' });

    ws.on('message', (data) => {
      try {
        const rawMessage = data.toString();
        logger.log(`Received message: ${rawMessage.substring(0, 200)}...`);
        const message: SignalMessage = JSON.parse(rawMessage);
        this.handleMessage(ws, message);
      } catch (error) {
        logger.error('Failed to parse message:', error);
        this.sendMessage(ws, { type: 'error', data: 'Invalid message format' });
      }
    });

    ws.on('close', () => {
      logger.log('WebSocket connection closed');
      if (ws === this.macSocket) {
        logger.log('Mac disconnected');
        this.macSocket = null;
        this.macMode = null;
        // Notify browser
        if (this.browserSocket) {
          this.sendMessage(this.browserSocket, { type: 'error', data: 'Mac disconnected' });
        }
      } else if (ws === this.browserSocket) {
        logger.log('Browser disconnected');
        this.browserSocket = null;
      }
    });

    ws.on('error', (error) => {
      logger.error('WebSocket error:', error);
    });
  }

  private handleMessage(ws: WebSocket, message: SignalMessage) {
    logger.log(`Handling message type: ${message.type}`);

    // Identify the sender
    if (message.type === 'mac-ready') {
      this.handleMacReady(ws, message);
      return;
    }

    // Determine if this is from Mac or browser
    const isFromMac = ws === this.macSocket;
    const isFromBrowser = ws === this.browserSocket;

    // If we don't know who this is yet, assume it's browser
    if (!isFromMac && !isFromBrowser && !this.browserSocket) {
      logger.log('Assuming new connection is browser');
      this.browserSocket = ws;
    }

    // Route messages
    switch (message.type) {
      case 'api-request':
        // Browser -> Mac
        if (isFromBrowser && this.macSocket) {
          logger.log(`Forwarding API request to Mac: ${message.method} ${message.endpoint}`);
          this.sendMessage(this.macSocket, message);
        } else if (!this.macSocket) {
          logger.warn('No Mac connected to handle API request');
          this.sendMessage(ws, {
            type: 'api-response',
            requestId: message.requestId,
            error: 'Mac not connected',
          });
        }
        break;

      case 'api-response':
        // Mac -> Browser (or any peer -> browser during transition)
        if (this.browserSocket) {
          logger.log(`Forwarding API response to browser: ${message.requestId}`);
          this.sendMessage(this.browserSocket, message);
        }
        break;

      case 'start-capture':
        // Browser -> Mac
        if (isFromBrowser && this.macSocket) {
          logger.log('Forwarding start-capture to Mac');
          logger.log('start-capture details:', JSON.stringify(message));
          this.sendMessage(this.macSocket, message);
        } else {
          logger.error(
            `Cannot forward start-capture - isFromBrowser: ${isFromBrowser}, macSocket: ${!!this.macSocket}`
          );
        }
        break;

      case 'offer':
      case 'answer':
      case 'ice-candidate':
        // WebRTC signaling - forward between Mac and browser
        if (isFromMac && this.browserSocket) {
          logger.log(`Forwarding ${message.type} to browser`);
          this.sendMessage(this.browserSocket, message);
        } else if (isFromBrowser && this.macSocket) {
          logger.log(`Forwarding ${message.type} to Mac`);
          this.sendMessage(this.macSocket, message);
        }
        break;

      default:
        logger.warn(`Unknown message type: ${message.type}`);
    }
  }

  private handleMacReady(ws: WebSocket, message: SignalMessage) {
    logger.log(`Mac ready with mode: ${message.mode}`);

    // Only close old connection if it's actually different and still open
    if (this.macSocket && this.macSocket !== ws && this.macSocket.readyState === WS.OPEN) {
      logger.log('Closing old Mac connection');
      this.macSocket.close();
    }

    // Update to new socket
    this.macSocket = ws;
    this.macMode = message.mode || null;
    logger.log(`Mac connected in ${this.macMode} mode`);

    // Notify browser
    if (this.browserSocket && this.browserSocket.readyState === WS.OPEN) {
      this.sendMessage(this.browserSocket, {
        type: 'ready',
        data: 'Mac peer connected',
      });
    }
  }

  private sendMessage(ws: WebSocket, message: SignalMessage) {
    if (ws.readyState === WS.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}

export const screencapSignalHandler = new ScreencapSignalHandler();
