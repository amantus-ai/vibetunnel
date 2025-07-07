import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import type { WebSocket } from 'ws';
import { WebSocket as WS } from 'ws';
import { createLogger } from '../utils/logger.js';
import type {
  ControlCategory,
  ControlMessage,
  TerminalSpawnRequest,
  TerminalSpawnResponse,
} from './control-protocol.js';
import {
  createControlEvent,
  createControlMessage,
  createControlResponse,
} from './control-protocol.js';

const logger = createLogger('control-unix');

interface MessageHandler {
  handleMessage(message: ControlMessage): Promise<ControlMessage | null>;
}

class TerminalHandler implements MessageHandler {
  async handleMessage(message: ControlMessage): Promise<ControlMessage> {
    logger.log(`Terminal handler: ${message.action}`);

    if (message.action === 'spawn') {
      const request = message.payload as TerminalSpawnRequest;

      try {
        // Build the command for launching terminal with VibeTunnel
        const args = ['launch'];

        if (request.workingDirectory) {
          args.push('--working-directory', request.workingDirectory);
        }

        if (request.command) {
          args.push('--command', request.command);
        }

        args.push('--session-id', request.sessionId);

        if (request.terminalPreference) {
          args.push('--terminal', request.terminalPreference);
        }

        // Execute vibetunnel command
        logger.log(`Spawning terminal with args: ${args.join(' ')}`);

        // Use spawn to avoid shell injection
        const vt = child_process.spawn('vibetunnel', args, {
          detached: true,
          stdio: 'ignore',
        });

        vt.unref();

        const response: TerminalSpawnResponse = {
          success: true,
        };

        return createControlResponse(message, response);
      } catch (error) {
        logger.error('Failed to spawn terminal:', error);
        return createControlResponse(
          message,
          null,
          error instanceof Error ? error.message : 'Failed to spawn terminal'
        );
      }
    }

    return createControlResponse(message, null, `Unknown terminal action: ${message.action}`);
  }
}

class ScreenCaptureHandler implements MessageHandler {
  private browserSocket: WebSocket | null = null;

  constructor(private controlUnixHandler: ControlUnixHandler) {}

  setBrowserSocket(ws: WebSocket | null) {
    this.browserSocket = ws;
  }

  isBrowserConnected(): boolean {
    return this.browserSocket !== null && this.browserSocket.readyState === WS.OPEN;
  }

  async handleMessage(message: ControlMessage): Promise<ControlMessage | null> {
    logger.log(`Screen capture handler: ${message.action}`);

    switch (message.action) {
      case 'mac-ready':
        // Mac app connected and ready
        if (this.browserSocket) {
          this.sendToBrowser(createControlEvent('screencap', 'ready', 'Mac peer connected'));
          // Request initial data
          this.requestInitialData();
        }
        return null; // No response needed

      case 'api-request':
        // Request from browser - forward to Mac
        logger.log(`Forwarding API request from browser to Mac: ${message.id}`);
        return null; // The request will be forwarded by the parent handler

      case 'api-response':
        // Response from Mac app - forward to browser
        if (this.browserSocket) {
          logger.log(`Forwarding API response to browser: ${message.id}`);
          this.sendToBrowser(message);
        }
        return null;

      case 'offer':
      case 'answer':
      case 'ice-candidate':
      case 'bitrate-adjustment':
        // WebRTC signaling - forward to browser
        if (this.browserSocket) {
          logger.log(`Forwarding ${message.action} to browser`);
          this.sendToBrowser(message);
        }
        return null;

      case 'start-capture':
        // Forward start-capture from browser to Mac app
        logger.log(`Forwarding start-capture request to Mac app`);
        return null; // The request will be forwarded by the parent handler

      case 'ping':
        // Respond to keep-alive ping
        logger.debug('Received ping from Mac, sending pong');
        return createControlResponse(message, { timestamp: Date.now() / 1000 });

      case 'state-change':
      case 'display-disconnected':
      case 'window-disconnected':
        // Forward these events to browser
        if (this.browserSocket) {
          logger.log(`Forwarding ${message.action} event to browser`);
          this.sendToBrowser(message);
        }
        return null;

      default:
        logger.warn(`Unknown screen capture action: ${message.action}`);
        return createControlResponse(message, null, `Unknown action: ${message.action}`);
    }
  }

  private sendToBrowser(message: ControlMessage): void {
    if (this.browserSocket && this.browserSocket.readyState === WS.OPEN) {
      this.browserSocket.send(JSON.stringify(message));
    }
  }

  private requestInitialData(): void {
    logger.log('Requesting initial data from Mac...');
    const request = createControlMessage('screencap', 'get-initial-data', {});
    this.controlUnixHandler.sendToMac(request);
  }
}

export class ControlUnixHandler {
  private pendingRequests = new Map<string, (response: ControlMessage) => void>();
  private macSocket: net.Socket | null = null;
  private unixServer: net.Server | null = null;
  private readonly socketPath: string;
  private handlers = new Map<ControlCategory, MessageHandler>();
  private screenCaptureHandler: ScreenCaptureHandler;
  private messageBuffer = Buffer.alloc(0);

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

    // Changed from screencap.sock to control.sock
    this.socketPath = path.join(socketDir, 'control.sock');

    // Initialize handlers
    this.handlers.set('terminal', new TerminalHandler());
    this.screenCaptureHandler = new ScreenCaptureHandler(this);
    this.handlers.set('screencap', this.screenCaptureHandler);
  }

  async start(): Promise<void> {
    logger.log('🚀 Starting control Unix socket handler');
    logger.log(`📂 Socket path: ${this.socketPath}`);

    // Clean up any existing socket file to prevent EADDRINUSE errors on restart.
    try {
      if (fs.existsSync(this.socketPath)) {
        fs.unlinkSync(this.socketPath);
        logger.log('🧹 Removed existing stale socket file.');
      } else {
        logger.log('✅ No existing socket file found');
      }
    } catch (error) {
      logger.warn('⚠️ Failed to remove stale socket file:', error);
    }

    // Create UNIX socket server
    this.unixServer = net.createServer((socket) => {
      this.handleMacConnection(socket);
    });

    // Start listening
    await new Promise<void>((resolve, reject) => {
      this.unixServer?.listen(this.socketPath, () => {
        logger.log(`Control UNIX socket server listening at ${this.socketPath}`);

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

    // If a browser is already connected, we can now trigger the ready sequence
    if (this.screenCaptureHandler.isBrowserConnected()) {
      logger.log('Browser is already connected, sending mac-ready event.');
      this.screenCaptureHandler.handleMessage(createControlEvent('screencap', 'mac-ready'));
    }

    // ... (rest of the function is the same)

    // Set socket options for better handling of large messages
    socket.setNoDelay(true); // Disable Nagle's algorithm for lower latency

    // Increase the buffer size for receiving large messages
    const bufferSize = 1024 * 1024; // 1MB
    try {
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

    socket.on('data', (data) => {
      // Append new data to our buffer
      this.messageBuffer = Buffer.concat([this.messageBuffer, data]);

      logger.log(
        `Received from Mac: ${data.length} bytes, buffer size: ${this.messageBuffer.length}`
      );

      // Process as many messages as we can from the buffer
      while (true) {
        // A message needs at least 4 bytes for the length header
        if (this.messageBuffer.length < 4) {
          break;
        }

        // Read the length of the message
        const messageLength = this.messageBuffer.readUInt32BE(0);

        // Validate message length
        if (messageLength <= 0) {
          logger.error(`Invalid message length: ${messageLength}`);
          // Clear the buffer to recover from this error
          this.messageBuffer = Buffer.alloc(0);
          break;
        }

        // Sanity check: messages shouldn't be larger than 10MB
        const maxMessageSize = 10 * 1024 * 1024; // 10MB
        if (messageLength > maxMessageSize) {
          logger.error(`Message too large: ${messageLength} bytes (max: ${maxMessageSize})`);
          // Clear the buffer to recover from this error
          this.messageBuffer = Buffer.alloc(0);
          break;
        }

        // Check if we have the full message in the buffer
        if (this.messageBuffer.length < 4 + messageLength) {
          // Not enough data yet, wait for more
          logger.debug(
            `Waiting for more data: have ${this.messageBuffer.length}, need ${4 + messageLength}`
          );
          break;
        }

        // Extract the message data
        const messageData = this.messageBuffer.subarray(4, 4 + messageLength);

        // Remove the message (header + body) from the buffer
        this.messageBuffer = this.messageBuffer.subarray(4 + messageLength);

        try {
          const message: ControlMessage = JSON.parse(messageData.toString('utf-8'));
          this.handleMacMessage(message);
        } catch (error) {
          logger.error('Failed to parse Mac message:', error);
          logger.error('Message length:', messageLength);
          logger.error('Raw message buffer:', messageData.toString('utf-8'));
        }
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

        // Notify browser if connected for screencap
        this.screenCaptureHandler.setBrowserSocket(null);
      }
    });

    // Handle drain event for backpressure
    socket.on('drain', () => {
      logger.log('Mac socket drained - ready for more data');
    });

    // Send ready event to Mac
    this.sendToMac(createControlEvent('system', 'ready'));
  }

  handleBrowserConnection(ws: WebSocket) {
    logger.log('🌐 New browser WebSocket connection for control messages');
    logger.log(
      `🔌 Mac socket status on browser connect: ${this.macSocket ? 'CONNECTED' : 'NOT CONNECTED'}`
    );
    logger.log(`🖥️ Screen capture handler exists: ${!!this.screenCaptureHandler}`);

    // Set browser socket in screen capture handler
    this.screenCaptureHandler.setBrowserSocket(ws);
    logger.log('✅ Browser socket set in screen capture handler');

    // If the Mac app is already connected, we can trigger the ready sequence
    if (this.macSocket) {
      logger.log('✅ Mac is already connected, sending mac-ready event to trigger initialization');
      this.screenCaptureHandler
        .handleMessage(createControlEvent('screencap', 'mac-ready'))
        .catch((error) => {
          logger.error('❌ Failed to handle mac-ready event:', error);
        });
    } else {
      logger.log('⏳ Mac app not connected yet, waiting for Mac connection...');
      logger.log('💡 Make sure the Mac app is running and the Unix socket is connected');
    }

    ws.on('message', async (data) => {
      try {
        const rawMessage = data.toString();
        logger.log(
          `📨 Browser message received (${rawMessage.length} chars): ${rawMessage.substring(0, 200)}...`
        );
        const message: ControlMessage = JSON.parse(rawMessage);
        logger.log(
          `📥 Parsed browser message - type: ${message.type}, category: ${message.category}, action: ${message.action}`
        );

        // Handle browser -> Mac messages
        if (message.category === 'screencap') {
          logger.log(`🖥️ Processing screencap message: ${message.action}`);

          // Forward screen capture messages to Mac
          if (this.macSocket) {
            logger.log(`📤 Forwarding ${message.action} to Mac app via Unix socket`);
            this.sendToMac(message);
          } else {
            logger.warn('❌ No Mac connected to handle screen capture request');
            logger.warn('💡 The Mac app needs to be running and connected via Unix socket');
            if (message.type === 'request') {
              const errorResponse = createControlResponse(
                message,
                null,
                'Mac app not connected - ensure VibeTunnel Mac app is running'
              );
              logger.log('📤 Sending error response to browser:', errorResponse);
              ws.send(JSON.stringify(errorResponse));
            }
          }
        } else {
          logger.warn(`⚠️ Browser sent message for unsupported category: ${message.category}`);
        }
      } catch (error) {
        logger.error('❌ Failed to parse browser message:', error);
        ws.send(
          JSON.stringify(
            createControlEvent('system', 'error', {
              error: error instanceof Error ? error.message : String(error),
            })
          )
        );
      }
    });

    ws.on('close', () => {
      logger.log('Browser disconnected');
      this.screenCaptureHandler.setBrowserSocket(null);
    });

    ws.on('error', (error) => {
      logger.error('Browser WebSocket error:', error);
    });
  }

  private async handleMacMessage(message: ControlMessage) {
    logger.log(
      `Mac message - category: ${message.category}, action: ${message.action}, id: ${message.id}`
    );

    // Handle ping keep-alive from Mac client
    if (message.category === 'system' && message.action === 'ping') {
      const pong = createControlResponse(message, { status: 'ok' });
      this.sendToMac(pong);
      return;
    }

    // Check if this is a response to a pending request
    if (message.type === 'response' && this.pendingRequests.has(message.id)) {
      const resolver = this.pendingRequests.get(message.id);
      if (resolver) {
        logger.debug(`Resolving pending request for id: ${message.id}`);
        this.pendingRequests.delete(message.id);
        resolver(message);
      }
      return;
    }

    const handler = this.handlers.get(message.category);
    if (!handler) {
      logger.warn(`No handler for category: ${message.category}`);
      if (message.type === 'request') {
        const response = createControlResponse(
          message,
          null,
          `Unknown category: ${message.category}`
        );
        this.sendToMac(response);
      }
      return;
    }

    try {
      const response = await handler.handleMessage(message);
      if (response) {
        this.sendToMac(response);
      }
    } catch (error) {
      logger.error(`Handler error for ${message.category}:${message.action}:`, error);
      if (message.type === 'request') {
        const response = createControlResponse(
          message,
          null,
          error instanceof Error ? error.message : 'Handler error'
        );
        this.sendToMac(response);
      }
    }
  }

  async sendControlMessage(message: ControlMessage): Promise<ControlMessage | null> {
    return new Promise((resolve) => {
      // Store the pending request
      this.pendingRequests.set(message.id, resolve);

      // Send the message
      this.sendToMac(message);

      // Set a timeout
      setTimeout(() => {
        if (this.pendingRequests.has(message.id)) {
          this.pendingRequests.delete(message.id);
          resolve(null);
        }
      }, 10000); // 10 second timeout
    });
  }

  sendToMac(message: ControlMessage): void {
    if (this.macSocket && !this.macSocket.destroyed) {
      // Convert message to JSON
      const jsonStr = JSON.stringify(message);
      const jsonData = Buffer.from(jsonStr, 'utf-8');

      // Create a buffer with 4-byte length header + JSON data
      const lengthBuffer = Buffer.allocUnsafe(4);
      lengthBuffer.writeUInt32BE(jsonData.length, 0);

      // Combine length header and data
      const fullData = Buffer.concat([lengthBuffer, jsonData]);

      // Log message size for debugging
      logger.log(
        `Sending to Mac: ${message.category}:${message.action}, header: 4 bytes, payload: ${jsonData.length} bytes, total: ${fullData.length} bytes`
      );
      if (jsonData.length > 65536) {
        logger.warn(`Large message to Mac: ${jsonData.length} bytes`);
      }

      // Write with error handling
      const result = this.macSocket.write(fullData, (error) => {
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
}

export const controlUnixHandler = new ControlUnixHandler();
