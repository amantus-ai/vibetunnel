/**
 * SessionMonitor - Server-side monitoring of terminal sessions
 *
 * Replaces the Mac app's polling-based SessionMonitor with real-time
 * event detection directly from PTY streams. Tracks session states,
 * command execution, and Claude-specific activity transitions.
 */

import { EventEmitter } from 'events';
import { ServerEventType } from '../../shared/types.js';
import type { PtyManager } from '../pty/pty-manager.js';
import { createLogger } from '../utils/logger.js';
import type { SessionMonitorEvent } from '../websocket/control-protocol.js';

const logger = createLogger('session-monitor');

// Command tracking thresholds
const MIN_COMMAND_DURATION_MS = 3000; // Minimum duration for command completion notifications
const CLAUDE_IDLE_DEBOUNCE_MS = 2000; // Debounce period for Claude idle detection

export interface SessionState {
  id: string;
  name: string;
  command: string[];
  workingDir: string;
  status: 'running' | 'exited';
  isRunning: boolean;
  pid?: number;

  // Activity tracking
  activityStatus?: {
    isActive: boolean;
    lastActivity?: Date;
    specificStatus?: {
      app: string;
      status: string;
    };
  };

  // Command tracking
  commandStartTime?: Date;
  lastCommand?: string;
  lastExitCode?: number;

  // Claude-specific tracking
  isClaudeSession?: boolean;
  claudeActivityState?: 'active' | 'idle' | 'unknown';
}

export interface CommandFinishedEvent {
  sessionId: string;
  sessionName: string;
  command: string;
  duration: number;
  exitCode: number;
}

export interface ClaudeTurnEvent {
  sessionId: string;
  sessionName: string;
  message?: string;
}

export class SessionMonitor extends EventEmitter {
  private sessions = new Map<string, SessionState>();
  private claudeIdleNotified = new Set<string>();
  private lastActivityState = new Map<string, boolean>();
  private commandThresholdMs = MIN_COMMAND_DURATION_MS;
  private claudeIdleTimers = new Map<string, NodeJS.Timeout>();

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

    // Listen for Claude activity events (if available)
    this.ptyManager.on('claudeTurn', (sessionId: string, sessionName: string) => {
      this.handleClaudeTurn(sessionId, sessionName);
    });
  }

  /**
   * Update session state with activity information
   */
  public updateSessionActivity(sessionId: string, isActive: boolean, specificApp?: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const previousActive = session.activityStatus?.isActive ?? false;

    // Update activity status
    session.activityStatus = {
      isActive,
      lastActivity: isActive ? new Date() : session.activityStatus?.lastActivity,
      specificStatus: specificApp
        ? {
            app: specificApp,
            status: isActive ? 'active' : 'idle',
          }
        : session.activityStatus?.specificStatus,
    };

    // Check if this is a Claude session
    if (this.isClaudeSession(session)) {
      this.trackClaudeActivity(sessionId, session, previousActive, isActive);
    }

    this.lastActivityState.set(sessionId, isActive);
  }

  /**
   * Track PTY output for activity detection and bell characters
   */
  public trackPtyOutput(sessionId: string, data: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Update last activity
    this.updateSessionActivity(sessionId, true);

    // Detect bell character
    if (data.includes('\x07')) {
      this.emitNotificationEvent({
        type: 'bell',
        sessionId,
        sessionName: session.name,
        timestamp: new Date().toISOString(),
      });
    }

    // Detect Claude-specific patterns in output
    if (this.isClaudeSession(session)) {
      this.detectClaudePatterns(sessionId, session, data);
    }
  }

  /**
   * Emit notification event for all clients (browsers and Mac app) via SSE
   */
  private emitNotificationEvent(event: SessionMonitorEvent) {
    // Emit notification for all clients via SSE endpoint
    this.emit('notification', {
      type: this.mapActionToServerEventType(event.type),
      sessionId: event.sessionId,
      sessionName: event.sessionName,
      timestamp: event.timestamp,
      exitCode: event.exitCode,
      command: event.command,
      duration: event.duration,
      message: event.type === 'claude-turn' ? 'Claude has finished responding' : undefined,
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
      'claude-turn': ServerEventType.ClaudeTurn,
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

    // Mark as active when a new command starts
    this.updateSessionActivity(sessionId, true);
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
      isClaudeSession: this.detectClaudeCommand(ptySession.command || []),
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

    // Clean up Claude tracking
    this.claudeIdleNotified.delete(sessionId);
    this.lastActivityState.delete(sessionId);
    if (this.claudeIdleTimers.has(sessionId)) {
      const timer = this.claudeIdleTimers.get(sessionId);
      if (timer) clearTimeout(timer);
      this.claudeIdleTimers.delete(sessionId);
    }

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

  private handleClaudeTurn(sessionId: string, _sessionName: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Mark Claude as idle
    this.updateSessionActivity(sessionId, false, 'claude');
  }

  private isClaudeSession(session: SessionState): boolean {
    return session.isClaudeSession ?? false;
  }

  private detectClaudeCommand(command: string[]): boolean {
    const commandStr = command.join(' ').toLowerCase();
    return commandStr.includes('claude');
  }

  private trackClaudeActivity(
    sessionId: string,
    session: SessionState,
    previousActive: boolean,
    currentActive: boolean
  ) {
    // Clear any existing idle timer
    if (this.claudeIdleTimers.has(sessionId)) {
      const timer = this.claudeIdleTimers.get(sessionId);
      if (timer) clearTimeout(timer);
      this.claudeIdleTimers.delete(sessionId);
    }

    // Claude went from active to potentially idle
    if (previousActive && !currentActive && !this.claudeIdleNotified.has(sessionId)) {
      // Set a debounce timer before declaring Claude idle
      const timer = setTimeout(() => {
        // Check if still idle
        const currentSession = this.sessions.get(sessionId);
        if (currentSession?.activityStatus && !currentSession.activityStatus.isActive) {
          logger.info(`🔔 Claude turn detected for session: ${sessionId}`);

          this.emitNotificationEvent({
            type: 'claude-turn',
            sessionId,
            sessionName: session.name,
            timestamp: new Date().toISOString(),
            activityStatus: {
              isActive: false,
              app: 'claude',
            },
          });

          this.claudeIdleNotified.add(sessionId);
        }

        this.claudeIdleTimers.delete(sessionId);
      }, CLAUDE_IDLE_DEBOUNCE_MS);

      this.claudeIdleTimers.set(sessionId, timer);
    }

    // Claude became active again - reset notification flag
    if (!previousActive && currentActive) {
      this.claudeIdleNotified.delete(sessionId);
    }
  }

  private detectClaudePatterns(sessionId: string, _session: SessionState, data: string) {
    // Detect patterns that indicate Claude is working or has finished
    const workingPatterns = ['Thinking...', 'Analyzing', 'Working on', 'Let me'];

    const idlePatterns = [
      "I've completed",
      "I've finished",
      'Done!',
      "Here's",
      'The task is complete',
    ];

    // Check for working patterns
    for (const pattern of workingPatterns) {
      if (data.includes(pattern)) {
        this.updateSessionActivity(sessionId, true, 'claude');
        return;
      }
    }

    // Check for idle patterns
    for (const pattern of idlePatterns) {
      if (data.includes(pattern)) {
        // Delay marking as idle to allow for follow-up output
        setTimeout(() => {
          this.updateSessionActivity(sessionId, false, 'claude');
        }, 1000);
        return;
      }
    }
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
          isClaudeSession: this.detectClaudeCommand(session.command),
        };

        this.sessions.set(session.id, state);
      }
    }

    logger.info(`Initialized with ${this.sessions.size} existing sessions`);
  }
}
