import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type { WebSocket } from 'ws';
import { createLogger } from '../utils/logger.js';
import type {
  ControlCategory,
  ControlMessage,
  TerminalSpawnRequest,
  TerminalSpawnResponse,
} from './control-protocol.js';
import { createControlEvent, createControlResponse } from './control-protocol.js';

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

class SystemHandler implements MessageHandler {
  async handleMessage(message: ControlMessage): Promise<ControlMessage | null> {
    logger.log(`System handler: ${message.action}, type: ${message.type}, id: ${message.id}`);

    switch (message.action) {
      case 'ping':
        // Already handled in handleMacMessage
        return null;

      case 'ready':
        // Event, no response needed
        return null;

      default:
        logger.warn(`Unknown system action: ${message.action}`);
        return createControlResponse(message, null, `Unknown action: ${message.action}`);
    }
  }
}

/**
 * Handles Unix domain socket communication between the VibeTunnel web server and macOS app.
 *
 * This class manages a Unix socket server that provides bidirectional communication
 * between the web server and the native macOS application. It implements a message-based
 * protocol with length-prefixed framing for reliable message delivery and supports
 * multiple message categories including terminal control and system events.
 *
 * Key features:
 * - Unix domain socket server with automatic cleanup on restart
 * - Length-prefixed binary protocol for message framing
 * - Message routing based on categories (terminal, system)
 * - Request/response pattern with timeout support
 * - WebSocket bridge for browser clients
 * - Automatic socket permission management (0600)
 *
 * @example
 * ```typescript
 * // Create and start the handler
 * const handler = new ControlUnixHandler();
 * await handler.start();
 *
 * // Check if Mac app is connected
 * if (handler.isMacAppConnected()) {
 *   // Send a control message
 *   const response = await handler.sendControlMessage({
 *     id: 'msg-123',
 *     type: 'request',
 *     category: 'terminal',
 *     action: 'spawn',
 *     payload: {
 *       sessionId: 'session-456',
 *       workingDirectory: '/Users/alice',
 *       command: 'vim'
 *     }
 *   });
 * }
 *
 * // Handle browser WebSocket connections
 * ws.on('connection', (socket) => {
 *   handler.handleBrowserConnection(socket, userId);
 * });
 * ```
 */
export class ControlUnixHandler {
  private pendingRequests = new Map<string, (response: ControlMessage) => void>();
  private macSocket: net.Socket | null = null;
  private unixServer: net.Server | null = null;
  private readonly socketPath: string;
  private handlers = new Map<ControlCategory, MessageHandler>();
  private messageBuffer = Buffer.alloc(0);

  constructor() {
    // Use control directory from environment or default
    const home = process.env.HOME || '/tmp';
    const controlDir = process.env.VIBETUNNEL_CONTROL_DIR || path.join(home, '.vibetunnel');
    const socketDir = controlDir;

    // Ensure directory exists
    try {
      fs.mkdirSync(socketDir, { recursive: true });
    } catch (_e) {
      // Ignore if already exists
    }

    this.socketPath = path.join(socketDir, 'control.sock');

    // Initialize handlers
    this.handlers.set('terminal', new TerminalHandler());
    this.handlers.set('system', new SystemHandler());
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

  isMacAppConnected(): boolean {
    return this.macSocket !== null && !this.macSocket.destroyed;
  }

  private handleMacConnection(socket: net.Socket) {
    logger.log('🔌 New Mac connection via UNIX socket');
    logger.log(`🔍 Socket info: local=${socket.localAddress}, remote=${socket.remoteAddress}`);

    // Close any existing Mac connection
    if (this.macSocket) {
      logger.log('⚠️ Closing existing Mac connection');
      this.macSocket.destroy();
    }

    this.macSocket = socket;
    logger.log('✅ Mac socket stored');

    // Set socket options for better handling of large messages
    socket.setNoDelay(true); // Disable Nagle's algorithm for lower latency
    logger.log('✅ Socket options set: NoDelay=true');

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
        `📥 Received from Mac: ${data.length} bytes, buffer size: ${this.messageBuffer.length}`
      );

      // Log first few bytes for debugging
      if (data.length > 0) {
        const preview = data.subarray(0, Math.min(data.length, 50));
        logger.debug(`📋 Data preview (first ${preview.length} bytes):`, preview.toString('hex'));
      }

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
          const messageStr = messageData.toString('utf-8');
          logger.debug(
            `📨 Parsing message (${messageLength} bytes): ${messageStr.substring(0, 100)}...`
          );

          const message: ControlMessage = JSON.parse(messageStr);
          logger.log(
            `✅ Parsed Mac message: category=${message.category}, action=${message.action}, id=${message.id}`
          );

          this.handleMacMessage(message);
        } catch (error) {
          logger.error('❌ Failed to parse Mac message:', error);
          logger.error('Message length:', messageLength);
          logger.error('Raw message buffer:', messageData.toString('utf-8'));
        }
      }
    });

    socket.on('error', (error) => {
      logger.error('❌ Mac socket error:', error);
      const errorObj = error as NodeJS.ErrnoException;
      logger.error('Error details:', {
        code: errorObj.code,
        syscall: errorObj.syscall,
        errno: errorObj.errno,
        message: errorObj.message,
      });

      // Check if it's a write-related error
      if (errorObj.code === 'EPIPE' || errorObj.code === 'ECONNRESET') {
        logger.error('🔴 Connection broken - Mac app likely closed the connection');
      }
    });

    socket.on('close', (hadError) => {
      logger.log(`🔌 Mac disconnected (hadError: ${hadError})`);
      logger.log(
        `📊 Socket state: destroyed=${socket.destroyed}, readable=${socket.readable}, writable=${socket.writable}`
      );

      if (socket === this.macSocket) {
        this.macSocket = null;
        logger.log('🧹 Cleared Mac socket reference');
      }
    });

    // Handle drain event for backpressure
    socket.on('drain', () => {
      logger.log('Mac socket drained - ready for more data');
    });

    // Add event for socket end (clean close)
    socket.on('end', () => {
      logger.log('📴 Mac socket received FIN packet (clean close)');
    });

    // Send ready event to Mac
    logger.log('📤 Sending initial system:ready event to Mac');
    this.sendToMac(createControlEvent('system', 'ready'));
    logger.log('✅ system:ready event sent');
  }

  handleBrowserConnection(ws: WebSocket, userId?: string) {
    logger.log('🌐 New browser WebSocket connection for control messages');
    logger.log(`👤 User ID: ${userId || 'unknown'}`);
    logger.log(
      `🔌 Mac socket status on browser connect: ${this.macSocket ? 'CONNECTED' : 'NOT CONNECTED'}`
    );

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
        logger.warn(`⚠️ Browser sent message for category: ${message.category}`);
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
    });

    ws.on('error', (error) => {
      logger.error('Browser WebSocket error:', error);
    });
  }

  private async handleMacMessage(message: ControlMessage) {
    logger.log(
      `Mac message - category: ${message.category}, action: ${message.action}, type: ${message.type}, id: ${message.id}`
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

    // Skip processing for response messages that aren't pending requests
    // This prevents response loops where error responses get processed again
    if (message.type === 'response') {
      logger.debug(
        `Ignoring response message that has no pending request: ${message.id}, action: ${message.action}`
      );
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
    // If Mac is not connected, return null immediately
    if (!this.isMacAppConnected()) {
      return null;
    }

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

  /**
   * Send a notification to the Mac app via the Unix socket
   */
  sendNotification(
    title: string,
    body: string,
    options?: {
      type?: 'session-start' | 'session-exit' | 'your-turn';
      sessionId?: string;
      sessionName?: string;
    }
  ): void {
    if (!this.macSocket) {
      logger.warn('[ControlUnixHandler] Cannot send notification - Mac app not connected');
      return;
    }

    const message: ControlMessage = {
      id: uuidv4(),
      type: 'event',
      category: 'notification',
      action: 'show',
      payload: {
        title,
        body,
        ...options,
      },
    };

    this.sendToMac(message);
    logger.info('[ControlUnixHandler] Sent notification:', { title, body, options });
  }

  sendToMac(message: ControlMessage): void {
    if (!this.macSocket) {
      logger.warn('⚠️ Cannot send to Mac - no socket connection');
      return;
    }

    if (this.macSocket.destroyed) {
      logger.warn('⚠️ Cannot send to Mac - socket is destroyed');
      this.macSocket = null;
      return;
    }

    try {
      // Convert message to JSON
      const jsonStr = JSON.stringify(message);
      const jsonData = Buffer.from(jsonStr, 'utf-8');

      // Create a buffer with 4-byte length header + JSON data
      const lengthBuffer = Buffer.allocUnsafe(4);
      lengthBuffer.writeUInt32BE(jsonData.length, 0);

      // Combine length header and data
      const fullData = Buffer.concat([lengthBuffer, jsonData]);

      // Log message details
      logger.log(
        `📤 Sending to Mac: ${message.category}:${message.action}, header: 4 bytes, payload: ${jsonData.length} bytes, total: ${fullData.length} bytes`
      );
      logger.log(`📋 Message ID being sent: ${message.id}`);
      logger.debug(`📝 Message content: ${jsonStr.substring(0, 200)}...`);

      // Log the actual bytes for the first few messages
      if (message.category === 'system' || message.action === 'get-initial-data') {
        logger.debug(`🔍 Length header bytes: ${lengthBuffer.toString('hex')}`);
        logger.debug(
          `🔍 First 50 bytes of full data: ${fullData.subarray(0, Math.min(50, fullData.length)).toString('hex')}`
        );
      }

      if (jsonData.length > 65536) {
        logger.warn(`⚠️ Large message to Mac: ${jsonData.length} bytes`);
      }

      // Write with error handling
      const result = this.macSocket.write(fullData, (error) => {
        if (error) {
          logger.error('❌ Error writing to Mac socket:', error);
          logger.error('Error details:', {
            // biome-ignore lint/suspicious/noExplicitAny: error object has non-standard properties
            code: (error as any).code,
            // biome-ignore lint/suspicious/noExplicitAny: error object has non-standard properties
            syscall: (error as any).syscall,
            message: error.message,
          });
          // Close the connection on write error
          this.macSocket?.destroy();
          this.macSocket = null;
        } else {
          logger.debug('✅ Write to Mac socket completed successfully');
        }
      });

      // Check if write was buffered (backpressure)
      if (!result) {
        logger.warn('⚠️ Socket write buffered - backpressure detected');
      } else {
        logger.debug('✅ Write immediate - no backpressure');
      }
    } catch (error) {
      logger.error('❌ Exception while sending to Mac:', error);
      this.macSocket?.destroy();
      this.macSocket = null;
    }
  }
}

export const controlUnixHandler = new ControlUnixHandler();
