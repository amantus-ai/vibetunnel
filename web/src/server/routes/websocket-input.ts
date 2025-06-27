/**
 * WebSocket Input Handler for VibeTunnel
 *
 * Handles WebSocket connections for low-latency input transmission.
 * Optimized for speed:
 * - Fire-and-forget input (no ACKs)
 * - Minimal message parsing
 * - Direct PTY forwarding
 */

import type WebSocket from 'ws';
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

  constructor(options: WebSocketInputHandlerOptions) {
    this.ptyManager = options.ptyManager;
    this.terminalManager = options.terminalManager;
    this.activityMonitor = options.activityMonitor;
    this.remoteRegistry = options.remoteRegistry;
    this.authService = options.authService;
    this.isHQMode = options.isHQMode;
  }

  handleConnection(ws: WebSocket, sessionId: string, userId: string): void {
    logger.log(`WebSocket input connection established for session ${sessionId}, user ${userId}`);

    // Verify session exists upfront
    this.ptyManager.getPtyForSession(sessionId);

    ws.on('message', (data) => {
      try {
        // Ultra-minimal: expect raw text input directly
        const inputToSend = data.toString();
        
        if (!inputToSend) {
          return; // Ignore empty messages
        }

        // Send directly to PTY - fastest possible path
        const ptyProcess = this.ptyManager.getPtyForSession(sessionId);
        if (ptyProcess) {
          ptyProcess.write(inputToSend);
        } else {
          logger.warn(`PTY process for session ${sessionId} not found`);
          ws.close();
        }

      } catch (error) {
        logger.error('Error processing WebSocket input message:', error);
        // Don't close connection on errors, just ignore
      }
    });

    ws.on('close', () => {
      logger.log(`WebSocket input connection closed for session ${sessionId}`);
    });

    ws.on('error', (error) => {
      logger.error(`WebSocket input error for session ${sessionId}:`, error);
    });
  }
}
