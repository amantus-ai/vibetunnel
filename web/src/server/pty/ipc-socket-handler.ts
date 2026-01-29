/**
 * IPCSocketHandler - Handles Unix socket communication for PTY sessions
 *
 * Responsible for:
 * - Creating and managing IPC sockets for session communication
 * - Handling incoming socket messages (stdin, control commands, etc.)
 * - Managing client connections
 */

import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import type { TitleMode } from '../../shared/types.js';
import { createLogger } from '../utils/logger.js';
import {
  type ControlCommand,
  MessageParser,
  MessageType,
  parsePayload,
} from './socket-protocol.js';
import type { PtySession } from './types.js';

const logger = createLogger('ipc-socket-handler');

/**
 * Handler for control messages
 */
export interface ControlMessageHandler {
  handleResize(sessionId: string, cols: number, rows: number): void;
  handleKill(sessionId: string, signal: string | number): void;
  handleResetSize(sessionId: string): void;
  handleTitleUpdate(sessionId: string, title: string): void;
}

/**
 * Handler for stdin data
 */
export interface StdinDataHandler {
  handleStdinData(sessionId: string, data: string): void;
}

/**
 * Configuration for IPCSocketHandler
 */
export interface IPCSocketHandlerConfig {
  /** Handler for control messages */
  controlHandler: ControlMessageHandler;
  /** Handler for stdin data */
  stdinHandler: StdinDataHandler;
}

/**
 * Handles Unix socket communication for PTY sessions
 */
export class IPCSocketHandler {
  private socketServers = new Map<string, net.Server>();
  private connectedClients = new Map<string, Set<net.Socket>>();

  constructor(private readonly config: IPCSocketHandlerConfig) {}

  /**
   * Setup IPC socket for a session
   */
  setupSocket(session: PtySession): void {
    if (!session.ptyProcess) {
      logger.error(`No PTY process found for session ${session.id}`);
      return;
    }

    // Create Unix domain socket for all IPC
    // IMPORTANT: macOS has a 104 character limit for Unix socket paths
    const socketPath = path.join(session.controlDir, 'ipc.sock');

    // Verify the socket path isn't too long
    if (socketPath.length > 103) {
      const error = new Error(`Socket path too long: ${socketPath.length} characters`);
      logger.error(`Socket path too long (${socketPath.length} chars): ${socketPath}`);
      logger.error(
        `macOS limit is 103 characters. Consider using shorter session IDs or control paths.`
      );
      throw error;
    }

    try {
      // Remove existing socket if it exists
      try {
        fs.unlinkSync(socketPath);
      } catch (_e) {
        // Socket doesn't exist, this is expected
      }

      // Initialize connected clients set
      const clients = new Set<net.Socket>();
      this.connectedClients.set(session.id, clients);

      // Create Unix domain socket server with framed message protocol
      const inputServer = net.createServer((client) => {
        const parser = new MessageParser();
        client.setNoDelay(true);

        // Add client to connected clients set
        clients.add(client);
        logger.debug(
          `Client connected to session ${session.id}, total clients: ${clients.size}`
        );

        client.on('data', (chunk) => {
          parser.addData(chunk);

          for (const { type, payload } of parser.parseMessages()) {
            this.handleSocketMessage(session, type, payload);
          }
        });

        client.on('error', (err) => {
          logger.debug(`Client socket error for session ${session.id}:`, err);
        });

        client.on('close', () => {
          clients.delete(client);
          logger.debug(
            `Client disconnected from session ${session.id}, remaining clients: ${clients.size}`
          );
        });
      });

      inputServer.listen(socketPath, () => {
        // Make socket writable by all
        try {
          fs.chmodSync(socketPath, 0o666);
        } catch (e) {
          logger.debug(`Failed to chmod input socket for session ${session.id}:`, e);
        }
        logger.debug(`Input socket created for session ${session.id}`);
      });

      // Store server reference for cleanup
      this.socketServers.set(session.id, inputServer);

      // Also store in session for backward compatibility
      session.inputSocketServer = inputServer;
      session.connectedClients = clients;
    } catch (error) {
      logger.error(`Failed to create input socket for session ${session.id}:`, error);
      throw error;
    }
  }

  /**
   * Handle incoming socket messages
   */
  private handleSocketMessage(session: PtySession, type: MessageType, payload: Buffer): void {
    try {
      const data = parsePayload(type, payload);

      switch (type) {
        case MessageType.STDIN_DATA: {
          const text = data as string;
          this.config.stdinHandler.handleStdinData(session.id, text);
          break;
        }

        case MessageType.CONTROL_CMD: {
          const cmd = data as ControlCommand;
          this.handleControlMessage(session, cmd);
          break;
        }

        case MessageType.STATUS_UPDATE: {
          logger.debug(`Ignoring status update for session ${session.id}`);
          break;
        }

        case MessageType.HEARTBEAT:
          // Heartbeat received - no action needed for now
          break;

        default:
          logger.debug(`Unknown message type ${type} for session ${session.id}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to handle socket message for session ${session.id}: ${errorMessage}`);
    }
  }

  /**
   * Handle control messages from control pipe
   */
  private handleControlMessage(session: PtySession, message: Record<string, unknown>): void {
    if (
      message.cmd === 'resize' &&
      typeof message.cols === 'number' &&
      typeof message.rows === 'number'
    ) {
      this.config.controlHandler.handleResize(session.id, message.cols, message.rows);
    } else if (message.cmd === 'kill') {
      const signal =
        typeof message.signal === 'string' || typeof message.signal === 'number'
          ? message.signal
          : 'SIGTERM';
      this.config.controlHandler.handleKill(session.id, signal);
    } else if (message.cmd === 'reset-size') {
      this.config.controlHandler.handleResetSize(session.id);
    } else if (message.cmd === 'update-title' && typeof message.title === 'string') {
      // Handle title update via IPC (used by vt title command)
      logger.debug(`[IPC] Received title update for session ${session.id}: "${message.title}"`);
      this.config.controlHandler.handleTitleUpdate(session.id, message.title);
    }
  }

  /**
   * Get connected clients for a session
   */
  getConnectedClients(sessionId: string): Set<net.Socket> | undefined {
    return this.connectedClients.get(sessionId);
  }

  /**
   * Cleanup resources for a session
   */
  cleanupSession(sessionId: string): void {
    // Clean up connected clients
    const clients = this.connectedClients.get(sessionId);
    if (clients) {
      for (const client of clients) {
        try {
          client.destroy();
        } catch (_e) {
          // Client already destroyed
        }
      }
      clients.clear();
      this.connectedClients.delete(sessionId);
    }

    // Clean up socket server
    const server = this.socketServers.get(sessionId);
    if (server) {
      server.close();
      server.unref();
      this.socketServers.delete(sessionId);
    }
  }

  /**
   * Shutdown all sockets
   */
  shutdown(): void {
    // Clean up all clients
    for (const [sessionId, clients] of this.connectedClients) {
      for (const client of clients) {
        try {
          client.destroy();
        } catch (_e) {
          // Client already destroyed
        }
      }
      clients.clear();
    }
    this.connectedClients.clear();

    // Clean up all servers
    for (const [_sessionId, server] of this.socketServers) {
      try {
        server.close();
        server.unref();
      } catch (_e) {
        // Server already closed
      }
    }
    this.socketServers.clear();
  }
}
