/**
 * SessionMonitor - Server-side monitoring of terminal sessions
 *
 * Replaces the Mac app's polling-based SessionMonitor with real-time
 * event detection directly from PTY streams. Tracks session states and
 * command execution.
 */

import { EventEmitter } from 'events';
import { ServerEventType } from '../../shared/types.js';
import type { PtyManager } from '../pty/pty-manager.js';
import { createLogger } from '../utils/logger.js';
import type { SessionMonitorEvent } from '../websocket/control-protocol.js';

const logger = createLogger('session-monitor');

// Command tracking thresholds
const MIN_COMMAND_DURATION_MS = 3000; // Minimum duration for command completion notifications

export interface SessionState {
  id: string;
  name: string;
  command: string[];
  workingDir: string;
  status: 'running' | 'exited';
  isRunning: boolean;
  pid?: number;

  // Command tracking
  commandStartTime?: Date;
  lastCommand?: string;
  lastExitCode?: number;
}

export interface CommandFinishedEvent {
  sessionId: string;
  sessionName: string;
  command: string;
  duration: number;
  exitCode: number;
}

export class SessionMonitor extends EventEmitter {
  private sessions = new Map<string, SessionState>();
  private commandThresholdMs = MIN_COMMAND_DURATION_MS;

  constructor(private ptyManager: PtyManager) {
    super();
    this.setupEventListeners();
    logger.info('SessionMonitor initialized');
  }

  private setupEventListeners() {
    // Listen for session lifecycle events
    this.ptyManager.on('sessionStarted', (sessionId: string, sessionName: string) => {
      this.handleSessionStarted(sessionId, sessionName);
    });

    this.ptyManager.on(
      'sessionExited',
      (sessionId: string, sessionName: string, exitCode?: number) => {
        this.handleSessionExited(sessionId, sessionName, exitCode);
      }
    );

    // Listen for command tracking events
    this.ptyManager.on('commandFinished', (data: CommandFinishedEvent) => {
      this.handleCommandFinished(data);
    });
  }

  /**
   * Track PTY output for bell characters
   */
  public trackPtyOutput(sessionId: string, data: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Detect bell character
    if (data.includes('\x07')) {
      this.emitNotificationEvent({
        type: 'bell',
        sessionId,
        sessionName: session.name,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Emit notification event for all clients (browsers, native apps) via WS v3 global events.
   */
  private emitNotificationEvent(event: SessionMonitorEvent) {
    // Emitted on the SessionMonitor event bus; the WS v3 hub fans this out to clients.
    this.emit('notification', {
      type: this.mapActionToServerEventType(event.type),
      sessionId: event.sessionId,
      sessionName: event.sessionName,
      timestamp: event.timestamp,
      exitCode: event.exitCode,
      command: event.command,
      duration: event.duration,
    });
  }

  /**
   * Map session monitor action to ServerEventType
   */
  private mapActionToServerEventType(action: SessionMonitorEvent['type']): ServerEventType {
    const mapping = {
      'session-start': ServerEventType.SessionStart,
      'session-exit': ServerEventType.SessionExit,
      'command-finished': ServerEventType.CommandFinished,
      'command-error': ServerEventType.CommandError,
      bell: ServerEventType.Bell,
    };
    return mapping[action];
  }

  /**
   * Update command information for a session
   */
  public updateCommand(sessionId: string, command: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.lastCommand = command;
    session.commandStartTime = new Date();
  }

  /**
   * Handle command completion
   */
  public handleCommandCompletion(sessionId: string, exitCode: number) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.commandStartTime || !session.lastCommand) return;

    const duration = Date.now() - session.commandStartTime.getTime();
    session.lastExitCode = exitCode;

    // Only emit event if command ran long enough
    if (duration >= this.commandThresholdMs) {
      const _event: CommandFinishedEvent = {
        sessionId,
        sessionName: session.name,
        command: session.lastCommand,
        duration,
        exitCode,
      };

      // Emit appropriate event based on exit code
      if (exitCode === 0) {
        this.emitNotificationEvent({
          type: 'command-finished',
          sessionId,
          sessionName: session.name,
          command: session.lastCommand,
          duration,
          exitCode,
          timestamp: new Date().toISOString(),
        });
      } else {
        this.emitNotificationEvent({
          type: 'command-error',
          sessionId,
          sessionName: session.name,
          command: session.lastCommand,
          duration,
          exitCode,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Clear command tracking
    session.commandStartTime = undefined;
    session.lastCommand = undefined;
  }

  private handleSessionStarted(sessionId: string, sessionName: string) {
    // Get full session info from PtyManager
    const ptySession = this.ptyManager.getSession(sessionId);
    if (!ptySession) return;

    const state: SessionState = {
      id: sessionId,
      name: sessionName,
      command: ptySession.command || [],
      workingDir: ptySession.workingDir || process.cwd(),
      status: 'running',
      isRunning: true,
      pid: ptySession.pid,
    };

    this.sessions.set(sessionId, state);
    logger.info(`Session started: ${sessionId} - ${sessionName}`);

    // Emit notification event
    this.emitNotificationEvent({
      type: 'session-start',
      sessionId,
      sessionName,
      timestamp: new Date().toISOString(),
    });
  }

  private handleSessionExited(sessionId: string, sessionName: string, exitCode?: number) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = 'exited';
    session.isRunning = false;

    logger.info(`Session exited: ${sessionId} - ${sessionName} (exit code: ${exitCode})`);

    // Emit notification event
    this.emitNotificationEvent({
      type: 'session-exit',
      sessionId,
      sessionName,
      exitCode,
      timestamp: new Date().toISOString(),
    });

    // Remove session after a delay to allow final events to process
    setTimeout(() => {
      this.sessions.delete(sessionId);
    }, 5000);
  }

  private handleCommandFinished(data: CommandFinishedEvent) {
    // Forward to our handler which will emit the appropriate notification
    this.handleCommandCompletion(data.sessionId, data.exitCode);
  }

  /**
   * Get all active sessions
   */
  public getActiveSessions(): SessionState[] {
    return Array.from(this.sessions.values()).filter((s) => s.isRunning);
  }

  /**
   * Get a specific session
   */
  public getSession(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Initialize monitor with existing sessions
   */
  public async initialize() {
    // Get all existing sessions from PtyManager
    const existingSessions = await this.ptyManager.listSessions();

    for (const session of existingSessions) {
      if (session.status === 'running') {
        const state: SessionState = {
          id: session.id,
          name: session.name,
          command: session.command,
          workingDir: session.workingDir,
          status: 'running',
          isRunning: true,
          pid: session.pid,
        };

        this.sessions.set(session.id, state);
      }
    }

    logger.info(`Initialized with ${this.sessions.size} existing sessions`);
  }
}
