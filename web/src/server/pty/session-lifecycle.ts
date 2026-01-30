/**
 * SessionLifecycle - Handles PTY session creation, destruction, and recovery
 *
 * Responsible for:
 * - Creating new PTY sessions with proper setup
 * - Killing sessions with graceful SIGTERM -> SIGKILL escalation
 * - Cleaning up session resources
 * - Managing session watchers for external sessions
 */

import chalk from 'chalk';
import { EventEmitter, once } from 'events';
import * as fs from 'fs';
import type { IPty, IPtyForkOptions } from 'node-pty';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { SessionCreateOptions, SessionInfo, TitleMode } from '../../shared/types.js';
import { TitleSequenceFilter } from '../utils/ansi-title-filter.js';
import { createLogger } from '../utils/logger.js';
import { WriteQueue } from '../utils/write-queue.js';
import { VERSION } from '../version.js';
import { AsciinemaWriter } from './asciinema-writer.js';
import { ProcessUtils } from './process-utils.js';
import type { SessionManager } from './session-manager.js';
import { PtyError, type PtySession, type SessionCreationResult } from './types.js';

const logger = createLogger('session-lifecycle');

// Import node-pty dynamically
let pty: typeof import('node-pty');

/**
 * Initialize the node-pty module
 */
export async function initializeNodePty(): Promise<void> {
  try {
    logger.log('Initializing node-pty...');
    pty = await import('node-pty');
    logger.log('✅ node-pty initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize node-pty:', error);
    throw new Error(
      `Cannot load node-pty: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Check if node-pty is initialized
 */
export function isNodePtyInitialized(): boolean {
  return pty !== undefined;
}

/**
 * Configuration for SessionLifecycle
 */
export interface SessionLifecycleConfig {
  /** Default terminal type */
  defaultTerm?: string;
}

/**
 * Callbacks for session events
 */
export interface SessionLifecycleCallbacks {
  /** Called when session is created */
  onSessionCreated?: (session: PtySession) => void;
  /** Called when session exits */
  onSessionExited?: (sessionId: string, name: string, exitCode: number) => void;
  /** Called when session name changes */
  onSessionNameChanged?: (sessionId: string, name: string) => void;
  /** Called to setup PTY event handlers */
  setupPtyHandlers?: (
    session: PtySession,
    forwardToStdout: boolean,
    onExit?: (exitCode: number, signal?: number) => void
  ) => void;
}

/**
 * Manages PTY session lifecycle
 */
export class SessionLifecycle {
  private readonly defaultTerm: string;

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly callbacks: SessionLifecycleCallbacks,
    config: SessionLifecycleConfig = {}
  ) {
    this.defaultTerm = config.defaultTerm || 'xterm-256color';
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
  ): Promise<{ session: PtySession; result: SessionCreationResult }> {
    if (!pty) {
      throw new Error('node-pty not initialized. Call initializeNodePty() first.');
    }

    const sessionId = options.sessionId || uuidv4();
    const sessionName = options.name || path.basename(command[0]);
    const webDir = path.resolve(__dirname, '..', '..');
    const workingDir = options.workingDir || webDir;
    const term = this.defaultTerm;
    const cols = options.cols;
    const rows = options.rows;

    logger.debug('Session creation parameters:', {
      sessionId,
      sessionName,
      workingDir,
      term,
      cols: cols !== undefined ? cols : 'terminal default',
      rows: rows !== undefined ? rows : 'terminal default',
    });

    try {
      // Create session directory structure
      const paths = this.sessionManager.createSessionDirectory(sessionId);

      // Resolve the command using unified resolution logic
      const resolved = ProcessUtils.resolveCommand(command);
      const { command: finalCommand, args: finalArgs } = resolved;
      const resolvedCommand = [finalCommand, ...finalArgs];

      // Log resolution details
      if (resolved.resolvedFrom === 'alias') {
        logger.log(
          chalk.cyan(`Using alias: '${resolved.originalCommand}' → '${resolvedCommand.join(' ')}'`)
        );
      } else if (resolved.resolvedFrom === 'path' && resolved.originalCommand) {
        logger.log(chalk.gray(`Resolved '${resolved.originalCommand}' → '${finalCommand}'`));
      } else if (resolved.useShell) {
        logger.debug(`Using shell to execute ${resolved.resolvedFrom}: ${command.join(' ')}`);
      }

      logger.debug(chalk.blue(`Creating PTY session with command: ${resolvedCommand.join(' ')}`));
      logger.debug(`Working directory: ${workingDir}`);

      // Check if this session is being spawned from within VibeTunnel
      const attachedViaVT = !!process.env.VIBETUNNEL_SESSION_ID;

      // Create initial session info with resolved command
      const sessionInfo: SessionInfo = {
        id: sessionId,
        command: resolvedCommand,
        name: sessionName,
        workingDir: workingDir,
        status: 'starting',
        startedAt: new Date().toISOString(),
        initialCols: cols,
        initialRows: rows,
        lastClearOffset: 0,
        version: VERSION,
        gitRepoPath: options.gitRepoPath,
        gitBranch: options.gitBranch,
        gitAheadCount: options.gitAheadCount,
        gitBehindCount: options.gitBehindCount,
        gitHasChanges: options.gitHasChanges,
        gitIsWorktree: options.gitIsWorktree,
        gitMainRepoPath: options.gitMainRepoPath,
        attachedViaVT,
      };

      // Save initial session info
      this.sessionManager.saveSessionInfo(sessionId, sessionInfo);

      // Create asciinema writer
      const asciinemaWriter = AsciinemaWriter.create(
        paths.stdoutPath,
        cols || undefined,
        rows || undefined,
        command.join(' '),
        sessionName,
        this.createEnvVars(term)
      );

      // Set up pruning detection callback
      asciinemaWriter.onPruningSequence(async ({ sequence, position }) => {
        const sessionInfo = this.sessionManager.loadSessionInfo(sessionId);
        if (sessionInfo) {
          sessionInfo.lastClearOffset = position;
          await this.sessionManager.saveSessionInfo(sessionId, sessionInfo);

          logger.debug(
            `Updated lastClearOffset for session ${sessionId} to exact position ${position}`
          );
        }
      });

      // Create PTY process
      let ptyProcess: IPty;
      try {
        // Detect if we're spawning fish shell and add feature flag to disable DA1 query
        // ghostty-web doesn't respond to DA1 queries, causing a 2-second startup delay
        const isFish = finalCommand === 'fish' || finalCommand.endsWith('/fish');
        const adjustedArgs = isFish ? ['--features=no-query-term', ...finalArgs] : finalArgs;

        const ptyEnv = {
          ...process.env,
          TERM: term,
          VIBETUNNEL_SESSION_ID: sessionId,
        };

        logger.debug('PTY spawn parameters:', {
          command: finalCommand,
          args: adjustedArgs,
          options: {
            name: term,
            cols: cols !== undefined ? cols : 'terminal default',
            rows: rows !== undefined ? rows : 'terminal default',
            cwd: workingDir,
            hasEnv: !!ptyEnv,
            envKeys: Object.keys(ptyEnv).length,
          },
        });

        const spawnOptions: IPtyForkOptions = {
          name: term,
          cwd: workingDir,
          env: ptyEnv,
        };

        if (cols !== undefined) {
          spawnOptions.cols = cols;
        }
        if (rows !== undefined) {
          spawnOptions.rows = rows;
        }

        ptyProcess = pty.spawn(finalCommand, adjustedArgs, spawnOptions);

        // Add immediate exit handler for CI issues
        const exitHandler = (event: { exitCode: number; signal?: number }) => {
          const timeSinceStart = Date.now() - Date.parse(sessionInfo.startedAt);
          if (timeSinceStart < 1000) {
            logger.error(
              `PTY process exited quickly after spawn! Exit code: ${event.exitCode}, signal: ${event.signal}`
            );
          }
        };
        ptyProcess.onExit(exitHandler);
      } catch (spawnError) {
        // Provide better error messages for common issues
        let errorMessage = spawnError instanceof Error ? spawnError.message : String(spawnError);

        const errorCode =
          spawnError instanceof Error && 'code' in spawnError
            ? (spawnError as NodeJS.ErrnoException).code
            : undefined;
        if (errorCode === 'ENOENT' || errorMessage.includes('ENOENT')) {
          errorMessage = `Command not found: '${command[0]}'`;
        } else if (errorCode === 'EACCES' || errorMessage.includes('EACCES')) {
          errorMessage = `Permission denied: '${command[0]}'`;
        } else if (errorCode === 'ENXIO' || errorMessage.includes('ENXIO')) {
          errorMessage = `Failed to allocate terminal for '${command[0]}'`;
        }

        logger.error(`Failed to spawn PTY for command '${command.join(' ')}':`, spawnError);
        throw new PtyError(errorMessage, 'SPAWN_FAILED');
      }

      // Create session object
      const titleMode = options.titleMode;

      // Detect if this is a tmux attachment session
      const isTmuxAttachment =
        (resolvedCommand.includes('tmux') &&
          (resolvedCommand.includes('attach-session') ||
            resolvedCommand.includes('attach') ||
            resolvedCommand.includes('a'))) ||
        sessionName.startsWith('tmux:');

      const session: PtySession = {
        id: sessionId,
        sessionInfo,
        ptyProcess,
        asciinemaWriter,
        controlDir: paths.controlDir,
        stdoutPath: paths.stdoutPath,
        stdinPath: paths.stdinPath,
        sessionJsonPath: paths.sessionJsonPath,
        startTime: new Date(),
        titleMode: titleMode,
        isExternalTerminal: !!options.forwardToStdout,
        currentWorkingDir: workingDir,
        titleFilter: new TitleSequenceFilter(),
        isTmuxAttachment,
      };

      // Update session info with PID and running status
      sessionInfo.pid = ptyProcess.pid;
      sessionInfo.status = 'running';
      this.sessionManager.saveSessionInfo(sessionId, sessionInfo);

      logger.debug(
        chalk.green(`Session ${sessionId} created successfully (PID: ${ptyProcess.pid})`)
      );
      logger.log(chalk.gray(`Running: ${resolvedCommand.join(' ')} in ${workingDir}`));

      // Setup PTY handlers via callback
      if (this.callbacks.setupPtyHandlers) {
        this.callbacks.setupPtyHandlers(session, options.forwardToStdout || false, options.onExit);
      }

      // Notify callback
      if (this.callbacks.onSessionCreated) {
        this.callbacks.onSessionCreated(session);
      }

      return {
        session,
        result: {
          sessionId,
          sessionInfo,
        },
      };
    } catch (error) {
      // Cleanup on failure
      try {
        this.sessionManager.cleanupSession(sessionId);
      } catch (cleanupError) {
        logger.warn(`Failed to cleanup session ${sessionId} after creation failure:`, cleanupError);
      }

      throw new PtyError(
        `Failed to create session: ${error instanceof Error ? error.message : String(error)}`,
        'SESSION_CREATE_FAILED'
      );
    }
  }

  /**
   * Detach from a tmux session gracefully
   */
  async detachFromTmux(session: PtySession): Promise<boolean> {
    if (!session.isTmuxAttachment || !session.ptyProcess) {
      return false;
    }

    try {
      logger.log(chalk.cyan(`Detaching from tmux session (${session.id})`));

      // Try the standard detach sequence first (Ctrl-B, d)
      session.ptyProcess.write('\x02d'); // \x02 is Ctrl-B

      // Wait for detachment
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Check if the process is still running
      if (!ProcessUtils.isProcessRunning(session.ptyProcess.pid)) {
        logger.log(chalk.green(`Successfully detached from tmux (${session.id})`));
        return true;
      }

      // If still running, try sending the detach-client command
      logger.debug('First detach attempt failed, trying detach-client command');
      session.ptyProcess.write(':detach-client\n');

      // Wait a bit longer
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Final check
      if (!ProcessUtils.isProcessRunning(session.ptyProcess.pid)) {
        logger.log(
          chalk.green(`Successfully detached from tmux using detach-client (${session.id})`)
        );
        return true;
      }

      return false;
    } catch (error) {
      logger.error(`Error detaching from tmux: ${error}`);
      return false;
    }
  }

  /**
   * Kill a session with proper SIGTERM -> SIGKILL escalation
   */
  async killSession(session: PtySession, signal: string | number = 'SIGTERM'): Promise<void> {
    // Special handling for tmux attachment sessions
    if (session.isTmuxAttachment) {
      const detached = await this.detachFromTmux(session);
      if (detached) {
        return;
      }
      logger.warn(`Failed to detach from tmux, falling back to normal kill`);
    }

    if (!session.ptyProcess) {
      return;
    }

    // If signal is already SIGKILL, send it immediately
    if (signal === 'SIGKILL' || signal === 9) {
      session.ptyProcess.kill('SIGKILL');
      await new Promise((resolve) => setTimeout(resolve, 100));
      return;
    }

    // Start with SIGTERM and escalate if needed
    await this.killSessionWithEscalation(session);
  }

  /**
   * Kill session with SIGTERM -> SIGKILL escalation (3 seconds, check every 500ms)
   */
  private async killSessionWithEscalation(session: PtySession): Promise<void> {
    if (!session.ptyProcess) {
      return;
    }

    const pid = session.ptyProcess.pid;
    logger.debug(chalk.yellow(`Terminating session ${session.id} (PID: ${pid})`));

    try {
      // Send SIGTERM first
      session.ptyProcess.kill('SIGTERM');

      // Wait up to 3 seconds for graceful termination (check every 500ms)
      const maxWaitTime = 3000;
      const checkInterval = 500;
      const maxChecks = maxWaitTime / checkInterval;

      for (let i = 0; i < maxChecks; i++) {
        await new Promise((resolve) => setTimeout(resolve, checkInterval));

        if (!ProcessUtils.isProcessRunning(pid)) {
          logger.debug(chalk.green(`Session ${session.id} terminated gracefully`));
          return;
        }

        logger.debug(`Session ${session.id} still running after ${(i + 1) * checkInterval}ms`);
      }

      // Process didn't terminate gracefully within 3 seconds, force kill
      logger.debug(chalk.yellow(`Session ${session.id} requires SIGKILL`));
      try {
        session.ptyProcess.kill('SIGKILL');
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (_killError) {
        logger.debug(`SIGKILL failed for session ${session.id} (process already terminated)`);
      }

      logger.debug(chalk.yellow(`Session ${session.id} forcefully terminated`));
    } catch (error) {
      throw new PtyError(
        `Failed to terminate session ${session.id}: ${error instanceof Error ? error.message : String(error)}`,
        'KILL_FAILED',
        session.id
      );
    }
  }

  /**
   * Kill an external session by PID
   */
  async killExternalSession(
    sessionId: string,
    pid: number,
    signal: string | number = 'SIGTERM'
  ): Promise<boolean> {
    if (!ProcessUtils.isProcessRunning(pid)) {
      return true;
    }

    let terminated = false;
    logger.log(chalk.yellow(`Killing external session ${sessionId} (PID: ${pid})`));

    if (signal === 'SIGKILL' || signal === 9) {
      process.kill(pid, 'SIGKILL');
      await new Promise((resolve) => setTimeout(resolve, 100));
      terminated = !ProcessUtils.isProcessRunning(pid);
    } else {
      // Send SIGTERM first
      process.kill(pid, 'SIGTERM');

      // Wait up to 3 seconds for graceful termination
      const maxWaitTime = 3000;
      const checkInterval = 500;
      const maxChecks = maxWaitTime / checkInterval;

      for (let i = 0; i < maxChecks; i++) {
        await new Promise((resolve) => setTimeout(resolve, checkInterval));

        if (!ProcessUtils.isProcessRunning(pid)) {
          logger.debug(chalk.green(`External session ${sessionId} terminated gracefully`));
          terminated = true;
          break;
        }
      }

      // Process didn't terminate gracefully, force kill
      if (!terminated) {
        logger.debug(chalk.yellow(`External session ${sessionId} requires SIGKILL`));
        process.kill(pid, 'SIGKILL');
        await new Promise((resolve) => setTimeout(resolve, 100));
        terminated = !ProcessUtils.isProcessRunning(pid);
      }
    }

    return terminated;
  }

  /**
   * Create environment variables for sessions
   */
  private createEnvVars(term: string): Record<string, string> {
    const envVars: Record<string, string> = {
      TERM: term,
    };

    const importantVars = ['SHELL', 'LANG', 'LC_ALL', 'PATH', 'USER', 'HOME'];
    for (const varName of importantVars) {
      const value = process.env[varName];
      if (value) {
        envVars[varName] = value;
      }
    }

    return envVars;
  }
}
