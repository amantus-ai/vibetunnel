import { type WebSocket, WebSocket as WS } from 'ws';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('screencap-signal');

interface SignalMessage {
  type: 'start-capture' | 'offer' | 'answer' | 'ice-candidate' | 'error' | 'ready' | 'mac-ready';
  mode?: 'desktop' | 'window';
  windowId?: number;
  displayIndex?: number;
  data?: unknown; // Will contain SDP or ICE candidate data
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

  handleConnection(ws: WebSocket, userId: string) {
    logger.log(`New WebSocket connection from user ${userId}`);

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

      default:
        logger.warn(`Unknown message type: ${message.type}`);
    }
  }

  private handleMacReady(ws: WebSocket, message: SignalMessage) {
    logger.log('Mac peer ready:', message.mode);

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

    // Store browser peer info
    this.browserPeers.set(ws, {
      ws,
      mode: message.mode,
      windowId: message.windowId,
      displayIndex: message.displayIndex,
    });

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
}

export const screencapSignalHandler = new ScreencapSignalHandler();
