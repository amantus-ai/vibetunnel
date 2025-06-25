/**
 * Terminal management and streaming for SessionView component
 */
import { authClient } from '../services/auth-client.js';
import { CastConverter } from '../utils/cast-converter.js';
import { createLogger } from '../utils/logger.js';
import type { Session } from './session-list.js';
import type { Terminal } from './terminal.js';

const logger = createLogger('session-view-terminal');

export interface StreamConnection {
  eventSource: EventSource;
  disconnect: () => void;
  errorHandler?: EventListener;
}

export interface TerminalManager {
  terminal: Terminal | null;
  streamConnection: StreamConnection | null;
  reconnectCount: number;
  lastResizeWidth: number;
  lastResizeHeight: number;
  resizeTimeout: number | null;
}

export async function initializeTerminal(
  terminalElement: Terminal,
  _session: Session,
  terminalFontSize: number,
  terminalMaxCols: number,
  onSessionExit: (e: Event) => void,
  onTerminalResize: (e: Event) => void,
  onTerminalPaste: (e: Event) => void
): Promise<void> {
  // Configure terminal for interactive session
  terminalElement.cols = 80;
  terminalElement.rows = 24;
  terminalElement.fontSize = terminalFontSize;
  terminalElement.fitHorizontally = false;
  terminalElement.maxCols = terminalMaxCols;

  // Listen for session exit events
  terminalElement.addEventListener('session-exit', onSessionExit as EventListener);

  // Listen for terminal resize events to capture dimensions
  terminalElement.addEventListener('terminal-resize', onTerminalResize as unknown as EventListener);

  // Listen for paste events from terminal
  terminalElement.addEventListener('terminal-paste', onTerminalPaste as EventListener);
}

export function connectToStream(
  terminal: Terminal,
  session: Session,
  onReconnectLimitReached: () => void
): StreamConnection | null {
  logger.log(`Connecting to stream for session ${session.id}`);

  // Get auth client from the main app
  const user = authClient.getCurrentUser();

  // Build stream URL with auth token as query parameter (EventSource doesn't support headers)
  let streamUrl = `/api/sessions/${session.id}/stream`;
  if (user?.token) {
    streamUrl += `?token=${encodeURIComponent(user.token)}`;
  }

  // Use CastConverter to connect terminal to stream with reconnection tracking
  const connection = CastConverter.connectToStream(terminal, streamUrl);

  // Wrap the connection to track reconnections
  const originalEventSource = connection.eventSource;
  let lastErrorTime = 0;
  let reconnectCount = 0;
  const reconnectThreshold = 3; // Max reconnects before giving up
  const reconnectWindow = 5000; // 5 second window

  const handleError = () => {
    const now = Date.now();

    // Reset counter if enough time has passed since last error
    if (now - lastErrorTime > reconnectWindow) {
      reconnectCount = 0;
    }

    reconnectCount++;
    lastErrorTime = now;

    logger.log(`stream error #${reconnectCount} for session ${session.id}`);

    // If we've had too many reconnects, mark session as exited
    if (reconnectCount >= reconnectThreshold) {
      logger.warn(`session ${session.id} marked as exited due to excessive reconnections`);
      onReconnectLimitReached();
    }
  };

  // Override the error handler
  originalEventSource.addEventListener('error', handleError);

  // Return the connection with error handler reference
  return {
    ...connection,
    errorHandler: handleError as EventListener,
  };
}

export async function loadSessionSnapshot(terminal: Terminal, session: Session): Promise<void> {
  try {
    const url = `/api/sessions/${session.id}/snapshot`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch snapshot: ${response.status}`);

    const castContent = await response.text();

    // Clear terminal and load snapshot
    terminal.clear();
    await CastConverter.dumpToTerminal(terminal, castContent);

    // Scroll to bottom after loading
    terminal.queueCallback(() => {
      terminal.scrollToBottom();
    });
  } catch (error) {
    logger.error('failed to load session snapshot', error);
  }
}

export async function sendResizeRequest(
  session: Session,
  cols: number,
  rows: number
): Promise<boolean> {
  try {
    logger.debug(`sending resize request: ${cols}x${rows}`);

    const response = await fetch(`/api/sessions/${session.id}/resize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authClient.getAuthHeader(),
      },
      body: JSON.stringify({ cols, rows }),
    });

    if (response.ok) {
      return true;
    } else {
      logger.warn(`failed to resize session: ${response.status}`);
      return false;
    }
  } catch (error) {
    logger.warn('failed to send resize request', error);
    return false;
  }
}

export async function resetTerminalSize(session: Session): Promise<void> {
  logger.log('Sending reset-size request for session', session.id);

  try {
    const response = await fetch(`/api/sessions/${session.id}/reset-size`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authClient.getAuthHeader(),
      },
    });

    if (!response.ok) {
      logger.error('failed to reset terminal size', {
        status: response.status,
        sessionId: session.id,
      });
    } else {
      logger.log('terminal size reset successfully for session', session.id);
    }
  } catch (error) {
    logger.error('error resetting terminal size', {
      error,
      sessionId: session.id,
    });
  }
}

export function refreshTerminalAfterMobileInput(terminal: Terminal | null): void {
  // After closing mobile input, the viewport changes and the terminal
  // needs to recalculate its scroll position to avoid getting stuck
  if (!terminal) return;

  // Give the viewport time to settle after keyboard disappears
  setTimeout(() => {
    if (terminal) {
      // Force the terminal to recalculate its viewport dimensions and scroll boundaries
      // This fixes the issue where maxScrollPixels becomes incorrect after keyboard changes
      const terminalElement = terminal as unknown as { fitTerminal?: () => void };
      if (typeof terminalElement.fitTerminal === 'function') {
        terminalElement.fitTerminal();
      }

      // Then scroll to bottom to fix the position
      terminal.scrollToBottom();
    }
  }, 300); // Wait for viewport to settle
}
