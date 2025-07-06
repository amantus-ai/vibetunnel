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
    | 'api-response'
    | 'bitrate-adjustment'
    | 'state-change'
    | 'ping'
    | 'pong';
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
  timestamp?: number;
}

export class ScreencapUnixHandler {
  private macSocket: net.Socket | null = null;
  private browserSocket: WebSocket | null = null;
  private macMode: string | null = null;
  private unixServer: net.Server | null = null;
  private readonly socketPath: string;

  constructor() {
    // Use a unique socket path in user's home directory to avoid /tmp issues
    const home = process.env.HOME || '/tmp';
    const socketDir = path.join(home, '.vibetunnel');

    // Ensure directory exists
    try {
      fs.mkdirSync(socketDir, { recursive: true });
    } catch (_e) {
      // Ignore if already exists
    }

    this.socketPath = path.join(socketDir, 'screencap.sock');
  }

  async start(): Promise<void> {
    // Clean up any existing socket file to prevent EADDRINUSE errors on restart.
    try {
      if (fs.existsSync(this.socketPath)) {
        fs.unlinkSync(this.socketPath);
        logger.log('Removed existing stale socket file.');
      }
    } catch (error) {
      logger.warn('Failed to remove stale socket file:', error);
    }

    // Create UNIX socket server
    this.unixServer = net.createServer((socket) => {
      this.handleMacConnection(socket);
    });

    // Start listening
    await new Promise<void>((resolve, reject) => {
      this.unixServer?.listen(this.socketPath, () => {
        logger.log(`UNIX socket server listening at ${this.socketPath}`);

        // Check if socket file exists
        fs.access(this.socketPath, fs.constants.F_OK, (accessErr) => {
          if (accessErr) {
            logger.error('Socket file does not exist after creation!', accessErr);
          } else {
            logger.log('Socket file exists, checking stats...');
            fs.stat(this.socketPath, (statErr, stats) => {
              if (statErr) {
                logger.error('Failed to stat socket file:', statErr);
              } else {
                logger.log('Socket file stats:', {
                  isSocket: stats.isSocket(),
                  mode: stats.mode.toString(8),
                  size: stats.size,
                });
              }
            });
          }
        });

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

    // Set socket options for better handling of large messages
    socket.setNoDelay(true); // Disable Nagle's algorithm for lower latency

    // Increase the buffer size for receiving large messages
    // Note: The actual buffer size may be limited by system settings
    const bufferSize = 1024 * 1024; // 1MB
    try {
      // Node.js internal: _readableState is a known internal property
      const socketWithState = socket as net.Socket & {
        _readableState?: { highWaterMark: number };
      };
      if (socketWithState._readableState) {
        socketWithState._readableState.highWaterMark = bufferSize;
        logger.log(`Set socket receive buffer to ${bufferSize} bytes`);
      }
    } catch (error) {
      logger.warn('Failed to set socket buffer size:', error);
    }

    // Buffer for incomplete messages
    let buffer = Buffer.alloc(0);

    socket.on('data', (data) => {
      // Append new data to our buffer
      buffer = Buffer.concat([buffer, data]);

      logger.log(`Received from Mac: ${data.length} bytes, buffer size: ${buffer.length}`);

      // Process complete messages (separated by newlines)
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const messageBuffer = buffer.subarray(0, newlineIndex);

        // Remove the message and the newline from the main buffer
        buffer = buffer.subarray(newlineIndex + 1);

        if (messageBuffer.length > 0) {
          try {
            const message: SignalMessage = JSON.parse(messageBuffer.toString('utf-8'));
            this.handleMacMessage(message);
          } catch (error) {
            logger.error('Failed to parse Mac message:', error);
            logger.error('Raw message buffer:', messageBuffer.toString('utf-8'));
          }
        }

        // Find the next newline
        newlineIndex = buffer.indexOf('\n');
      }
    });

    socket.on('error', (error) => {
      logger.error('Mac socket error:', error);
      const errorObj = error as NodeJS.ErrnoException;
      logger.error('Error details:', {
        code: errorObj.code,
        syscall: errorObj.syscall,
        errno: errorObj.errno,
      });
    });

    socket.on('close', (hadError) => {
      logger.log(`Mac disconnected (hadError: ${hadError})`);
      if (socket === this.macSocket) {
        this.macSocket = null;
        this.macMode = null;

        // Notify browser if connected
        if (this.browserSocket) {
          this.sendToBrowser({ type: 'error', data: 'Mac disconnected' });
        }
      }
    });

    // Handle drain event for backpressure
    socket.on('drain', () => {
      logger.log('Mac socket drained - ready for more data');
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
          data: error instanceof Error ? error.message : String(error),
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

      case 'ping':
        // Respond to keep-alive ping
        logger.debug('Received ping from Mac, sending pong');
        this.sendToMac({ type: 'pong', timestamp: Date.now() / 1000 });
        break;

      case 'state-change':
        // Mac app state change notification
        logger.log(`Mac state change: ${JSON.stringify(message.data)}`);
        // Forward to browser if needed
        if (this.browserSocket) {
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
      case 'bitrate-adjustment':
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

      // Log message size for debugging
      logger.log(`Sending to Mac: ${message.type}, size: ${data.length} bytes`);
      if (data.length > 65536) {
        logger.warn(`Large message to Mac: ${data.length} bytes`);
      }

      // Write with error handling
      const result = this.macSocket.write(data, (error) => {
        if (error) {
          logger.error('Error writing to Mac socket:', error);
          // Close the connection on write error
          this.macSocket?.destroy();
          this.macSocket = null;
        }
      });

      // Check if write was buffered (backpressure)
      if (!result) {
        logger.warn('Socket write buffered - backpressure detected');
      }
    }
  }

  private sendToBrowser(message: SignalMessage): void {
    if (this.browserSocket && this.browserSocket.readyState === WS.OPEN) {
      this.browserSocket.send(JSON.stringify(message));
    }
  }
}

export const screencapUnixHandler = new ScreencapUnixHandler();
