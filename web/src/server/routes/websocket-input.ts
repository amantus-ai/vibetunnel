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
        const inputReceived = data.toString();
        
        if (!inputReceived) {
          return; // Ignore empty messages
        }

        // Map special key names to actual key codes
        let inputToSend: string;
        switch (inputReceived) {
          case 'enter':
            inputToSend = '\r';
            break;
          case 'escape':
            inputToSend = '\x1b';
            break;
          case 'backspace':
            inputToSend = '\x7f';
            break;
          case 'tab':
            inputToSend = '\t';
            break;
          case 'shift_tab':
            inputToSend = '\x1b[Z';
            break;
          case 'arrow_up':
            inputToSend = '\x1b[A';
            break;
          case 'arrow_down':
            inputToSend = '\x1b[B';
            break;
          case 'arrow_right':
            inputToSend = '\x1b[C';
            break;
          case 'arrow_left':
            inputToSend = '\x1b[D';
            break;
          case 'ctrl_enter':
            inputToSend = '\r';
            break;
          case 'shift_enter':
            inputToSend = '\r';
            break;
          case 'page_up':
            inputToSend = '\x1b[5~';
            break;
          case 'page_down':
            inputToSend = '\x1b[6~';
            break;
          case 'home':
            inputToSend = '\x1b[H';
            break;
          case 'end':
            inputToSend = '\x1b[F';
            break;
          case 'delete':
            inputToSend = '\x1b[3~';
            break;
          case 'f1':
            inputToSend = '\x1bOP';
            break;
          case 'f2':
            inputToSend = '\x1bOQ';
            break;
          case 'f3':
            inputToSend = '\x1bOR';
            break;
          case 'f4':
            inputToSend = '\x1bOS';
            break;
          case 'f5':
            inputToSend = '\x1b[15~';
            break;
          case 'f6':
            inputToSend = '\x1b[17~';
            break;
          case 'f7':
            inputToSend = '\x1b[18~';
            break;
          case 'f8':
            inputToSend = '\x1b[19~';
            break;
          case 'f9':
            inputToSend = '\x1b[20~';
            break;
          case 'f10':
            inputToSend = '\x1b[21~';
            break;
          case 'f11':
            inputToSend = '\x1b[23~';
            break;
          case 'f12':
            inputToSend = '\x1b[24~';
            break;
          default:
            // Regular text or single characters - send as is
            inputToSend = inputReceived;
            break;
        }

        // Send to PTY with proper key code mapping
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
