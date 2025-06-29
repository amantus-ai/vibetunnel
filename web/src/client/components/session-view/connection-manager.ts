/**
 * Connection Manager for Session View
 *
 * Handles SSE stream connections, reconnection logic, and error handling
 * for terminal sessions.
 */

import { authClient } from '../../services/auth-client.js';
import { CastConverter } from '../../utils/cast-converter.js';
import { createLogger } from '../../utils/logger.js';
import type { Session } from '../session-list.js';
import type { Terminal } from '../terminal.js';

const logger = createLogger('connection-manager');

export interface StreamConnection {
  eventSource: EventSource;
  disconnect: () => void;
  errorHandler?: EventListener;
  clearPendingOutput?: () => void;
}

export class ConnectionManager {
  private streamConnection: StreamConnection | null = null;
  private reconnectCount = 0;
  private terminal: Terminal | null = null;
  private session: Session | null = null;
  private isConnected = false;

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

    // Don't connect if we already have an active connection
    if (this.streamConnection) {
      logger.warn(`Already have an active stream connection, cleaning up first`);
      this.cleanupStreamConnection();
    }

    // Capture session ID at connection time to ensure we're using the right one
    const sessionId = this.session.id;
    const terminalElement = this.terminal;
    logger.log(`[connection-manager] Connecting to stream for session ${sessionId}`);

    // Clean up existing connection
    this.cleanupStreamConnection();

    // Get auth client from the main app
    const user = authClient.getCurrentUser();

    // Build stream URL with auth token as query parameter (EventSource doesn't support headers)
    let streamUrl = `/api/sessions/${sessionId}/stream`;
    if (user?.token) {
      streamUrl += `?token=${encodeURIComponent(user.token)}`;
    }

    // Use CastConverter to connect terminal to stream with reconnection tracking
    const connection = CastConverter.connectToStream(terminalElement, streamUrl);

    // Wrap the connection to track reconnections
    const originalEventSource = connection.eventSource;
    let lastErrorTime = 0;
    const reconnectThreshold = 3; // Max reconnects before giving up
    const reconnectWindow = 5000; // 5 second window

    const handleError = () => {
      const now = Date.now();

      // Reset counter if enough time has passed since last error
      if (now - lastErrorTime > reconnectWindow) {
        this.reconnectCount = 0;
      }

      this.reconnectCount++;
      lastErrorTime = now;

      logger.log(`stream error #${this.reconnectCount} for session ${this.session?.id}`);

      // If we've had too many reconnects, mark session as exited
      if (this.reconnectCount >= reconnectThreshold) {
        logger.warn(`session ${this.session?.id} marked as exited due to excessive reconnections`);

        if (this.session && this.session.status !== 'exited') {
          const exitedSession = { ...this.session, status: 'exited' as const };
          this.session = exitedSession;
          this.onSessionUpdate(exitedSession);

          // Disconnect the stream and load final snapshot
          this.cleanupStreamConnection();

          // Load final snapshot
          requestAnimationFrame(() => {
            this.loadSessionSnapshot();
          });
        }
      }
    };

    // Override the error handler
    originalEventSource.addEventListener('error', handleError);

    // Store the connection with error handler reference
    this.streamConnection = {
      ...connection,
      errorHandler: handleError as EventListener,
    };
  }

  cleanupStreamConnection(skipFlush = false): void {
    if (this.streamConnection) {
      logger.log('Cleaning up stream connection', { skipFlush });

      if (skipFlush && this.streamConnection.eventSource) {
        // Close the EventSource directly without triggering disconnect's flush
        this.streamConnection.eventSource.close();

        // Clear any pending batch timeouts if we have access to them
        // This prevents buffered data from being flushed
        if (this.streamConnection.clearPendingOutput) {
          this.streamConnection.clearPendingOutput();
        }
      } else {
        // Normal disconnect with flush
        this.streamConnection.disconnect();
      }

      this.streamConnection = null;
    }
  }

  getReconnectCount(): number {
    return this.reconnectCount;
  }

  hasActiveConnections(): boolean {
    return this.streamConnection !== null;
  }

  private async loadSessionSnapshot(): Promise<void> {
    if (!this.terminal || !this.session) return;

    try {
      const url = `/api/sessions/${this.session.id}/snapshot`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch snapshot: ${response.status}`);

      const castContent = await response.text();

      // Clear terminal and load snapshot
      this.terminal.clear();
      await CastConverter.dumpToTerminal(this.terminal, castContent);

      // Scroll to bottom after loading
      this.terminal.queueCallback(() => {
        if (this.terminal) {
          this.terminal.scrollToBottom();
        }
      });
    } catch (error) {
      logger.error('failed to load session snapshot', error);
    }
  }
}
