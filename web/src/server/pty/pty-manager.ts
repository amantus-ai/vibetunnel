/**
 * PtyManager - Core PTY management using node-pty
 *
 * This class orchestrates PTY session management by delegating to focused modules:
 * - SessionLifecycle: Session creation, destruction, recovery
 * - IOHandler: Input/output handling, resize operations
 * - TitleManager: Terminal title injection and tracking
 * - ProcessTracker: Foreground process detection, command tracking
 * - IPCSocketHandler: Unix socket communication
 */

import chalk from 'chalk';
import { EventEmitter, once } from 'events';
import * as fs from 'fs';
import type { IPty } from 'node-pty';
import * as path from 'path';
import type {
  Session,
  SessionCreateOptions,
  SessionInfo,
  SessionInput,
} from '../../shared/types.js';
import { TitleMode } from '../../shared/types.js';
import type { SessionMonitor } from '../services/session-monitor.js';
import { extractCdDirectory } from '../utils/terminal-title.js';
import { createLogger } from '../utils/logger.js';
import { WriteQueue } from '../utils/write-queue.js';
import { controlUnixHandler } from '../websocket/control-unix-handler.js';
import { computeActivityStatus } from './activity-status.js';
import { FishHandler } from './fish-handler.js';
import { IOHandler } from './io-handler.js';
import { IPCSocketHandler } from './ipc-socket-handler.js';
import { ProcessTracker } from './process-tracker.js';
import { ProcessUtils } from './process-utils.js';
import { SessionManager } from './session-manager.js';
import {
  initializeNodePty,
  isNodePtyInitialized,
  SessionLifecycle,
} from './session-lifecycle.js';
import { TitleManager } from './title-manager.js';
import {
  type KillControlMessage,
  PtyError,
  type PtySession,
  type SessionCreationResult,
} from './types.js';

const logger = createLogger('pty-manager');

/**
 * PtyManager handles the lifecycle and I/O operations of pseudo-terminal (PTY) sessions.
 *
 * This class provides comprehensive terminal session management including:
 * - Creating and managing PTY processes using node-pty
 * - Handling terminal input/output with proper buffering and queuing
 * - Managing terminal resizing from both browser and host terminal
 * - Recording sessions in asciinema format for playback
 * - Communicating with external sessions via Unix domain sockets
 * - Dynamic terminal title management
 * - Session persistence and recovery across server restarts
 *
 * @extends EventEmitter
 */
export class PtyManager extends EventEmitter {
  private sessions = new Map<string, PtySession>();
  private sessionManager: SessionManager;
  private sessionLifecycle: SessionLifecycle;
  private ioHandler: IOHandler;
  private titleManager: TitleManager;
  private processTracker: ProcessTracker;
  private ipcSocketHandler: IPCSocketHandler;

  private lastTerminalSize: { cols: number; rows: number } | null = null;
  private resizeEventListeners: Array<() => void> = [];
  private sessionEventListeners = new Map<string, Set<(...args: unknown[]) => void>>();
  private sessionExitTimes = new Map<string, number>();
  private sessionMonitor: SessionMonitor | null = null;
  private static initialized = false;

  constructor(controlPath?: string) {
    super();

    if (!PtyManager.initialized) {
      throw new Error('PtyManager not initialized. Call PtyManager.initialize() first.');
    }

    this.sessionManager = new SessionManager(controlPath);

    // Initialize sub-modules
    this.titleManager = new TitleManager({ enabled: true });

    this.ioHandler = new IOHandler({
      getSessionPaths: (sessionId) => this.sessionManager.getSessionPaths(sessionId),
    });

    this.processTracker = new ProcessTracker();

    // Wire up process tracker events
    this.processTracker.on('commandStarted', (data) => {
      if (this.sessionMonitor) {
        this.sessionMonitor.updateCommand(data.sessionId, data.command);
      }
    });

    this.processTracker.on('commandFinished', (data) => {
      this.emit('commandFinished', data);

      // Send notification to Mac app
      if (controlUnixHandler.isMacAppConnected()) {
        const isClaudeCommand = data.command.toLowerCase().includes('claude');
        const notifTitle = isClaudeCommand ? 'Claude Task Finished' : 'Command Finished';
        const notifBody = `"${data.command}" completed in ${Math.round(data.duration / 1000)}s.`;
        const session = this.sessions.get(data.sessionId);
        controlUnixHandler.sendNotification('Your Turn', notifBody, {
          type: 'your-turn',
          sessionId: data.sessionId,
          sessionName: session?.sessionInfo.name || session?.sessionInfo.command.join(' ') || '',
        });
      }
    });

    // Initialize IPC socket handler
    this.ipcSocketHandler = new IPCSocketHandler({
      controlHandler: {
        handleResize: (sessionId, cols, rows) => {
          const session = this.sessions.get(sessionId);
          if (session?.ptyProcess) {
            try {
              session.ptyProcess.resize(cols, rows);
              session.asciinemaWriter?.writeResize(cols, rows);
            } catch (error) {
              logger.warn(`Failed to resize session ${sessionId}:`, error);
            }
          }
        },
        handleKill: (sessionId, signal) => {
          const session = this.sessions.get(sessionId);
          if (session?.ptyProcess) {
            try {
              session.ptyProcess.kill(signal as string);
            } catch (error) {
              logger.warn(`Failed to kill session ${sessionId}:`, error);
            }
          }
        },
        handleResetSize: (sessionId) => {
          const session = this.sessions.get(sessionId);
          if (session?.ptyProcess) {
            try {
              const cols = process.stdout.columns || 80;
              const rows = process.stdout.rows || 24;
              session.ptyProcess.resize(cols, rows);
              session.asciinemaWriter?.writeResize(cols, rows);
            } catch (error) {
              logger.warn(`Failed to reset session ${sessionId} size:`, error);
            }
          }
        },
        handleTitleUpdate: (sessionId, title) => {
          logger.debug(`[IPC] Received title update for session ${sessionId}: "${title}"`);
          this.updateSessionName(sessionId, title);
        },
      },
      stdinHandler: {
        handleStdinData: (sessionId, data) => {
          const session = this.sessions.get(sessionId);
          if (session?.ptyProcess && session.inputQueue) {
            const inputTimestamp = Date.now();
            session.lastInputTimestamp = inputTimestamp;

            session.inputQueue.enqueue(() => {
              if (session.ptyProcess) {
                session.ptyProcess.write(data);
              }
              session.asciinemaWriter?.writeInput(data);
            });
          }
        },
      },
    });

    // Initialize session lifecycle with callbacks
    this.sessionLifecycle = new SessionLifecycle(
      this.sessionManager,
      {
        onSessionCreated: (session) => {
          this.sessions.set(session.id, session);
        },
        setupPtyHandlers: (session, forwardToStdout, onExit) => {
          this.setupPtyHandlers(session, forwardToStdout, onExit);
        },
      }
    );

    this.setupTerminalResizeDetection();
  }

  /**
   * Initialize PtyManager with fallback support for node-pty
   */
  public static async initialize(): Promise<void> {
    if (PtyManager.initialized) {
      return;
    }

    await initializeNodePty();
    PtyManager.initialized = true;
    logger.log('✅ PtyManager initialized successfully');
  }

  /**
   * Set the SessionMonitor instance for notification tracking
   */
  public setSessionMonitor(monitor: SessionMonitor): void {
    this.sessionMonitor = monitor;
  }

  /**
   * Setup terminal resize detection for when the hosting terminal is resized
   */
  private setupTerminalResizeDetection(): void {
    if (!process.stdout.isTTY) {
      logger.debug('Not a TTY, skipping terminal resize detection');
      return;
    }

    this.lastTerminalSize = {
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 24,
    };

    const handleStdoutResize = () => {
      const newCols = process.stdout.columns || 80;
      const newRows = process.stdout.rows || 24;
      this.handleTerminalResize(newCols, newRows);
    };

    process.stdout.on('resize', handleStdoutResize);
    this.resizeEventListeners.push(() => {
      process.stdout.removeListener('resize', handleStdoutResize);
    });

    const handleSigwinch = () => {
      const newCols = process.stdout.columns || 80;
      const newRows = process.stdout.rows || 24;
      this.handleTerminalResize(newCols, newRows);
    };

    process.on('SIGWINCH', handleSigwinch);
    this.resizeEventListeners.push(() => {
      process.removeListener('SIGWINCH', handleSigwinch);
    });
  }

  /**
   * Handle terminal resize events from the hosting terminal
   */
  private handleTerminalResize(newCols: number, newRows: number): void {
    if (
      this.lastTerminalSize &&
      this.lastTerminalSize.cols === newCols &&
      this.lastTerminalSize.rows === newRows
    ) {
      return;
    }

    logger.log(chalk.blue(`Terminal resized to ${newCols}x${newRows}`));
    this.lastTerminalSize = { cols: newCols, rows: newRows };

    for (const [sessionId, session] of this.sessions) {
      if (session.ptyProcess && session.sessionInfo.status === 'running') {
        this.ioHandler.handleTerminalResize(sessionId, newCols, newRows, session);
      }
    }
  }

  /**
   * Create a new PTY session
   */
  async createSession(
    command: string[],
    options: SessionCreateOptions & {
      forwardToStdout?: boolean;
      onExit?: (exitCode: number, signal?: number) => void;
    }
  ): Promise<SessionCreationResult> {
    const { session, result } = await this.sessionLifecycle.createSession(command, options);

    // Setup session watcher for external sessions
    if (options.forwardToStdout) {
      this.setupSessionWatcher(session);
    }

    // Emit session started event
    this.emit('sessionStarted', session.id, session.sessionInfo.name || session.sessionInfo.command.join(' '));

    // Send notification to Mac app
    if (controlUnixHandler.isMacAppConnected()) {
      controlUnixHandler.sendNotification(
        'Session Started',
        session.sessionInfo.name || session.sessionInfo.command.join(' '),
        {
          type: 'session-start',
          sessionId: session.id,
          sessionName: session.sessionInfo.name || session.sessionInfo.command.join(' '),
        }
      );
    }

    return result;
  }

  public getPtyForSession(sessionId: string): IPty | null {
    const session = this.sessions.get(sessionId);
    return session?.ptyProcess || null;
  }

  public getInternalSession(sessionId: string): PtySession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Setup event handlers for a PTY process
   */
  private setupPtyHandlers(
    session: PtySession,
    forwardToStdout: boolean,
    onExit?: (exitCode: number, signal?: number) => void
  ): void {
    const { ptyProcess, asciinemaWriter } = session;

    if (!ptyProcess) {
      logger.error(`No PTY process found for session ${session.id}`);
      return;
    }

    // Create write queue for stdout if forwarding
    const stdoutQueue = forwardToStdout ? new WriteQueue() : null;
    if (stdoutQueue) {
      session.stdoutQueue = stdoutQueue;
    }

    // Create write queue for input to prevent race conditions
    const inputQueue = new WriteQueue();
    session.inputQueue = inputQueue;

    // Initialize title management
    this.titleManager.initializeSession(session);

    // Handle PTY data output
    ptyProcess.onData((data: string) => {
      let processedData = data;

      // Track PTY output in SessionMonitor for bell detection
      if (this.sessionMonitor) {
        this.sessionMonitor.trackPtyOutput(session.id, data);
      }

      // Track output activity for active/idle detection
      session.lastOutputTimestamp = Date.now();

      // Filter title sequences if needed
      if (session.titleMode !== undefined && session.titleMode !== TitleMode.NONE) {
        processedData = this.titleManager.filterOutput(session.id, data, session.titleMode);
      }

      // Process for title triggers
      this.titleManager.processOutputForTitleTriggers(session, processedData);

      // Write to asciinema file
      asciinemaWriter?.writeOutput(Buffer.from(processedData, 'utf8'));

      // Forward to stdout if requested
      if (forwardToStdout && stdoutQueue) {
        stdoutQueue.enqueue(async () => {
          const canWrite = process.stdout.write(processedData);
          this.titleManager.recordWriteTimestamp(session.id);

          if (!canWrite) {
            await once(process.stdout, 'drain');
          }
        });
      }
    });

    // Handle PTY exit
    ptyProcess.onExit(async ({ exitCode, signal }: { exitCode: number; signal?: number }) => {
      try {
        // Mark session as exiting
        this.sessionExitTimes.set(session.id, Date.now());

        // Write exit event to asciinema
        if (asciinemaWriter?.isOpen()) {
          asciinemaWriter.writeRawJson(['exit', exitCode || 0, session.id]);
          asciinemaWriter
            .close()
            .catch((error) =>
              logger.error(`Failed to close asciinema writer for session ${session.id}:`, error)
            );
        }

        // Update session status
        this.sessionManager.updateSessionStatus(
          session.id,
          'exited',
          undefined,
          exitCode || (signal ? 128 + (typeof signal === 'number' ? signal : 1) : 1)
        );

        // Wait for stdout queue to drain
        if (session.stdoutQueue) {
          try {
            await session.stdoutQueue.drain();
          } catch (error) {
            logger.error(`Failed to drain stdout queue for session ${session.id}:`, error);
          }
        }

        // Clean up session resources
        this.cleanupSessionResources(session);

        // Remove from active sessions
        this.sessions.delete(session.id);

        // Emit session exited event
        this.emit(
          'sessionExited',
          session.id,
          session.sessionInfo.name || session.sessionInfo.command.join(' '),
          exitCode
        );

        // Send notification to Mac app
        if (controlUnixHandler.isMacAppConnected()) {
          controlUnixHandler.sendNotification(
            'Session Ended',
            session.sessionInfo.name || session.sessionInfo.command.join(' '),
            {
              type: 'session-exit',
              sessionId: session.id,
              sessionName: session.sessionInfo.name || session.sessionInfo.command.join(' '),
            }
          );
        }

        // Call exit callback if provided
        if (onExit) {
          onExit(exitCode || 0, signal);
        }
      } catch (error) {
        logger.error(`Failed to handle exit for session ${session.id}:`, error);
      }
    });

    // Setup IPC socket
    this.ipcSocketHandler.setupSocket(session);

    // Start foreground process tracking
    this.processTracker.startTracking(session);
  }

  /**
   * Setup file watcher for session.json changes
   */
  private setupSessionWatcher(session: PtySession): void {
    try {
      const checkInterval = setInterval(() => {
        try {
          const updatedInfo = this.sessionManager.loadSessionInfo(session.id);
          if (updatedInfo && updatedInfo.name !== session.sessionInfo.name) {
            const oldName = session.sessionInfo.name;
            session.sessionInfo.name = updatedInfo.name;

            logger.debug(
              `Session ${session.id} name changed from "${oldName}" to "${updatedInfo.name}"`
            );

            this.trackAndEmit('sessionNameChanged', session.id, updatedInfo.name);

            if (session.isExternalTerminal && session.titleMode === TitleMode.STATIC) {
              this.titleManager.markTitleUpdateNeeded(session);
            }
          }
        } catch (error) {
          logger.debug(`Failed to read session file for ${session.id}:`, error);
        }
      }, 100);

      session.sessionJsonInterval = checkInterval;
      logger.debug(`Session watcher setup for ${session.id}`);
    } catch (error) {
      logger.error(`Failed to setup session watcher for ${session.id}:`, error);
    }
  }

  /**
   * Get fish shell completions for a partial command
   */
  async getFishCompletions(sessionId: string, partial: string): Promise<string[]> {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return [];
      }

      const userShell = ProcessUtils.getUserShell();
      if (!FishHandler.isFishShell(userShell)) {
        return [];
      }

      const { fishHandler } = await import('./fish-handler.js');
      const cwd = session.currentWorkingDir || process.cwd();
      return await fishHandler.getCompletions(partial, cwd);
    } catch (error) {
      logger.warn(`Fish completions failed: ${error}`);
      return [];
    }
  }

  /**
   * Send text input to a session
   */
  sendInput(sessionId: string, input: SessionInput): void {
    const session = this.sessions.get(sessionId);

    // Track directory changes for title modes
    if (session?.titleMode === TitleMode.STATIC && input.text) {
      const newDir = extractCdDirectory(
        input.text,
        session.currentWorkingDir || session.sessionInfo.workingDir
      );
      if (newDir) {
        session.currentWorkingDir = newDir;
        this.titleManager.updateWorkingDir(sessionId, newDir);
        this.titleManager.markTitleUpdateNeeded(session);
        logger.debug(`Session ${sessionId} changed directory to: ${newDir}`);
      }
    }

    this.ioHandler.sendInput(sessionId, input, session);
  }

  /**
   * Resize a session terminal
   */
  resizeSession(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    this.ioHandler.resizeSession(sessionId, cols, rows, session);
  }

  /**
   * Update session name
   */
  updateSessionName(sessionId: string, name: string): string {
    logger.debug(`[PtyManager] updateSessionName called for session ${sessionId} with name: ${name}`);

    const uniqueName = this.sessionManager.updateSessionName(sessionId, name);

    const session = this.sessions.get(sessionId);
    if (session?.sessionInfo) {
      const oldName = session.sessionInfo.name;
      session.sessionInfo.name = uniqueName;

      // Force immediate title update for active sessions
      if (session.isExternalTerminal && session.stdoutQueue) {
        this.titleManager.updateTerminalTitleForSessionName(session);
      }

      logger.log(`[PtyManager] Updated session ${sessionId} name from "${oldName}" to "${uniqueName}"`);
    }

    this.trackAndEmit('sessionNameChanged', sessionId, uniqueName);
    logger.debug(`[PtyManager] Updated session ${sessionId} name to: ${uniqueName}`);

    return uniqueName;
  }

  /**
   * Reset session size to terminal size (for external terminals)
   */
  resetSessionSize(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    this.ioHandler.resetSessionSize(sessionId, session);
  }

  /**
   * Kill a session with proper SIGTERM -> SIGKILL escalation
   */
  async killSession(sessionId: string, signal: string | number = 'SIGTERM'): Promise<void> {
    const session = this.sessions.get(sessionId);

    try {
      if (session) {
        await this.sessionLifecycle.killSession(session, signal);
        this.sessions.delete(sessionId);
      } else {
        // For external sessions, check disk
        const diskSession = this.sessionManager.loadSessionInfo(sessionId);
        if (!diskSession) {
          throw new PtyError(`Session ${sessionId} not found`, 'SESSION_NOT_FOUND', sessionId);
        }

        // Send control message first
        const killMessage: KillControlMessage = { cmd: 'kill', signal };
        this.ioHandler.sendControlMessage(sessionId, killMessage);

        // Wait a bit
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Check if process is still running
        if (diskSession.pid && ProcessUtils.isProcessRunning(diskSession.pid)) {
          const terminated = await this.sessionLifecycle.killExternalSession(
            sessionId,
            diskSession.pid,
            signal
          );

          if (terminated) {
            this.sessionManager.updateSessionStatus(sessionId, 'exited', undefined, 0);
            this.emit(
              'sessionExited',
              sessionId,
              diskSession.name || diskSession.command.join(' '),
              0
            );
          }
        }
      }
    } catch (error) {
      throw new PtyError(
        `Failed to kill session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
        'KILL_FAILED',
        sessionId
      );
    }
  }

  /**
   * List all sessions (both active and persisted)
   */
  listSessions() {
    const zombieSessionIds = this.sessionManager.updateZombieSessions();
    for (const sessionId of zombieSessionIds) {
      this.ioHandler.cleanupSession(sessionId);
    }

    const now = Date.now();
    return this.sessionManager.listSessions().map((session) => {
      const activeSession = this.sessions.get(session.id);
      const activityStatus = computeActivityStatus({
        status: session.status,
        lastOutputTimestamp: activeSession?.lastOutputTimestamp,
        lastInputTimestamp:
          activeSession?.lastInputTimestamp ?? this.ioHandler.getLastInputTimestamp(session.id),
        lastModified: session.lastModified,
        startedAt: session.startedAt,
        now,
      });

      return {
        ...session,
        activityStatus,
      };
    });
  }

  /**
   * Get a specific session
   */
  getSession(sessionId: string): Session | null {
    const paths = this.sessionManager.getSessionPaths(sessionId, true);
    if (!paths) {
      return null;
    }

    const sessionInfo = this.sessionManager.loadSessionInfo(sessionId);
    if (!sessionInfo) {
      return null;
    }

    const activeSession = this.sessions.get(sessionId);

    const session: Session = {
      ...sessionInfo,
      id: sessionId,
      lastModified: sessionInfo.startedAt,
    };

    if (fs.existsSync(paths.stdoutPath)) {
      const lastModified = fs.statSync(paths.stdoutPath).mtime.toISOString();
      session.lastModified = lastModified;
    }

    session.activityStatus = computeActivityStatus({
      status: session.status,
      lastOutputTimestamp: activeSession?.lastOutputTimestamp,
      lastInputTimestamp:
        activeSession?.lastInputTimestamp ?? this.ioHandler.getLastInputTimestamp(sessionId),
      lastModified: session.lastModified,
      startedAt: session.startedAt,
    });

    return session;
  }

  getSessionPaths(sessionId: string) {
    return this.sessionManager.getSessionPaths(sessionId);
  }

  /**
   * Cleanup a specific session
   */
  cleanupSession(sessionId: string): void {
    if (this.sessions.has(sessionId)) {
      this.killSession(sessionId).catch((error) => {
        logger.error(`Failed to kill session ${sessionId} during cleanup:`, error);
      });
    }

    this.sessionManager.cleanupSession(sessionId);
    this.ioHandler.cleanupSession(sessionId);
  }

  /**
   * Cleanup all exited sessions
   */
  cleanupExitedSessions(): string[] {
    return this.sessionManager.cleanupExitedSessions();
  }

  /**
   * Get active session count
   */
  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Check if a session is active (has running PTY)
   */
  isSessionActive(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Shutdown all active sessions and clean up resources
   */
  async shutdown(): Promise<void> {
    for (const [sessionId, session] of Array.from(this.sessions.entries())) {
      try {
        if (session.ptyProcess) {
          session.ptyProcess.kill();
        }
        if (session.asciinemaWriter?.isOpen()) {
          await session.asciinemaWriter.close();
        }
        this.cleanupSessionResources(session);
      } catch (error) {
        logger.error(`Failed to cleanup session ${sessionId} during shutdown:`, error);
      }
    }

    this.sessions.clear();

    // Shutdown sub-modules
    this.ioHandler.shutdown();
    this.ipcSocketHandler.shutdown();
    this.processTracker.shutdown();

    // Clean up resize event listeners
    for (const removeListener of this.resizeEventListeners) {
      try {
        removeListener();
      } catch (error) {
        logger.error('Failed to remove resize event listener:', error);
      }
    }
    this.resizeEventListeners.length = 0;
  }

  /**
   * Get session manager instance
   */
  getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  /**
   * Track and emit events for proper cleanup
   */
  private trackAndEmit(event: string, sessionId: string, ...args: unknown[]): void {
    const listeners = this.listeners(event) as ((...args: unknown[]) => void)[];
    if (!this.sessionEventListeners.has(sessionId)) {
      this.sessionEventListeners.set(sessionId, new Set());
    }
    const sessionListeners = this.sessionEventListeners.get(sessionId);
    if (!sessionListeners) {
      return;
    }
    listeners.forEach((listener) => {
      sessionListeners.add(listener);
    });
    this.emit(event, sessionId, ...args);
  }

  /**
   * Clean up all resources associated with a session
   */
  private cleanupSessionResources(session: PtySession): void {
    // Clean up title manager resources
    this.titleManager.cleanupSession(session.id);

    // Clean up process tracker
    this.processTracker.stopTracking(session.id);

    // Clean up IPC socket handler
    this.ipcSocketHandler.cleanupSession(session.id);

    // Clean up IO handler resources
    this.ioHandler.cleanupSession(session.id);

    // Clean up session.json watcher/interval
    if (session.sessionJsonWatcher) {
      session.sessionJsonWatcher.close();
      session.sessionJsonWatcher = undefined;
    }
    if (session.sessionJsonInterval) {
      clearInterval(session.sessionJsonInterval);
      session.sessionJsonInterval = undefined;
    }

    // Clean up input socket server (for backward compatibility)
    if (session.inputSocketServer) {
      session.inputSocketServer.close();
      session.inputSocketServer.unref();
      try {
        fs.unlinkSync(path.join(session.controlDir, 'ipc.sock'));
      } catch (_e) {
        // Socket already removed
      }
    }

    // Remove all event listeners for this session
    const listeners = this.sessionEventListeners.get(session.id);
    if (listeners) {
      listeners.forEach((listener) => {
        this.removeListener('sessionNameChanged', listener);
        this.removeListener('watcherError', listener);
        this.removeListener('bell', listener);
      });
      this.sessionEventListeners.delete(session.id);
    }

    // Clean up session exit time tracking
    this.sessionExitTimes.delete(session.id);
  }
}
