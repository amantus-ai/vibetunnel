import { EventEmitter } from 'node:events';
import { v4 as uuidv4 } from 'uuid';
import type { WebSocket } from 'ws';
import type { CaptureSession } from '../capture/desktop-capture-service.js';
import { desktopCaptureService } from '../capture/desktop-capture-service.js';
import { streamHandler } from '../capture/stream-handler.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('linux-screencap-handler');

// Control message types to match Mac implementation
interface ControlMessage {
  id: string;
  type: 'request' | 'response' | 'event';
  category: 'screencap';
  action: string;
  payload?: unknown;
  sessionId?: string;
  userId?: string;
  error?: string;
}

interface StreamMessage {
  type: 'frame' | 'error' | 'end' | 'stats';
  sessionId: string;
  data?: ArrayBuffer;
  error?: string;
  stats?: {
    fps: number;
    bitrate: number;
    frameCount: number;
  };
}

export class LinuxScreencapHandler extends EventEmitter {
  private clients = new Map<string, WebSocket>();
  private sessions = new Map<string, CaptureSession>();
  private streamSubscriptions = new Map<string, () => void>();

  constructor() {
    super();
    logger.log('Linux screencap handler initialized');
  }

  /**
   * Handle browser WebSocket connection
   */
  handleBrowserConnection(ws: WebSocket, userId: string): void {
    const clientId = uuidv4();
    logger.log(`New screencap WebSocket connection from user ${userId}, clientId: ${clientId}`);

    this.clients.set(clientId, ws);

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString()) as ControlMessage;
        logger.log(`Received message: ${message.action}`, message);

        // Add userId to message if not present
        if (!message.userId) {
          message.userId = userId;
        }

        await this.handleMessage(ws, clientId, message);
      } catch (error) {
        logger.error('Failed to handle WebSocket message:', error);
        this.sendError(ws, 'invalid-message', 'Failed to parse message');
      }
    });

    ws.on('close', () => {
      logger.log(`WebSocket connection closed for client ${clientId}`);
      this.handleDisconnect(clientId);
    });

    ws.on('error', (error) => {
      logger.error(`WebSocket error for client ${clientId}:`, error);
      this.handleDisconnect(clientId);
    });

    // Send ready event
    this.sendMessage(ws, {
      id: uuidv4(),
      type: 'event',
      category: 'screencap',
      action: 'ready',
      payload: {
        message: 'Linux screencap ready',
        capabilities: {
          supportsWebRTC: false, // Linux version uses direct WebSocket streaming
          supportsH264: true,
          supportsVP8: true,
          supportsVP9: true,
        },
      },
    });
  }

  private async handleMessage(
    ws: WebSocket,
    clientId: string,
    message: ControlMessage
  ): Promise<void> {
    switch (message.action) {
      case 'get-initial-data':
        await this.handleGetInitialData(ws, message);
        break;

      case 'api-request':
        await this.handleApiRequest(ws, message);
        break;

      case 'start-capture':
        await this.handleStartCapture(ws, clientId, message);
        break;

      case 'stop-capture':
        await this.handleStopCapture(ws, clientId, message);
        break;

      case 'ping':
        this.sendMessage(ws, {
          id: message.id,
          type: 'response',
          category: 'screencap',
          action: 'pong',
          payload: { timestamp: Date.now() / 1000 },
        });
        break;

      default:
        logger.warn(`Unknown action: ${message.action}`);
        this.sendError(ws, message.id, `Unknown action: ${message.action}`);
    }
  }

  private async handleGetInitialData(ws: WebSocket, message: ControlMessage): Promise<void> {
    try {
      const capabilities = await desktopCaptureService.getCapabilities();

      this.sendMessage(ws, {
        id: message.id,
        type: 'response',
        category: 'screencap',
        action: 'initial-data',
        payload: {
          capabilities,
          sessions: await desktopCaptureService.getAllSessions(),
        },
      });
    } catch (error) {
      logger.error('Failed to get initial data:', error);
      this.sendError(ws, message.id, 'Failed to get initial data');
    }
  }

  private async handleApiRequest(ws: WebSocket, message: ControlMessage): Promise<void> {
    const { endpoint, method = 'GET', body } = message.payload as any;

    try {
      let result: any;

      switch (endpoint) {
        case '/displays': {
          const capabilities = await desktopCaptureService.getCapabilities();
          result = {
            displays: capabilities.serverCapture.screens || [],
            currentDisplayIndex: 0,
          };
          break;
        }

        case '/capture/start':
          // This is handled by start-capture action
          result = { message: 'Use start-capture action instead' };
          break;

        case '/capture/stop':
          // This is handled by stop-capture action
          result = { message: 'Use stop-capture action instead' };
          break;

        default:
          throw new Error(`Unknown endpoint: ${endpoint}`);
      }

      this.sendMessage(ws, {
        id: message.id,
        type: 'response',
        category: 'screencap',
        action: 'api-response',
        payload: result,
      });
    } catch (error) {
      logger.error(`API request failed: ${endpoint}`, error);
      this.sendError(ws, message.id, error instanceof Error ? error.message : 'API request failed');
    }
  }

  private async handleStartCapture(
    ws: WebSocket,
    clientId: string,
    message: ControlMessage
  ): Promise<void> {
    try {
      const { mode = 'desktop', displayIndex = 0, quality = 'high' } = message.payload as any;

      // Start capture session
      const session = await desktopCaptureService.startCapture({
        mode: 'server',
        displayIndex,
        quality,
        auth: message.userId,
      });

      logger.log(`Started capture session ${session.id} for client ${clientId}`);
      this.sessions.set(clientId, session);

      // Start streaming to session
      streamHandler.streamToSession(session.id, session);

      // Subscribe to stream updates for forwarding frames
      const unsubscribe = streamHandler.subscribe(session.id, (frame: ArrayBuffer) => {
        this.sendStreamFrame(ws, session.id, frame);
      });

      this.streamSubscriptions.set(clientId, unsubscribe);

      // Send success response
      this.sendMessage(ws, {
        id: message.id,
        type: 'response',
        category: 'screencap',
        action: 'capture-started',
        payload: {
          sessionId: session.id,
          displayServer: session.displayServer,
          resolution: {
            mode: session.mode,
            displayServer: session.displayServer,
          },
        },
      });

      // Send state change event
      this.sendMessage(ws, {
        id: uuidv4(),
        type: 'event',
        category: 'screencap',
        action: 'state-change',
        payload: {
          state: 'capturing',
          sessionId: session.id,
        },
      });
    } catch (error) {
      logger.error('Failed to start capture:', error);
      this.sendError(
        ws,
        message.id,
        error instanceof Error ? error.message : 'Failed to start capture'
      );
    }
  }

  private async handleStopCapture(
    ws: WebSocket,
    clientId: string,
    message: ControlMessage
  ): Promise<void> {
    try {
      const session = this.sessions.get(clientId);
      if (!session) {
        throw new Error('No active capture session');
      }

      // Unsubscribe from stream
      const unsubscribe = this.streamSubscriptions.get(clientId);
      if (unsubscribe) {
        unsubscribe();
        this.streamSubscriptions.delete(clientId);
      }

      // Stop capture
      await desktopCaptureService.stopCapture(session.id);

      this.sessions.delete(clientId);

      // Send success response
      this.sendMessage(ws, {
        id: message.id,
        type: 'response',
        category: 'screencap',
        action: 'capture-stopped',
        payload: {
          sessionId: session.id,
        },
      });

      // Send state change event
      this.sendMessage(ws, {
        id: uuidv4(),
        type: 'event',
        category: 'screencap',
        action: 'state-change',
        payload: {
          state: 'idle',
        },
      });
    } catch (error) {
      logger.error('Failed to stop capture:', error);
      this.sendError(
        ws,
        message.id,
        error instanceof Error ? error.message : 'Failed to stop capture'
      );
    }
  }

  private handleDisconnect(clientId: string): void {
    // Clean up client
    this.clients.delete(clientId);

    // Clean up any active session
    const session = this.sessions.get(clientId);
    if (session) {
      logger.log(`Cleaning up session ${session.id} for disconnected client ${clientId}`);

      // Unsubscribe from stream
      const unsubscribe = this.streamSubscriptions.get(clientId);
      if (unsubscribe) {
        unsubscribe();
        this.streamSubscriptions.delete(clientId);
      }

      // Stop capture
      desktopCaptureService.stopCapture(session.id).catch((error) => {
        logger.error('Failed to stop capture on disconnect:', error);
      });

      this.sessions.delete(clientId);
    }
  }

  private sendStreamFrame(ws: WebSocket, sessionId: string, frame: ArrayBuffer): void {
    if (ws.readyState === ws.OPEN) {
      const message: StreamMessage = {
        type: 'frame',
        sessionId,
        data: frame,
      };

      // Send as binary message
      ws.send(
        Buffer.from(
          JSON.stringify({
            type: 'stream-data',
            sessionId,
          })
        ),
        { binary: false }
      );
      ws.send(frame, { binary: true });
    }
  }

  private sendMessage(ws: WebSocket, message: ControlMessage): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private sendError(ws: WebSocket, id: string, error: string): void {
    this.sendMessage(ws, {
      id,
      type: 'response',
      category: 'screencap',
      action: 'error',
      error,
    });
  }
}

// Singleton instance
export const linuxScreencapHandler = new LinuxScreencapHandler();
