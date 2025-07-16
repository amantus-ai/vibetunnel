import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { WebSocket } from 'ws';
import { createLogger } from '../utils/logger.js';
import type { CaptureSession } from './desktop-capture-service.js';

const logger = createLogger('stream-handler');

export interface StreamClient {
  id: string;
  socket: WebSocket;
  sessionId: string;
  lastActivity: number;
}

/**
 * Handles streaming captured video to WebSocket clients
 * The client will handle WebRTC peer connections
 */
export class StreamHandler extends EventEmitter {
  private clients = new Map<string, StreamClient>();
  private streamingSessions = new Map<string, Set<string>>(); // sessionId -> Set of clientIds

  /**
   * Add a WebSocket client for streaming
   */
  addClient(clientId: string, socket: WebSocket, sessionId: string): void {
    logger.log(`Adding stream client ${clientId} for session ${sessionId}`);

    const client: StreamClient = {
      id: clientId,
      socket,
      sessionId,
      lastActivity: Date.now(),
    };

    this.clients.set(clientId, client);

    // Track session clients
    if (!this.streamingSessions.has(sessionId)) {
      this.streamingSessions.set(sessionId, new Set());
    }
    this.streamingSessions.get(sessionId)!.add(clientId);

    // Handle client disconnect
    socket.on('close', () => {
      this.removeClient(clientId);
    });

    socket.on('error', (error) => {
      logger.error(`Client ${clientId} error:`, error);
      this.removeClient(clientId);
    });

    // Handle client messages
    socket.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleClientMessage(clientId, message);
      } catch (error) {
        logger.error(`Invalid message from client ${clientId}:`, error);
      }
    });
  }

  /**
   * Remove a client
   */
  removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    logger.log(`Removing stream client ${clientId}`);

    // Remove from session tracking
    const sessionClients = this.streamingSessions.get(client.sessionId);
    if (sessionClients) {
      sessionClients.delete(clientId);
      if (sessionClients.size === 0) {
        this.streamingSessions.delete(client.sessionId);
        this.emit('session-clients-empty', client.sessionId);
      }
    }

    this.clients.delete(clientId);

    // Close socket if still open
    if (client.socket.readyState === client.socket.OPEN) {
      client.socket.close();
    }
  }

  /**
   * Handle messages from clients
   */
  private handleClientMessage(clientId: string, message: any): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.lastActivity = Date.now();

    switch (message.type) {
      case 'ping':
        // Respond to keep-alive
        this.sendToClient(clientId, { type: 'pong' });
        break;

      case 'quality':
        // Client requesting quality change
        this.emit('quality-request', {
          sessionId: client.sessionId,
          clientId,
          quality: message.quality,
        });
        break;

      default:
        logger.warn(`Unknown message type from client ${clientId}: ${message.type}`);
    }
  }

  /**
   * Stream video data to clients of a session
   */
  streamToSession(sessionId: string, captureSession: CaptureSession): void {
    const clients = this.streamingSessions.get(sessionId);
    if (!clients || clients.size === 0) {
      logger.log(`No clients for session ${sessionId}`);
      return;
    }

    if (!captureSession.captureStream) {
      logger.error(`No capture stream for session ${sessionId}`);
      return;
    }

    const stream = captureSession.captureStream.stream;

    // Send initial metadata
    clients.forEach((clientId) => {
      this.sendToClient(clientId, {
        type: 'stream-start',
        sessionId,
        codec: 'vp8', // Or detect from capture options
        displayServer: captureSession.displayServer,
      });
    });

    // Stream video chunks
    stream.on('data', (chunk: Buffer) => {
      // Send chunk to all clients
      clients.forEach((clientId) => {
        const client = this.clients.get(clientId);
        if (client && client.socket.readyState === client.socket.OPEN) {
          // Send as binary frame
          client.socket.send(chunk, { binary: true });
        }
      });
    });

    stream.on('end', () => {
      logger.log(`Stream ended for session ${sessionId}`);
      clients.forEach((clientId) => {
        this.sendToClient(clientId, { type: 'stream-end', sessionId });
      });
    });

    stream.on('error', (error) => {
      logger.error(`Stream error for session ${sessionId}:`, error);
      clients.forEach((clientId) => {
        this.sendToClient(clientId, {
          type: 'stream-error',
          sessionId,
          error: error.message,
        });
      });
    });
  }

  /**
   * Send a message to a specific client
   */
  private sendToClient(clientId: string, message: any): void {
    const client = this.clients.get(clientId);
    if (client && client.socket.readyState === client.socket.OPEN) {
      client.socket.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcast a message to all clients of a session
   */
  broadcastToSession(sessionId: string, message: any): void {
    const clients = this.streamingSessions.get(sessionId);
    if (!clients) return;

    clients.forEach((clientId) => {
      this.sendToClient(clientId, message);
    });
  }

  /**
   * Get number of clients for a session
   */
  getSessionClientCount(sessionId: string): number {
    return this.streamingSessions.get(sessionId)?.size || 0;
  }

  /**
   * Clean up inactive clients
   */
  cleanupInactiveClients(maxInactivityMs = 60000): void {
    const now = Date.now();
    const toRemove: string[] = [];

    this.clients.forEach((client, clientId) => {
      if (now - client.lastActivity > maxInactivityMs) {
        toRemove.push(clientId);
      }
    });

    toRemove.forEach((clientId) => {
      logger.log(`Removing inactive client ${clientId}`);
      this.removeClient(clientId);
    });
  }
}

// Export singleton
export const streamHandler = new StreamHandler();

// Periodic cleanup
setInterval(() => {
  streamHandler.cleanupInactiveClients();
}, 30000); // Every 30 seconds
