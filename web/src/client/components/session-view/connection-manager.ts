/**
 * Connection Manager for Session View
 *
 * Handles terminal stream connections over WebSocket v3 (single-socket transport)
 * for terminal sessions.
 */

import type { Session } from '../../../shared/types.js';
import { terminalSocketClient } from '../../services/terminal-socket-client.js';
import { createLogger } from '../../utils/logger.js';
import type { Terminal } from '../terminal.js';

const logger = createLogger('connection-manager');

export class ConnectionManager {
  private unsubscribe: (() => void) | null = null;
  private terminal: Terminal | null = null;
  private session: Session | null = null;
  private isConnected = false;
  private stdoutDecoder = new TextDecoder();
  private outputBuffer = '';
  private batchTimeout: number | null = null;

  constructor(
    private onSessionExit: (sessionId: string) => void,
    private onSessionUpdate: (session: Session) => void
  ) {}

  setTerminal(terminal: Terminal | null): void {
    this.terminal = terminal;
  }

  setSession(session: Session | null): void {
    this.session = session;
  }

  setConnected(connected: boolean): void {
    this.isConnected = connected;
  }

  connectToStream(): void {
    if (!this.terminal || !this.session) {
      logger.warn(`Cannot connect to stream - missing terminal or session`);
      return;
    }

    // Don't connect if we're already disconnected
    if (!this.isConnected) {
      logger.warn(`Component already disconnected, not connecting to stream`);
      return;
    }

    logger.log(`Connecting to v3 stream for session ${this.session.id}`);

    this.cleanupStreamConnection();

    const flush = () => {
      if (!this.terminal) return;
      if (this.outputBuffer.length > 0) {
        this.terminal.write(this.outputBuffer, true);
        this.outputBuffer = '';
      }
      this.batchTimeout = null;
    };

    const enqueue = (chunk: string) => {
      this.outputBuffer += chunk;
      if (this.batchTimeout === null) {
        this.batchTimeout = window.setTimeout(flush, 16);
      }
    };

    this.unsubscribe = terminalSocketClient.subscribe(this.session.id, {
      stdout: true,
      events: true,
      onStdout: (bytes) => {
        enqueue(this.stdoutDecoder.decode(bytes, { stream: true }));
      },
      onEvent: (event) => {
        if (!this.session) return;

        // v3 server events: { kind: 'exit', ... } or { type: 'git-status-update', ... }
        if (typeof event === 'object' && event !== null) {
          const e = event as {
            kind?: string;
            exitCode?: number;
            type?: string;
            sessionId?: string;
          } & Record<string, unknown>;

          if (e.kind === 'exit') {
            flush();
            this.onSessionExit(this.session.id);
            return;
          }

          if (e.type === 'git-status-update' && e.sessionId === this.session.id) {
            const updatedSession = {
              ...this.session,
              gitModifiedCount:
                (e.gitModifiedCount as number | undefined) ?? this.session.gitModifiedCount,
              gitAddedCount: (e.gitAddedCount as number | undefined) ?? this.session.gitAddedCount,
              gitDeletedCount:
                (e.gitDeletedCount as number | undefined) ?? this.session.gitDeletedCount,
              gitAheadCount: (e.gitAheadCount as number | undefined) ?? this.session.gitAheadCount,
              gitBehindCount:
                (e.gitBehindCount as number | undefined) ?? this.session.gitBehindCount,
            };
            this.session = updatedSession;
            this.onSessionUpdate(updatedSession);
          }
        }
      },
      onError: (message) => {
        logger.debug(`v3 stream error for session ${this.session?.id}: ${message}`);
      },
    });
  }

  cleanupStreamConnection(): void {
    if (this.batchTimeout !== null) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }
    this.outputBuffer = '';
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
