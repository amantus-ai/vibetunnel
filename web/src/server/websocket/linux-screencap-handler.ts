import { EventEmitter } from 'node:events';
import { v4 as uuidv4 } from 'uuid';
import type { WebSocket } from 'ws';
import type { CaptureSession } from '../capture/desktop-capture-service.js';
import { desktopCaptureService } from '../capture/desktop-capture-service.js';
import { createLogger } from '../utils/logger.js';
import { LinuxWebRTCHandler } from './linux-webrtc-handler.js';

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

// Removed unused StreamMessage interface

export class LinuxScreencapHandler extends EventEmitter {
  private clients = new Map<string, WebSocket>();
  private sessions = new Map<string, CaptureSession>();
  private streamSubscriptions = new Map<string, () => void>();
  private webrtcHandlers = new Map<string, LinuxWebRTCHandler>();

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

    // Check if desktop capture service is ready
    if (!desktopCaptureService.isReady()) {
      const error = desktopCaptureService.getInitializationError();
      logger.error('Desktop capture service not ready:', error?.message);
      this.sendError(
        ws,
        'service-not-ready',
        error?.message || 'Desktop capture service not initialized'
      );
      ws.close(1011, error?.message || 'Service not available');
      return;
    }

    // Send ready event
    this.sendMessage(ws, {
      id: uuidv4(),
      type: 'event',
      category: 'screencap',
      action: 'ready',
      payload: {
        message: 'Linux screencap ready',
        capabilities: {
          supportsWebRTC: true, // Linux version now supports WebRTC via stream conversion
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

      case 'offer':
      case 'answer':
      case 'ice-candidate':
        await this.handleWebRTCSignaling(ws, clientId, message);
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
      // Check if service is ready
      if (!desktopCaptureService.isReady()) {
        const error = desktopCaptureService.getInitializationError();
        throw new Error(error?.message || 'Desktop capture service not initialized');
      }

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
      this.sendError(
        ws,
        message.id,
        error instanceof Error ? error.message : 'Failed to get initial data'
      );
    }
  }

  private async handleApiRequest(ws: WebSocket, message: ControlMessage): Promise<void> {
    const { endpoint } = message.payload as { endpoint: string };

    try {
      // Check if service is ready for capture-related endpoints
      if (endpoint === '/displays' || endpoint === '/capture/start') {
        if (!desktopCaptureService.isReady()) {
          const error = desktopCaptureService.getInitializationError();
          throw new Error(error?.message || 'Desktop capture service not initialized');
        }
      }

      let result: unknown;

      switch (endpoint) {
        case '/displays': {
          const capabilities = await desktopCaptureService.getCapabilities();
          const screens = capabilities.serverCapture.screens || [];
          logger.log(`Returning ${screens.length} displays:`, screens);
          result = {
            displays: screens,
            currentDisplayIndex: 0,
          };
          break;
        }

        case '/processes': {
          // Linux doesn't support window capture yet, return empty process list
          result = {
            processes: [],
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
      const {
        displayIndex = 0,
        quality = 'high',
        sessionId,
      } = message.payload as {
        mode?: string;
        displayIndex?: number;
        quality?: 'low' | 'medium' | 'high' | 'ultra';
        sessionId?: string;
      };

      // Start capture session
      const session = await desktopCaptureService.startCapture({
        displayIndex,
        quality,
        auth: message.userId,
      });

      logger.log(`Started capture session ${session.id} for client ${clientId}`);
      this.sessions.set(clientId, session);

      // Create WebRTC handler for this session
      const webrtcHandler = new LinuxWebRTCHandler(session, sessionId || session.id);
      this.webrtcHandlers.set(clientId, webrtcHandler);

      // Set up WebRTC event handlers BEFORE initializing
      webrtcHandler.on('offer', (offer) => {
        logger.log('Sending offer to client');
        this.sendMessage(ws, {
          id: uuidv4(),
          type: 'event',
          category: 'screencap',
          action: 'offer',
          payload: Buffer.from(JSON.stringify({ data: offer })).toString('base64'),
          sessionId: sessionId || session.id,
        });
      });

      // Initialize the WebRTC handler to set up the FFmpeg stream
      await webrtcHandler.initialize();
      logger.log('WebRTC handler initialized');

      // Create the offer immediately for WebSocket streaming
      logger.log('About to call createOffer()');
      try {
        await webrtcHandler.createOffer();
        logger.log('Created initial offer for WebSocket streaming');
      } catch (error) {
        logger.error('Failed to create offer:', error);
      }

      webrtcHandler.on('ice-candidate', (candidate) => {
        this.sendMessage(ws, {
          id: uuidv4(),
          type: 'event',
          category: 'screencap',
          action: 'ice-candidate',
          payload: Buffer.from(JSON.stringify({ data: candidate })).toString('base64'),
          sessionId: sessionId || session.id,
        });
      });

      // Set up video frame streaming
      let framesSent = 0;
      logger.log('Setting up video-frame listener for WebRTC handler');
      webrtcHandler.on('video-frame', (frameData: Buffer) => {
        // Send video frames as binary WebSocket messages
        if (ws.readyState === ws.OPEN) {
          framesSent++;
          if (framesSent <= 5 || framesSent % 100 === 1) {
            logger.log(`Sending frame ${framesSent}, size: ${frameData.length} bytes to WebSocket`);
          }
          // Send frame with a header indicating it's a video frame
          const header = Buffer.from('VF'); // Video Frame marker
          const frame = Buffer.concat([header, frameData]);
          ws.send(frame, { binary: true });
        } else {
          logger.warn(`WebSocket not open for frame ${framesSent}, state: ${ws.readyState}`);
        }
      });

      webrtcHandler.on('stream-error', (error) => {
        logger.error('Stream error:', error);
        this.sendMessage(ws, {
          id: uuidv4(),
          type: 'event',
          category: 'screencap',
          action: 'stream-error',
          payload: { error: error.message },
        });
      });

      webrtcHandler.on('stream-ended', () => {
        logger.log('Stream ended');
        this.sendMessage(ws, {
          id: uuidv4(),
          type: 'event',
          category: 'screencap',
          action: 'stream-ended',
          payload: {},
        });
      });

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

      // Clean up WebRTC handler
      const webrtcHandler = this.webrtcHandlers.get(clientId);
      if (webrtcHandler) {
        webrtcHandler.close();
        this.webrtcHandlers.delete(clientId);
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

    // Clean up WebRTC handler
    const webrtcHandler = this.webrtcHandlers.get(clientId);
    if (webrtcHandler) {
      webrtcHandler.close();
      this.webrtcHandlers.delete(clientId);
    }

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

  private async handleWebRTCSignaling(
    _ws: WebSocket,
    clientId: string,
    message: ControlMessage
  ): Promise<void> {
    const webrtcHandler = this.webrtcHandlers.get(clientId);
    if (!webrtcHandler) {
      logger.error('No WebRTC handler found for client', clientId);
      return;
    }

    try {
      // Decode base64 payload
      const decodedPayload =
        typeof message.payload === 'string'
          ? JSON.parse(Buffer.from(message.payload, 'base64').toString())
          : message.payload;

      switch (message.action) {
        case 'answer':
          if (decodedPayload?.data) {
            await webrtcHandler.handleAnswer(decodedPayload.data);
          }
          break;

        case 'ice-candidate':
          if (decodedPayload?.data) {
            await webrtcHandler.handleIceCandidate(decodedPayload.data);
          }
          break;
      }
    } catch (error) {
      logger.error(`Failed to handle WebRTC ${message.action}:`, error);
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
