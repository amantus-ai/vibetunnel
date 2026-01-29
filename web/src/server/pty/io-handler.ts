/**
 * IOHandler - Handles input/output operations for PTY sessions
 *
 * Responsible for:
 * - Sending text input to sessions
 * - Converting special keys to escape sequences
 * - Handling resize operations
 * - Managing socket connections for external sessions
 */

import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import type { SessionInput, SpecialKey } from '../../shared/types.js';
import { createLogger } from '../utils/logger.js';
import {
  type ControlCommand,
  frameMessage,
  MessageType,
} from './socket-protocol.js';
import {
  type KillControlMessage,
  PtyError,
  type PtySession,
  type ResetSizeControlMessage,
  type ResizeControlMessage,
} from './types.js';

const logger = createLogger('io-handler');

/**
 * Session paths needed for external session communication
 */
export interface SessionPaths {
  controlDir: string;
  stdoutPath: string;
  stdinPath: string;
  sessionJsonPath: string;
}

/**
 * Interface for session path resolution
 */
export interface SessionPathResolver {
  getSessionPaths(sessionId: string): SessionPaths | null;
}

/**
 * Configuration for IOHandler
 */
export interface IOHandlerConfig {
  /** Default timeout for socket connections in ms */
  socketTimeout?: number;
}

/**
 * Handles input/output operations for PTY sessions
 */
export class IOHandler {
  private inputSocketClients = new Map<string, net.Socket>();
  private lastInputTimestamps = new Map<string, number>();
  private sessionResizeSources = new Map<
    string,
    { cols: number; rows: number; source: 'browser' | 'terminal'; timestamp: number }
  >();

  constructor(
    private readonly pathResolver: SessionPathResolver,
    private readonly config: IOHandlerConfig = {}
  ) {}

  /**
   * Send text input to a session
   */
  sendInput(
    sessionId: string,
    input: SessionInput,
    session?: PtySession
  ): void {
    try {
      let dataToSend = '';
      if (input.text !== undefined) {
        dataToSend = input.text;
        logger.debug(
          `Received text input: ${JSON.stringify(input.text)} -> sending: ${JSON.stringify(dataToSend)}`
        );
      } else if (input.key !== undefined) {
        dataToSend = this.convertSpecialKey(input.key);
        logger.debug(
          `Received special key: "${input.key}" -> converted to: ${JSON.stringify(dataToSend)}`
        );
      } else {
        throw new PtyError('No text or key specified in input', 'INVALID_INPUT');
      }

      // If we have an in-memory session with active PTY, use it
      if (session?.ptyProcess && session.inputQueue) {
        const inputTimestamp = Date.now();
        session.lastInputTimestamp = inputTimestamp;
        this.lastInputTimestamps.set(sessionId, inputTimestamp);

        // Queue input write to prevent race conditions
        session.inputQueue.enqueue(() => {
          if (session.ptyProcess) {
            session.ptyProcess.write(dataToSend);
          }
          session.asciinemaWriter?.writeInput(dataToSend);
        });

        return;
      }

      // For external sessions, use socket communication
      const sessionPaths = this.pathResolver.getSessionPaths(sessionId);
      if (!sessionPaths) {
        throw new PtyError(
          `Session ${sessionId} paths not found`,
          'SESSION_PATHS_NOT_FOUND',
          sessionId
        );
      }

      const socketPath = path.join(sessionPaths.controlDir, 'ipc.sock');
      let socketClient = this.inputSocketClients.get(sessionId);

      if (!socketClient || socketClient.destroyed) {
        // Try to connect to the socket
        try {
          socketClient = net.createConnection(socketPath);
          socketClient.setNoDelay(true);
          socketClient.setKeepAlive(true, 0);
          this.inputSocketClients.set(sessionId, socketClient);

          socketClient.on('error', () => {
            this.inputSocketClients.delete(sessionId);
          });

          socketClient.on('close', () => {
            this.inputSocketClients.delete(sessionId);
          });
        } catch (error) {
          logger.debug(`Failed to connect to input socket for session ${sessionId}:`, error);
          socketClient = undefined;
        }
      }

      if (socketClient && !socketClient.destroyed) {
        this.lastInputTimestamps.set(sessionId, Date.now());
        // Send stdin data using framed message protocol
        const message = frameMessage(MessageType.STDIN_DATA, dataToSend);
        const canWrite = socketClient.write(message);
        if (!canWrite) {
          logger.debug(`Socket buffer full for session ${sessionId}, data queued`);
        }
      } else {
        throw new PtyError(
          `No socket connection available for session ${sessionId}`,
          'NO_SOCKET_CONNECTION',
          sessionId
        );
      }
    } catch (error) {
      throw new PtyError(
        `Failed to send input to session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
        'SEND_INPUT_FAILED',
        sessionId
      );
    }
  }

  /**
   * Resize a session terminal
   */
  resizeSession(
    sessionId: string,
    cols: number,
    rows: number,
    session?: PtySession
  ): void {
    const currentTime = Date.now();

    // Check for rapid resizes (potential feedback loop)
    const lastResize = this.sessionResizeSources.get(sessionId);
    if (lastResize) {
      const timeSinceLastResize = currentTime - lastResize.timestamp;
      if (timeSinceLastResize < 100) {
        logger.warn(
          `Rapid resize detected for session ${sessionId}: ${timeSinceLastResize}ms since last resize (${lastResize.cols}x${lastResize.rows} -> ${cols}x${rows})`
        );
      }
    }

    try {
      // If we have an in-memory session with active PTY, resize it
      if (session?.ptyProcess) {
        session.ptyProcess.resize(cols, rows);
        session.asciinemaWriter?.writeResize(cols, rows);

        // Track this browser-initiated resize
        this.sessionResizeSources.set(sessionId, {
          cols,
          rows,
          source: 'browser',
          timestamp: currentTime,
        });

        logger.debug(`Resized session ${sessionId} to ${cols}x${rows}`);
      } else {
        // For external sessions, try to send resize via control pipe
        const resizeMessage: ResizeControlMessage = {
          cmd: 'resize',
          cols,
          rows,
        };
        this.sendControlMessage(sessionId, resizeMessage);

        // Track this resize for external sessions too
        this.sessionResizeSources.set(sessionId, {
          cols,
          rows,
          source: 'browser',
          timestamp: currentTime,
        });
      }
    } catch (error) {
      throw new PtyError(
        `Failed to resize session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
        'RESIZE_FAILED',
        sessionId
      );
    }
  }

  /**
   * Handle terminal resize from host terminal
   */
  handleTerminalResize(
    sessionId: string,
    cols: number,
    rows: number,
    session: PtySession
  ): boolean {
    const currentTime = Date.now();
    const lastResize = this.sessionResizeSources.get(sessionId);

    // Check if we should apply this resize based on "last resize wins" logic
    const shouldResize =
      !lastResize ||
      lastResize.source === 'terminal' ||
      currentTime - lastResize.timestamp > 1000; // 1 second grace period for browser resizes

    if (!shouldResize) {
      logger.debug(
        `Skipping terminal resize for session ${sessionId} (browser has precedence)`
      );
      return false;
    }

    try {
      if (session.ptyProcess && session.sessionInfo.status === 'running') {
        session.ptyProcess.resize(cols, rows);
        session.asciinemaWriter?.writeResize(cols, rows);

        this.sessionResizeSources.set(sessionId, {
          cols,
          rows,
          source: 'terminal',
          timestamp: currentTime,
        });

        logger.debug(`Resized session ${sessionId} to ${cols}x${rows} from terminal`);
        return true;
      }
    } catch (error) {
      logger.error(`Failed to resize session ${sessionId}:`, error);
    }

    return false;
  }

  /**
   * Reset session size to terminal size (for external terminals)
   */
  resetSessionSize(sessionId: string, session?: PtySession): void {
    try {
      // For in-memory sessions there is nothing to reset
      if (session?.ptyProcess) return;

      // For external sessions, send reset-size command via control pipe
      const resetSizeMessage: ResetSizeControlMessage = {
        cmd: 'reset-size',
      };

      const sent = this.sendControlMessage(sessionId, resetSizeMessage);
      if (!sent) {
        throw new PtyError(
          `Failed to send reset-size command to session ${sessionId}`,
          'CONTROL_MESSAGE_FAILED',
          sessionId
        );
      }

      logger.debug(`Sent reset-size command to session ${sessionId}`);
    } catch (error) {
      throw new PtyError(
        `Failed to reset session size for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
        'RESET_SIZE_FAILED',
        sessionId
      );
    }
  }

  /**
   * Send a control message to an external session via socket
   */
  sendControlMessage(
    sessionId: string,
    message: ResizeControlMessage | KillControlMessage | ResetSizeControlMessage | ControlCommand
  ): boolean {
    const sessionPaths = this.pathResolver.getSessionPaths(sessionId);
    if (!sessionPaths) {
      return false;
    }

    try {
      const socketPath = path.join(sessionPaths.controlDir, 'ipc.sock');
      let socketClient = this.inputSocketClients.get(sessionId);

      if (!socketClient || socketClient.destroyed) {
        // Try to connect to the socket
        try {
          socketClient = net.createConnection(socketPath);
          socketClient.setNoDelay(true);
          socketClient.setKeepAlive(true, 0);
          this.inputSocketClients.set(sessionId, socketClient);

          socketClient.on('error', () => {
            this.inputSocketClients.delete(sessionId);
          });

          socketClient.on('close', () => {
            this.inputSocketClients.delete(sessionId);
          });
        } catch (error) {
          logger.debug(`Failed to connect to control socket for session ${sessionId}:`, error);
          return false;
        }
      }

      if (socketClient && !socketClient.destroyed) {
        const frameMsg = frameMessage(MessageType.CONTROL_CMD, message);
        return socketClient.write(frameMsg);
      }
    } catch (error) {
      logger.error(`Failed to send control message to session ${sessionId}:`, error);
    }
    return false;
  }

  /**
   * Convert special key names to escape sequences
   */
  convertSpecialKey(key: SpecialKey): string {
    const keyMap: Record<SpecialKey, string> = {
      arrow_up: '\x1b[A',
      arrow_down: '\x1b[B',
      arrow_right: '\x1b[C',
      arrow_left: '\x1b[D',
      escape: '\x1b',
      enter: '\r',
      ctrl_enter: '\n',
      shift_enter: '\r\n',
      backspace: '\x7f',
      tab: '\t',
      shift_tab: '\x1b[Z',
      page_up: '\x1b[5~',
      page_down: '\x1b[6~',
      home: '\x1b[H',
      end: '\x1b[F',
      delete: '\x1b[3~',
      f1: '\x1bOP',
      f2: '\x1bOQ',
      f3: '\x1bOR',
      f4: '\x1bOS',
      f5: '\x1b[15~',
      f6: '\x1b[17~',
      f7: '\x1b[18~',
      f8: '\x1b[19~',
      f9: '\x1b[20~',
      f10: '\x1b[21~',
      f11: '\x1b[23~',
      f12: '\x1b[24~',
    };

    const sequence = keyMap[key];
    if (!sequence) {
      throw new PtyError(`Unknown special key: ${key}`, 'UNKNOWN_KEY');
    }

    return sequence;
  }

  /**
   * Get last input timestamp for a session
   */
  getLastInputTimestamp(sessionId: string): number | undefined {
    return this.lastInputTimestamps.get(sessionId);
  }

  /**
   * Cleanup resources for a session
   */
  cleanupSession(sessionId: string): void {
    // Clean up socket connection
    const socket = this.inputSocketClients.get(sessionId);
    if (socket) {
      socket.destroy();
      this.inputSocketClients.delete(sessionId);
    }

    this.lastInputTimestamps.delete(sessionId);
    this.sessionResizeSources.delete(sessionId);
  }

  /**
   * Shutdown all connections
   */
  shutdown(): void {
    for (const [_sessionId, socket] of this.inputSocketClients.entries()) {
      try {
        socket.destroy();
      } catch (_e) {
        // Socket already destroyed
      }
    }
    this.inputSocketClients.clear();
    this.lastInputTimestamps.clear();
    this.sessionResizeSources.clear();
  }
}
