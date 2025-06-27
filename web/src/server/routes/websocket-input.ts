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
import type { SessionInput, SpecialKey } from '../../shared/types.js';
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

  // Special key names that need mapping (same as HTTP /input endpoint)
  private readonly specialKeys = new Set([
    'enter', 'escape', 'backspace', 'tab', 'shift_tab',
    'arrow_up', 'arrow_down', 'arrow_left', 'arrow_right',
    'ctrl_enter', 'shift_enter', 'page_up', 'page_down',
    'home', 'end', 'delete',
    'f1', 'f2', 'f3', 'f4', 'f5', 'f6',
    'f7', 'f8', 'f9', 'f10', 'f11', 'f12'
  ]);

  constructor(options: WebSocketInputHandlerOptions) {
    this.ptyManager = options.ptyManager;
    this.terminalManager = options.terminalManager;
    this.activityMonitor = options.activityMonitor;
    this.remoteRegistry = options.remoteRegistry;
    this.authService = options.authService;
    this.isHQMode = options.isHQMode;
  }

  private isSpecialKey(input: string): boolean {
    return this.specialKeys.has(input);
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

        // Use the existing PtyManager's sendInput method for proper key handling
        // This reuses the same key mapping logic as the HTTP /input endpoint
        try {
          const input: SessionInput = this.isSpecialKey(inputReceived)
            ? { key: inputReceived as SpecialKey }
            : { text: inputReceived };
          
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
    });

    ws.on('error', (error) => {
      logger.error(`WebSocket input error for session ${sessionId}:`, error);
    });
  }
}
