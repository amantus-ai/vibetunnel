/**
 * WebSocket Input Handler for VibeTunnel
 *
 * Handles WebSocket connections for low-latency input transmission.
 * Optimized for speed:
 * - Fire-and-forget input (no ACKs)
 * - Minimal message parsing
 * - Direct PTY forwarding
 */

import type { WebSocket as WSWebSocket } from 'ws';
import type { SessionInput, SpecialKey } from '../../shared/types.js';
import type { PtyManager } from '../pty/index.js';
import type { ActivityMonitor } from '../services/activity-monitor.js';
import type { AuthService } from '../services/auth-service.js';
import type { RemoteRegistry } from '../services/remote-registry.js';
import type { TerminalManager } from '../services/terminal-manager.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('websocket-input');

interface WebSocketInputHandlerOptions {
  ptyManager: PtyManager;
  terminalManager: TerminalManager;
  activityMonitor: ActivityMonitor;
  remoteRegistry: RemoteRegistry | null;
  authService: AuthService;
  isHQMode: boolean;
}

export class WebSocketInputHandler {
  private ptyManager: PtyManager;
  private terminalManager: TerminalManager;
  private activityMonitor: ActivityMonitor;
  private remoteRegistry: RemoteRegistry | null;
  private authService: AuthService;
  private isHQMode: boolean;
  private remoteConnections: Map<string, WebSocket> = new Map();

  constructor(options: WebSocketInputHandlerOptions) {
    this.ptyManager = options.ptyManager;
    this.terminalManager = options.terminalManager;
    this.activityMonitor = options.activityMonitor;
    this.remoteRegistry = options.remoteRegistry;
    this.authService = options.authService;
    this.isHQMode = options.isHQMode;
  }

  private async connectToRemote(
    remoteUrl: string,
    sessionId: string,
    token: string
  ): Promise<WebSocket> {
    const wsUrl = remoteUrl.replace(/^https?:/, (match) => (match === 'https:' ? 'wss:' : 'ws:'));
    const fullUrl = `${wsUrl}/ws/input?sessionId=${sessionId}&token=${encodeURIComponent(token)}`;

    logger.log(`Establishing proxy connection to remote: ${fullUrl}`);

    const remoteWs = new WebSocket(fullUrl);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        remoteWs.close();
        reject(new Error('Remote WebSocket connection timeout'));
      }, 5000);

      remoteWs.addEventListener('open', () => {
        clearTimeout(timeout);
        logger.log(`Remote WebSocket proxy established for session ${sessionId}`);
        resolve(remoteWs);
      });

      remoteWs.addEventListener('error', (error) => {
        clearTimeout(timeout);
        logger.error(`Remote WebSocket error for session ${sessionId}:`, error);
        reject(error);
      });
    });
  }

  async handleConnection(ws: WSWebSocket, sessionId: string, userId: string): Promise<void> {
    logger.log(`WebSocket input connection established for session ${sessionId}, user ${userId}`);

    // Check if this is a remote session in HQ mode
    let remoteWs: WebSocket | null = null;
    if (this.isHQMode && this.remoteRegistry) {
      const remote = this.remoteRegistry.getRemoteBySessionId(sessionId);
      if (remote) {
        logger.log(
          `Session ${sessionId} is on remote ${remote.name}, establishing proxy connection`
        );

        try {
          remoteWs = await this.connectToRemote(remote.url, sessionId, remote.token);
          this.remoteConnections.set(sessionId, remoteWs);

          // Set up remote connection error handling
          remoteWs.addEventListener('close', () => {
            logger.log(`Remote WebSocket closed for session ${sessionId}`);
            this.remoteConnections.delete(sessionId);
            ws.close(); // Close client connection when remote closes
          });

          remoteWs.addEventListener('error', (error) => {
            logger.error(`Remote WebSocket error for session ${sessionId}:`, error);
            this.remoteConnections.delete(sessionId);
            ws.close(); // Close client connection on remote error
          });
        } catch (error) {
          logger.error(
            `Failed to establish proxy connection to remote for session ${sessionId}:`,
            error
          );
          ws.close();
          return;
        }
      }
    }

    ws.on('message', (data) => {
      try {
        // If we have a remote connection, just forward the raw data
        if (remoteWs && remoteWs.readyState === WebSocket.OPEN) {
          // Convert ws library's RawData to something native WebSocket can send
          if (data instanceof Buffer) {
            remoteWs.send(data);
          } else if (Array.isArray(data)) {
            // Concatenate buffer array
            remoteWs.send(Buffer.concat(data));
          } else {
            // ArrayBuffer or other types
            remoteWs.send(data);
          }
          return;
        }

        // Otherwise, handle local session
        // Ultra-minimal: expect raw text input directly
        const inputReceived = data.toString();

        if (!inputReceived) {
          return; // Ignore empty messages
        }

        // Parse input with special key marker detection
        // Special keys are wrapped in null bytes: "\x00enter\x00"
        // Regular text (including literal "enter") is sent as-is
        try {
          let input: SessionInput;

          // Debug logging to see what we're receiving
          logger.debug(
            `Raw WebSocket input: ${JSON.stringify(inputReceived)} (length: ${inputReceived.length})`
          );

          if (
            inputReceived.startsWith('\x00') &&
            inputReceived.endsWith('\x00') &&
            inputReceived.length > 2
          ) {
            // Special key wrapped in null bytes
            const keyName = inputReceived.slice(1, -1); // Remove null byte markers
            logger.debug(`Detected special key: "${keyName}"`);
            input = { key: keyName as SpecialKey };
            logger.debug(`Mapped to special key: ${JSON.stringify(input)}`);
          } else {
            // Regular text (including literal words like "enter", "escape", etc.)
            input = { text: inputReceived };
            logger.debug(`Regular text input: ${JSON.stringify(input)}`);
          }

          logger.debug(`Sending to PTY manager: ${JSON.stringify(input)}`);
          this.ptyManager.sendInput(sessionId, input);
        } catch (error) {
          logger.warn(`Failed to send input to session ${sessionId}:`, error);
          // Don't close connection on input errors, just log
        }
      } catch (error) {
        logger.error('Error processing WebSocket input message:', error);
        // Don't close connection on errors, just ignore
      }
    });

    ws.on('close', () => {
      logger.log(`WebSocket input connection closed for session ${sessionId}`);

      // Clean up remote connection if exists
      if (remoteWs) {
        remoteWs.close();
        this.remoteConnections.delete(sessionId);
      }
    });

    ws.on('error', (error) => {
      logger.error(`WebSocket input error for session ${sessionId}:`, error);
    });
  }
}
