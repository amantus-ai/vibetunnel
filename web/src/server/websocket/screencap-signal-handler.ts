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
  mode?: 'desktop' | 'window';
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

interface PeerConnection {
  ws: WebSocket;
  mode?: 'desktop' | 'window';
  windowId?: number;
  displayIndex?: number;
}

export class ScreencapSignalHandler {
  private macPeer: PeerConnection | null = null;
  private browserPeers: Map<WebSocket, PeerConnection> = new Map();
  private pendingRequests: Map<string, (response: unknown) => void> = new Map();

  handleConnection(ws: WebSocket, userId: string) {
    logger.log(`New WebSocket connection from user ${userId}`);

    // Initially assume it's a browser peer (Mac peer will identify itself with mac-ready)
    this.browserPeers.set(ws, { ws });

    // Send initial ready message
    this.sendToPeer(ws, { type: 'ready' });

    ws.on('message', (data) => {
      try {
        const message: SignalMessage = JSON.parse(data.toString());
        this.handleMessage(ws, message);
      } catch (error) {
        logger.error('Failed to parse message:', error);
        this.sendError(ws, 'Invalid message format');
      }
    });

    ws.on('close', () => {
      logger.log('WebSocket connection closed');
      this.handleDisconnect(ws);
    });

    ws.on('error', (error) => {
      logger.error('WebSocket error:', error);
      this.handleDisconnect(ws);
    });
  }

  private handleMessage(ws: WebSocket, message: SignalMessage) {
    switch (message.type) {
      case 'mac-ready':
        // Mac app is ready
        this.handleMacReady(ws, message);
        break;

      case 'start-capture':
        // Browser wants to start capture
        this.handleStartCapture(ws, message);
        break;

      case 'offer':
        // Mac app sends offer
        this.handleOffer(ws, message);
        break;

      case 'answer':
        // Browser sends answer
        this.handleAnswer(ws, message);
        break;

      case 'ice-candidate':
        // Forward ICE candidates
        this.handleIceCandidate(ws, message);
        break;

      case 'api-request':
        // Forward API request from browser to Mac
        this.handleApiRequest(ws, message);
        break;

      case 'api-response':
        // Forward API response from Mac to browser
        this.handleApiResponse(ws, message);
        break;

      default:
        logger.warn(`Unknown message type: ${message.type}`);
    }
  }

  private handleMacReady(ws: WebSocket, message: SignalMessage) {
    logger.log('Mac peer ready:', message.mode);

    // Remove from browser peers if it was there
    this.browserPeers.delete(ws);

    // Store Mac peer
    this.macPeer = {
      ws,
      mode: message.mode as 'desktop' | 'window',
    };

    // If we have waiting browser peers, notify them
    this.browserPeers.forEach((peer) => {
      this.sendToPeer(peer.ws, {
        type: 'ready',
        data: 'Mac peer connected',
      });
    });
  }

  private handleStartCapture(ws: WebSocket, message: SignalMessage) {
    logger.log('Browser requesting capture:', message);

    // Update browser peer info with capture details
    const existingPeer = this.browserPeers.get(ws);
    if (existingPeer) {
      existingPeer.mode = message.mode;
      existingPeer.windowId = message.windowId;
      existingPeer.displayIndex = message.displayIndex;
    }

    // If we have a Mac peer, notify it to create an offer
    if (this.macPeer) {
      this.sendToMac({
        type: 'start-capture',
        mode: message.mode,
        windowId: message.windowId,
        displayIndex: message.displayIndex,
      });
    } else {
      // Mac app not connected yet
      this.sendError(
        ws,
        'Mac app not connected. Please ensure VibeTunnel is running with WebRTC enabled.'
      );
    }
  }

  private handleOffer(ws: WebSocket, message: SignalMessage) {
    logger.log('Received offer from Mac app');

    // Store Mac peer
    this.macPeer = { ws };

    // Forward offer to all browser peers
    this.browserPeers.forEach((peer) => {
      this.sendToPeer(peer.ws, {
        type: 'offer',
        data: message.data,
      });
    });
  }

  private handleAnswer(_ws: WebSocket, message: SignalMessage) {
    logger.log('Received answer from browser');

    // Forward answer to Mac app
    if (this.macPeer) {
      this.sendToMac({
        type: 'answer',
        data: message.data,
      });
    }
  }

  private handleIceCandidate(ws: WebSocket, message: SignalMessage) {
    // Determine if this is from Mac or browser and forward accordingly
    if (ws === this.macPeer?.ws) {
      // From Mac, forward to browsers
      this.browserPeers.forEach((peer) => {
        this.sendToPeer(peer.ws, {
          type: 'ice-candidate',
          data: message.data,
        });
      });
    } else {
      // From browser, forward to Mac
      if (this.macPeer) {
        this.sendToMac({
          type: 'ice-candidate',
          data: message.data,
        });
      }
    }
  }

  private handleDisconnect(ws: WebSocket) {
    if (ws === this.macPeer?.ws) {
      logger.log('Mac peer disconnected');
      this.macPeer = null;

      // Notify all browsers
      this.browserPeers.forEach((peer) => {
        this.sendError(peer.ws, 'Mac peer disconnected');
      });
    } else {
      logger.log('Browser peer disconnected');
      this.browserPeers.delete(ws);
    }
  }

  private sendToMac(message: SignalMessage) {
    if (this.macPeer && this.macPeer.ws.readyState === WS.OPEN) {
      this.macPeer.ws.send(JSON.stringify(message));
    }
  }

  private sendToPeer(ws: WebSocket, message: SignalMessage) {
    if (ws.readyState === WS.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private sendError(ws: WebSocket, error: string) {
    this.sendToPeer(ws, {
      type: 'error',
      data: error,
    });
  }

  private handleApiRequest(ws: WebSocket, message: SignalMessage) {
    logger.log(`API request received: ${message.method} ${message.endpoint}`);

    // Only browser peers can make API requests
    if (!this.browserPeers.has(ws)) {
      logger.error('API request from non-browser peer');
      this.sendError(ws, 'Only browser peers can make API requests');
      return;
    }

    if (!message.requestId || !message.method || !message.endpoint) {
      logger.error('Invalid API request format:', message);
      this.sendError(ws, 'Invalid API request format');
      return;
    }

    // Forward to Mac peer if connected
    if (this.macPeer) {
      logger.log(`Forwarding API request to Mac peer: ${message.requestId}`);
      this.sendToMac({
        type: 'api-request',
        requestId: message.requestId,
        method: message.method,
        endpoint: message.endpoint,
        params: message.params,
        sessionId: message.sessionId,
      });
    } else {
      logger.warn('Mac peer not connected, sending error response');
      // Send error response if Mac not connected
      this.sendToPeer(ws, {
        type: 'api-response',
        requestId: message.requestId,
        error: 'Mac peer not connected',
      });
    }
  }

  private handleApiResponse(ws: WebSocket, message: SignalMessage) {
    // Only Mac peer can send API responses
    if (ws !== this.macPeer?.ws) {
      logger.warn('Received API response from non-Mac peer');
      return;
    }

    if (!message.requestId) {
      logger.error('API response missing requestId');
      return;
    }

    logger.log(`API response received from Mac: ${message.requestId}`);

    // Forward response to all browser peers
    // In future, could track which browser made which request
    this.browserPeers.forEach((peer) => {
      logger.log(`Forwarding API response to browser peer`);
      this.sendToPeer(peer.ws, {
        type: 'api-response',
        requestId: message.requestId,
        result: message.result,
        error: message.error,
      });
    });
  }
}

export const screencapSignalHandler = new ScreencapSignalHandler();
