import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import type { WebSocket } from 'ws';
import { WebSocket as WS } from 'ws';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('screencap-unix');

interface SignalMessage {
  type:
    | 'start-capture'
    | 'offer'
    | 'answer'
    | 'ice-candidate'
    | 'error'
    | 'ready'
    | 'mac-ready'
    | 'api-request'
    | 'api-response';
  mode?: 'desktop' | 'window' | 'api-only';
  windowId?: number;
  displayIndex?: number;
  data?: unknown;
  requestId?: string;
  method?: string;
  endpoint?: string;
  params?: unknown;
  result?: unknown;
  error?: string;
  sessionId?: string;
}

export class ScreencapUnixHandler {
  private macSocket: net.Socket | null = null;
  private browserSocket: WebSocket | null = null;
  private macMode: string | null = null;
  private unixServer: net.Server | null = null;
  private readonly socketPath: string;

  constructor() {
    // Use a unique socket path
    this.socketPath = path.join('/tmp', 'vibetunnel-screencap.sock');
  }

  async start(): Promise<void> {
    // Clean up any existing socket file
    try {
      await fs.promises.unlink(this.socketPath);
    } catch (_error) {
      // Ignore if file doesn't exist
    }

    // Create UNIX socket server
    this.unixServer = net.createServer((socket) => {
      this.handleMacConnection(socket);
    });

    // Start listening
    await new Promise<void>((resolve, reject) => {
      this.unixServer?.listen(this.socketPath, () => {
        logger.log(`UNIX socket server listening at ${this.socketPath}`);

        // Set restrictive permissions - only owner can read/write
        fs.chmod(this.socketPath, 0o600, (err) => {
          if (err) {
            logger.error('Failed to set socket permissions:', err);
          } else {
            logger.log('Socket permissions set to 0600 (owner read/write only)');
          }
        });

        resolve();
      });

      this.unixServer?.on('error', (error) => {
        logger.error('UNIX socket server error:', error);
        reject(error);
      });
    });
  }

  stop(): void {
    if (this.macSocket) {
      this.macSocket.destroy();
      this.macSocket = null;
    }

    if (this.unixServer) {
      this.unixServer.close();
      this.unixServer = null;
    }

    // Clean up socket file
    try {
      fs.unlinkSync(this.socketPath);
    } catch (_error) {
      // Ignore
    }
  }

  private handleMacConnection(socket: net.Socket) {
    logger.log('New Mac connection via UNIX socket');

    // Close any existing Mac connection
    if (this.macSocket) {
      logger.log('Closing existing Mac connection');
      this.macSocket.destroy();
    }

    this.macSocket = socket;

    // Buffer for incomplete messages
    let buffer = '';

    socket.on('data', (data) => {
      buffer += data.toString();

      // Process complete messages (separated by newlines)
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim()) {
          try {
            const message: SignalMessage = JSON.parse(line);
            this.handleMacMessage(message);
          } catch (error) {
            logger.error('Failed to parse Mac message:', error);
            logger.error('Raw message:', line);
          }
        }
      }
    });

    socket.on('error', (error) => {
      logger.error('Mac socket error:', error);
    });

    socket.on('close', () => {
      logger.log('Mac disconnected');
      if (socket === this.macSocket) {
        this.macSocket = null;
        this.macMode = null;

        // Notify browser if connected
        if (this.browserSocket) {
          this.sendToBrowser({ type: 'error', data: 'Mac disconnected' });
        }
      }
    });

    // Send ready message to Mac
    this.sendToMac({ type: 'ready' });
  }

  handleBrowserConnection(ws: WebSocket) {
    logger.log('New browser WebSocket connection');

    // Send initial ready message
    this.sendToBrowser({ type: 'ready' });

    ws.on('message', (data) => {
      try {
        const rawMessage = data.toString();
        logger.log(`Browser message: ${rawMessage.substring(0, 200)}...`);
        const message: SignalMessage = JSON.parse(rawMessage);
        this.handleBrowserMessage(ws, message);
      } catch (error) {
        logger.error('Failed to parse browser message:', error);
        this.sendToBrowser({ 
          type: 'error', 
          error: {
            code: 'INVALID_REQUEST',
            message: 'Invalid message format',
            details: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          }
        });
      }
    });

    ws.on('close', () => {
      logger.log('Browser disconnected');
      if (ws === this.browserSocket) {
        this.browserSocket = null;
      }
    });

    ws.on('error', (error) => {
      logger.error('Browser WebSocket error:', error);
    });

    this.browserSocket = ws;
  }

  private handleMacMessage(message: SignalMessage) {
    logger.log(`Mac message type: ${message.type}`);

    switch (message.type) {
      case 'mac-ready':
        this.macMode = message.mode || null;
        logger.log(`Mac connected in ${this.macMode} mode`);

        // Notify browser
        if (this.browserSocket) {
          this.sendToBrowser({
            type: 'ready',
            data: 'Mac peer connected',
          });
        }
        break;

      case 'api-response':
        // Forward to browser
        if (this.browserSocket) {
          logger.log(`Forwarding API response to browser: ${message.requestId}`);
          this.sendToBrowser(message);
        }
        break;

      case 'offer':
      case 'answer':
      case 'ice-candidate':
        // WebRTC signaling - forward to browser
        if (this.browserSocket) {
          logger.log(`Forwarding ${message.type} to browser`);
          this.sendToBrowser(message);
        }
        break;

      default:
        logger.warn(`Unknown message type from Mac: ${message.type}`);
    }
  }

  private handleBrowserMessage(ws: WebSocket, message: SignalMessage) {
    logger.log(`Browser message type: ${message.type}`);

    // Store browser socket reference
    this.browserSocket = ws;

    switch (message.type) {
      case 'api-request':
        // Forward to Mac
        if (this.macSocket) {
          logger.log(`Forwarding API request to Mac: ${message.method} ${message.endpoint}`);
          this.sendToMac(message);
        } else {
          logger.warn('No Mac connected to handle API request');
          this.sendToBrowser({
            type: 'api-response',
            requestId: message.requestId,
            error: 'Mac not connected',
          });
        }
        break;

      case 'start-capture':
        // Forward to Mac
        if (this.macSocket) {
          logger.log('Forwarding start-capture to Mac');
          this.sendToMac(message);
        }
        break;

      case 'offer':
      case 'answer':
      case 'ice-candidate':
        // WebRTC signaling - forward to Mac
        if (this.macSocket) {
          logger.log(`Forwarding ${message.type} to Mac`);
          this.sendToMac(message);
        }
        break;

      default:
        logger.warn(`Unknown message type from browser: ${message.type}`);
    }
  }

  private sendToMac(message: SignalMessage): void {
    if (this.macSocket && !this.macSocket.destroyed) {
      const data = `${JSON.stringify(message)}\n`;
      this.macSocket.write(data);
    }
  }

  private sendToBrowser(message: SignalMessage): void {
    if (this.browserSocket && this.browserSocket.readyState === WS.OPEN) {
      this.browserSocket.send(JSON.stringify(message));
    }
  }
}

export const screencapUnixHandler = new ScreencapUnixHandler();
