/**
 * PtyManager - Core PTY management using node-pty
 *
 * This class handles PTY creation, process management, and I/O operations
 * using the node-pty library while maintaining compatibility with tty-fwd.
 */

import chalk from 'chalk';
import { EventEmitter, once } from 'events';
import * as fs from 'fs';
import * as net from 'net';
import type { IPty } from 'node-pty';
import * as pty from 'node-pty';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type {
  Session,
  SessionCreateOptions,
  SessionInfo,
  SessionInput,
  SpecialKey,
} from '../../shared/types.js';
import { TitleMode } from '../../shared/types.js';
import { ProcessTreeAnalyzer } from '../services/process-tree-analyzer.js';
import { ActivityDetector, type ActivityState } from '../utils/activity-detector.js';
import { TitleSequenceFilter } from '../utils/ansi-title-filter.js';
import { createLogger } from '../utils/logger.js';
import {
  extractCdDirectory,
  generateDynamicTitle,
  generateTitleSequence,
  shouldInjectTitle,
} from '../utils/terminal-title.js';
import { WriteQueue } from '../utils/write-queue.js';
import { VERSION } from '../version.js';
import { AsciinemaWriter } from './asciinema-writer.js';
import { ProcessUtils } from './process-utils.js';
import { SessionManager } from './session-manager.js';
import {
  type ControlCommand,
  frameMessage,
  MessageParser,
  MessageType,
  parsePayload,
} from './socket-protocol.js';
import {
  type KillControlMessage,
  PtyError,
  type PtySession,
  type ResetSizeControlMessage,
  type ResizeControlMessage,
  type SessionCreationResult,
} from './types.js';

const logger = createLogger('pty-manager');

// Title injection timing constants
const TITLE_UPDATE_INTERVAL_MS = 1000; // How often to check if title needs updating
const TITLE_INJECTION_QUIET_PERIOD_MS = 50; // Minimum quiet period before injecting title
const TITLE_INJECTION_CHECK_INTERVAL_MS = 10; // How often to check for quiet period

export class PtyManager extends EventEmitter {
  private sessions = new Map<string, PtySession>();
  private sessionManager: SessionManager;
  private defaultTerm = 'xterm-256color';
  private inputSocketClients = new Map<string, net.Socket>(); // Cache socket connections
  private lastTerminalSize: { cols: number; rows: number } | null = null;
  private resizeEventListeners: Array<() => void> = [];
  private sessionResizeSources = new Map<
    string,
    { cols: number; rows: number; source: 'browser' | 'terminal'; timestamp: number }
  >();
  private sessionEventListeners = new Map<string, Set<(...args: unknown[]) => void>>();
  private lastBellTime = new Map<string, number>(); // Track last bell time per session
  private sessionExitTimes = new Map<string, number>(); // Track session exit times to avoid false bells
  private processTreeAnalyzer = new ProcessTreeAnalyzer(); // Process tree analysis for bell source identification
  private activityFileWarningsLogged = new Set<string>(); // Track which sessions we've logged warnings for
  private lastWrittenActivityState = new Map<string, string>(); // Track last written activity state to avoid unnecessary writes

  constructor(controlPath?: string) {
    super();
    this.sessionManager = new SessionManager(controlPath);
    this.setupTerminalResizeDetection();
  }

  /**
   * Setup terminal resize detection for when the hosting terminal is resized
   */
  private setupTerminalResizeDetection(): void {
    // Only setup resize detection if we're running in a TTY
    if (!process.stdout.isTTY) {
      logger.debug('Not a TTY, skipping terminal resize detection');
      return;
    }

    // Store initial terminal size
    this.lastTerminalSize = {
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 24,
    };

    // Method 1: Listen for Node.js TTY resize events (most reliable)
    const handleStdoutResize = () => {
      const newCols = process.stdout.columns || 80;
      const newRows = process.stdout.rows || 24;
      this.handleTerminalResize(newCols, newRows);
    };

    process.stdout.on('resize', handleStdoutResize);
    this.resizeEventListeners.push(() => {
      process.stdout.removeListener('resize', handleStdoutResize);
    });

    // Method 2: Listen for SIGWINCH signals (backup for Unix systems)
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
    // Skip if size hasn't actually changed
    if (
      this.lastTerminalSize &&
      this.lastTerminalSize.cols === newCols &&
      this.lastTerminalSize.rows === newRows
    ) {
      return;
    }

    logger.log(chalk.blue(`Terminal resized to ${newCols}x${newRows}`));

    // Update stored size
    this.lastTerminalSize = { cols: newCols, rows: newRows };

    // Forward resize to all active sessions using "last resize wins" logic
    const currentTime = Date.now();
    for (const [sessionId, session] of this.sessions) {
      if (session.ptyProcess && session.sessionInfo.status === 'running') {
        // Check if we should apply this resize based on "last resize wins" logic
        const lastResize = this.sessionResizeSources.get(sessionId);
        const shouldResize =
          !lastResize ||
          lastResize.source === 'terminal' ||
          currentTime - lastResize.timestamp > 1000; // 1 second grace period for browser resizes

        if (shouldResize) {
          try {
            // Resize the PTY process
            session.ptyProcess.resize(newCols, newRows);

            // Record the resize event in the asciinema file
            session.asciinemaWriter?.writeResize(newCols, newRows);

            // Track this resize
            this.sessionResizeSources.set(sessionId, {
              cols: newCols,
              rows: newRows,
              source: 'terminal',
              timestamp: currentTime,
            });

            logger.debug(`Resized session ${sessionId} to ${newCols}x${newRows} from terminal`);
          } catch (error) {
            logger.error(`Failed to resize session ${sessionId}:`, error);
          }
        } else {
          logger.debug(
            `Skipping terminal resize for session ${sessionId} (browser has precedence)`
          );
        }
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
    const sessionId = options.sessionId || uuidv4();
    const sessionName = options.name || path.basename(command[0]);
    const workingDir = options.workingDir || process.cwd();
    const term = this.defaultTerm;
    // For external spawns without dimensions, let node-pty use the terminal's natural size
    // For other cases, use reasonable defaults
    const cols = options.cols;
    const rows = options.rows;

    // Verify working directory exists
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

      // Log the final command
      logger.debug(chalk.blue(`Creating PTY session with command: ${resolvedCommand.join(' ')}`));
      logger.debug(`Working directory: ${workingDir}`);

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
        version: VERSION,
      };

      // Save initial session info
      this.sessionManager.saveSessionInfo(sessionId, sessionInfo);

      // Create asciinema writer
      // Use actual dimensions if provided, otherwise AsciinemaWriter will use defaults (80x24)
      const asciinemaWriter = AsciinemaWriter.create(
        paths.stdoutPath,
        cols || undefined,
        rows || undefined,
        command.join(' '),
        sessionName,
        this.createEnvVars(term)
      );

      // Create PTY process
      let ptyProcess: IPty;
      try {
        // Set up environment like Linux implementation
        const ptyEnv = {
          ...process.env,
          TERM: term,
          // Set session ID to prevent recursive vt calls and for debugging
          VIBETUNNEL_SESSION_ID: sessionId,
        };

        // Debug log the spawn parameters
        logger.debug('PTY spawn parameters:', {
          command: finalCommand,
          args: finalArgs,
          options: {
            name: term,
            cols: cols !== undefined ? cols : 'terminal default',
            rows: rows !== undefined ? rows : 'terminal default',
            cwd: workingDir,
            hasEnv: !!ptyEnv,
            envKeys: Object.keys(ptyEnv).length,
          },
        });

        // Build spawn options - only include dimensions if provided
        const spawnOptions: pty.IPtyForkOptions = {
          name: term,
          cwd: workingDir,
          env: ptyEnv,
        };

        // Only add dimensions if they're explicitly provided
        // This allows node-pty to use the terminal's natural size for external spawns
        if (cols !== undefined) {
          spawnOptions.cols = cols;
        }
        if (rows !== undefined) {
          spawnOptions.rows = rows;
        }

        ptyProcess = pty.spawn(finalCommand, finalArgs, spawnOptions);
      } catch (spawnError) {
        // Debug log the raw error first
        logger.debug('Raw spawn error:', {
          type: typeof spawnError,
          isError: spawnError instanceof Error,
          errorString: String(spawnError),
          errorKeys: spawnError && typeof spawnError === 'object' ? Object.keys(spawnError) : [],
        });

        // Provide better error messages for common issues
        let errorMessage = spawnError instanceof Error ? spawnError.message : String(spawnError);

        const errorCode =
          spawnError instanceof Error && 'code' in spawnError
            ? (spawnError as NodeJS.ErrnoException).code
            : undefined;
        if (errorCode === 'ENOENT' || errorMessage.includes('ENOENT')) {
          errorMessage = `Command not found: '${command[0]}'. Please ensure the command exists and is in your PATH.`;
        } else if (errorCode === 'EACCES' || errorMessage.includes('EACCES')) {
          errorMessage = `Permission denied: '${command[0]}'. The command exists but is not executable.`;
        } else if (errorCode === 'ENXIO' || errorMessage.includes('ENXIO')) {
          errorMessage = `Failed to allocate terminal for '${command[0]}'. This may occur if the command doesn't exist or the system cannot create a pseudo-terminal.`;
        } else if (errorMessage.includes('cwd') || errorMessage.includes('working directory')) {
          errorMessage = `Working directory does not exist: '${workingDir}'`;
        }

        // Log the error with better serialization
        const errorDetails =
          spawnError instanceof Error
            ? {
                ...spawnError,
                message: spawnError.message,
                stack: spawnError.stack,
                code: (spawnError as NodeJS.ErrnoException).code,
              }
            : spawnError;
        logger.error(`Failed to spawn PTY for command '${command.join(' ')}':`, errorDetails);
        throw new PtyError(errorMessage, 'SPAWN_FAILED');
      }

      // Create session object
      // Auto-detect Claude commands and set dynamic mode if no title mode specified
      let titleMode = options.titleMode;
      if (!titleMode) {
        // Check all command arguments for Claude
        const isClaudeCommand = command.some((arg) => arg.toLowerCase().includes('claude'));
        if (isClaudeCommand) {
          titleMode = TitleMode.DYNAMIC;
          logger.log(chalk.cyan('✓ Auto-selected dynamic title mode for Claude'));
          logger.debug(`Detected Claude in command: ${command.join(' ')}`);
        }
      }

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
        titleMode: titleMode || TitleMode.NONE,
        isExternalTerminal: !!options.forwardToStdout,
        currentWorkingDir: workingDir,
        titleFilter: new TitleSequenceFilter(),
      };

      this.sessions.set(sessionId, session);

      // Update session info with PID and running status
      sessionInfo.pid = ptyProcess.pid;
      sessionInfo.status = 'running';
      this.sessionManager.saveSessionInfo(sessionId, sessionInfo);

      // Setup session.json watcher for external sessions
      if (options.forwardToStdout) {
        this.setupSessionWatcher(session);
      }

      logger.debug(
        chalk.green(`Session ${sessionId} created successfully (PID: ${ptyProcess.pid})`)
      );
      logger.log(chalk.gray(`Running: ${resolvedCommand.join(' ')} in ${workingDir}`));

      // Setup PTY event handlers
      this.setupPtyHandlers(session, options.forwardToStdout || false, options.onExit);

      // Note: stdin forwarding is now handled via IPC socket

      // Initial title will be set when the first output is received
      // Do not write title sequence to PTY input as it would be sent to the shell

      return {
        sessionId,
        sessionInfo,
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

    // Setup activity detector for dynamic mode
    if (session.titleMode === TitleMode.DYNAMIC) {
      session.activityDetector = new ActivityDetector(session.sessionInfo.command);
    }

    // Setup periodic title updates for both static and dynamic modes
    if (
      session.titleMode !== TitleMode.NONE &&
      session.titleMode !== TitleMode.FILTER &&
      forwardToStdout
    ) {
      // Track last known activity state for change detection
      let lastKnownActivityState: {
        isActive: boolean;
        specificStatus?: string;
      } | null = null;

      session.titleUpdateInterval = setInterval(() => {
        // For dynamic mode, check for activity state changes
        if (session.titleMode === TitleMode.DYNAMIC && session.activityDetector) {
          const activityState = session.activityDetector.getActivityState();

          // Check if activity state has changed
          const activityChanged =
            lastKnownActivityState === null ||
            activityState.isActive !== lastKnownActivityState.isActive ||
            activityState.specificStatus?.status !== lastKnownActivityState.specificStatus;

          if (activityChanged) {
            // Update last known state
            lastKnownActivityState = {
              isActive: activityState.isActive,
              specificStatus: activityState.specificStatus?.status,
            };

            // Mark title for update
            this.markTitleUpdateNeeded(session);

            logger.debug(
              `Activity state changed for session ${session.id}: ` +
                `active=${activityState.isActive}, ` +
                `status=${activityState.specificStatus?.status || 'none'}`
            );
          }

          // Always write activity state for external tools
          this.writeActivityState(session, activityState);
        }

        // Check and update title if needed
        this.checkAndUpdateTitle(session);
      }, TITLE_UPDATE_INTERVAL_MS);
    }

    // Handle PTY data output
    ptyProcess.onData((data: string) => {
      let processedData = data;

      // If title mode is not NONE, filter out any title sequences the process might
      // have written to the stream.
      if (session.titleMode !== undefined && session.titleMode !== TitleMode.NONE) {
        processedData = session.titleFilter ? session.titleFilter.filter(data) : data;
      }

      // Handle activity detection for dynamic mode
      if (session.titleMode === TitleMode.DYNAMIC && session.activityDetector) {
        const { filteredData, activity } = session.activityDetector.processOutput(processedData);
        processedData = filteredData;

        // Check if activity status changed
        if (activity.specificStatus?.status !== session.lastActivityStatus) {
          session.lastActivityStatus = activity.specificStatus?.status;
          this.markTitleUpdateNeeded(session);
        }
      }

      // Check for title update triggers
      if (session.titleMode === TitleMode.STATIC && forwardToStdout) {
        // Check if we should update title based on data content
        if (!session.initialTitleSent || shouldInjectTitle(processedData)) {
          this.markTitleUpdateNeeded(session);
          if (!session.initialTitleSent) {
            session.initialTitleSent = true;
          }
        }
      }

      // Write to asciinema file (it has its own internal queue)
      asciinemaWriter?.writeOutput(Buffer.from(processedData, 'utf8'));

      // Forward to stdout if requested (using queue for ordering)
      if (forwardToStdout && stdoutQueue) {
        stdoutQueue.enqueue(async () => {
          const canWrite = process.stdout.write(processedData);

          // Track write activity for safe title injection
          session.lastWriteTimestamp = Date.now();

          if (!canWrite) {
            await once(process.stdout, 'drain');
          }
        });
      }
    });

    // Handle PTY exit
    ptyProcess.onExit(async ({ exitCode, signal }: { exitCode: number; signal?: number }) => {
      try {
        // Mark session as exiting to prevent false bell notifications
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

        // Wait for stdout queue to drain if it exists
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

        // Clean up bell tracking
        this.lastBellTime.delete(session.id);
        this.sessionExitTimes.delete(session.id);

        // Emit session exited event
        this.emit('sessionExited', session.id);

        // Call exit callback if provided (for fwd.ts)
        if (onExit) {
          onExit(exitCode || 0, signal);
        }
      } catch (error) {
        logger.error(`Failed to handle exit for session ${session.id}:`, error);
      }
    });

    // Mark for initial title update
    if (
      forwardToStdout &&
      (session.titleMode === TitleMode.STATIC || session.titleMode === TitleMode.DYNAMIC)
    ) {
      this.markTitleUpdateNeeded(session);
      session.initialTitleSent = true;
      logger.debug(`Marked initial title update for session ${session.id}`);
    }

    // Setup IPC socket for all communication
    this.setupIPCSocket(session);
  }

  /**
   * Setup Unix socket for all IPC communication
   */
  private setupIPCSocket(session: PtySession): void {
    const ptyProcess = session.ptyProcess;
    if (!ptyProcess) {
      logger.error(`No PTY process found for session ${session.id}`);
      return;
    }

    // Create Unix domain socket for all IPC
    // IMPORTANT: macOS has a 104 character limit for Unix socket paths, including null terminator.
    // This means the actual usable path length is 103 characters. To avoid EINVAL errors:
    // - Use short socket names (e.g., 'ipc.sock' instead of 'vibetunnel-ipc.sock')
    // - Keep session directories as short as possible
    // - Avoid deeply nested directory structures
    const socketPath = path.join(session.controlDir, 'ipc.sock');

    // Verify the socket path isn't too long
    if (socketPath.length > 103) {
      const error = new Error(`Socket path too long: ${socketPath.length} characters`);
      logger.error(`Socket path too long (${socketPath.length} chars): ${socketPath}`);
      logger.error(
        `macOS limit is 103 characters. Consider using shorter session IDs or control paths.`
      );
      throw error; // Fail fast instead of returning silently
    }

    try {
      // Remove existing socket if it exists
      try {
        fs.unlinkSync(socketPath);
      } catch (_e) {
        // Socket doesn't exist, this is expected
      }

      // Initialize connected clients set if not already present
      if (!session.connectedClients) {
        session.connectedClients = new Set<net.Socket>();
      }

      // Create Unix domain socket server with framed message protocol
      const inputServer = net.createServer((client) => {
        const parser = new MessageParser();
        client.setNoDelay(true);

        // Add client to connected clients set
        session.connectedClients?.add(client);
        logger.debug(
          `Client connected to session ${session.id}, total clients: ${session.connectedClients?.size}`
        );

        client.on('data', (chunk) => {
          parser.addData(chunk);

          for (const { type, payload } of parser.parseMessages()) {
            this.handleSocketMessage(session, type, payload);
          }
        });

        client.on('error', (err) => {
          logger.debug(`Client socket error for session ${session.id}:`, err);
        });

        client.on('close', () => {
          // Remove client from connected clients set
          session.connectedClients?.delete(client);
          logger.debug(
            `Client disconnected from session ${session.id}, remaining clients: ${session.connectedClients?.size}`
          );
        });
      });

      inputServer.listen(socketPath, () => {
        // Make socket writable by all
        try {
          fs.chmodSync(socketPath, 0o666);
        } catch (e) {
          logger.debug(`Failed to chmod input socket for session ${session.id}:`, e);
        }
        logger.debug(`Input socket created for session ${session.id}`);
      });

      // Store server reference for cleanup
      session.inputSocketServer = inputServer;
    } catch (error) {
      logger.error(`Failed to create input socket for session ${session.id}:`, error);
    }

    // All IPC goes through this socket
  }

  /**
   * Setup file watcher for session.json changes
   */
  private setupSessionWatcher(session: PtySession): void {
    const _sessionJsonPath = path.join(session.controlDir, 'session.json');

    try {
      // Use polling approach for better reliability on macOS
      // Check for changes every 100ms
      const checkInterval = setInterval(() => {
        try {
          // Read the current session info from disk
          const updatedInfo = this.sessionManager.loadSessionInfo(session.id);
          if (updatedInfo && updatedInfo.name !== session.sessionInfo.name) {
            // Name has changed, update our internal state
            const oldName = session.sessionInfo.name;
            session.sessionInfo.name = updatedInfo.name;

            logger.debug(
              `Session ${session.id} name changed from "${oldName}" to "${updatedInfo.name}"`
            );

            // Emit event for name change
            this.trackAndEmit('sessionNameChanged', session.id, updatedInfo.name);

            // Update title if needed for external terminals
            if (
              session.isExternalTerminal &&
              (session.titleMode === TitleMode.STATIC || session.titleMode === TitleMode.DYNAMIC)
            ) {
              this.markTitleUpdateNeeded(session);
            }
          }
        } catch (error) {
          // Session file might be deleted, ignore
          logger.debug(`Failed to read session file for ${session.id}:`, error);
        }
      }, 100);

      // Store interval for cleanup
      session.sessionJsonInterval = checkInterval;
      logger.debug(`Session watcher setup for ${session.id}`);
    } catch (error) {
      logger.error(`Failed to setup session watcher for ${session.id}:`, error);
    }
  }

  /**
   * Handle incoming socket messages
   */
  private handleSocketMessage(session: PtySession, type: MessageType, payload: Buffer): void {
    try {
      const data = parsePayload(type, payload);

      switch (type) {
        case MessageType.STDIN_DATA: {
          const text = data as string;
          if (session.ptyProcess && session.inputQueue) {
            // Queue input write to prevent race conditions
            session.inputQueue.enqueue(() => {
              if (session.ptyProcess) {
                session.ptyProcess.write(text);
              }
              // Record it (non-blocking)
              session.asciinemaWriter?.writeInput(text);
            });
          }
          break;
        }

        case MessageType.CONTROL_CMD: {
          const cmd = data as ControlCommand;
          this.handleControlMessage(session, cmd);
          break;
        }

        case MessageType.STATUS_UPDATE: {
          const status = data as { app: string; status: string };
          // Update activity status for the session
          if (!session.activityStatus) {
            session.activityStatus = {};
          }
          session.activityStatus.specificStatus = {
            app: status.app,
            status: status.status,
          };
          logger.debug(`Updated status for session ${session.id}:`, status);

          // Broadcast status update to all connected clients
          if (session.connectedClients && session.connectedClients.size > 0) {
            const message = frameMessage(MessageType.STATUS_UPDATE, status);
            for (const client of session.connectedClients) {
              try {
                client.write(message);
              } catch (err) {
                logger.debug(`Failed to broadcast status to client:`, err);
              }
            }
            logger.debug(`Broadcasted status update to ${session.connectedClients.size} clients`);
          }
          break;
        }

        case MessageType.HEARTBEAT:
          // Heartbeat received - no action needed for now
          break;

        default:
          logger.debug(`Unknown message type ${type} for session ${session.id}`);
      }
    } catch (error) {
      logger.error(`Failed to handle socket message for session ${session.id}:`, error);
    }
  }

  /**
   * Handle control messages from control pipe
   */
  private handleControlMessage(session: PtySession, message: Record<string, unknown>): void {
    if (
      message.cmd === 'resize' &&
      typeof message.cols === 'number' &&
      typeof message.rows === 'number'
    ) {
      try {
        if (session.ptyProcess) {
          session.ptyProcess.resize(message.cols, message.rows);
          session.asciinemaWriter?.writeResize(message.cols, message.rows);
        }
      } catch (error) {
        logger.warn(
          `Failed to resize session ${session.id} to ${message.cols}x${message.rows}:`,
          error
        );
      }
    } else if (message.cmd === 'kill') {
      const signal =
        typeof message.signal === 'string' || typeof message.signal === 'number'
          ? message.signal
          : 'SIGTERM';
      try {
        if (session.ptyProcess) {
          session.ptyProcess.kill(signal as string);
        }
      } catch (error) {
        logger.warn(`Failed to kill session ${session.id} with signal ${signal}:`, error);
      }
    } else if (message.cmd === 'reset-size') {
      try {
        if (session.ptyProcess) {
          // Get current terminal size from process.stdout
          const cols = process.stdout.columns || 80;
          const rows = process.stdout.rows || 24;
          session.ptyProcess.resize(cols, rows);
          session.asciinemaWriter?.writeResize(cols, rows);
          logger.debug(`Reset session ${session.id} size to terminal size: ${cols}x${rows}`);
        }
      } catch (error) {
        logger.warn(`Failed to reset session ${session.id} size to terminal size:`, error);
      }
    } else if (message.cmd === 'update-title' && typeof message.title === 'string') {
      // Handle title update via IPC (used by vt title command)
      logger.debug(`[IPC] Received title update for session ${session.id}: "${message.title}"`);
      logger.debug(`[IPC] Current session name before update: "${session.sessionInfo.name}"`);
      this.updateSessionName(session.id, message.title);
    }
  }

  /**
   * Send text input to a session
   */
  sendInput(sessionId: string, input: SessionInput): void {
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
      const memorySession = this.sessions.get(sessionId);
      if (memorySession?.ptyProcess && memorySession.inputQueue) {
        // Queue input write to prevent race conditions
        memorySession.inputQueue.enqueue(() => {
          if (memorySession.ptyProcess) {
            memorySession.ptyProcess.write(dataToSend);
          }
          memorySession.asciinemaWriter?.writeInput(dataToSend);

          // Track directory changes for title modes that need it
          if (
            (memorySession.titleMode === TitleMode.STATIC ||
              memorySession.titleMode === TitleMode.DYNAMIC) &&
            input.text
          ) {
            const newDir = extractCdDirectory(
              input.text,
              memorySession.currentWorkingDir || memorySession.sessionInfo.workingDir
            );
            if (newDir) {
              memorySession.currentWorkingDir = newDir;
              this.markTitleUpdateNeeded(memorySession);
              logger.debug(`Session ${sessionId} changed directory to: ${newDir}`);
            }
          }
        });

        return; // Important: return here to avoid socket path
      } else {
        const sessionPaths = this.sessionManager.getSessionPaths(sessionId);
        if (!sessionPaths) {
          throw new PtyError(
            `Session ${sessionId} paths not found`,
            'SESSION_PATHS_NOT_FOUND',
            sessionId
          );
        }

        // For forwarded sessions, we need to use socket communication
        const socketPath = path.join(sessionPaths.controlDir, 'ipc.sock');

        // Check if we have a cached socket connection
        let socketClient = this.inputSocketClients.get(sessionId);

        if (!socketClient || socketClient.destroyed) {
          // Try to connect to the socket
          try {
            socketClient = net.createConnection(socketPath);
            socketClient.setNoDelay(true);
            // Keep socket alive for better performance
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
          // Send stdin data using framed message protocol
          const message = frameMessage(MessageType.STDIN_DATA, dataToSend);
          const canWrite = socketClient.write(message);
          if (!canWrite) {
            // Socket buffer is full
            logger.debug(`Socket buffer full for session ${sessionId}, data queued`);
          }
        } else {
          throw new PtyError(
            `No socket connection available for session ${sessionId}`,
            'NO_SOCKET_CONNECTION',
            sessionId
          );
        }
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
   * Send a control message to an external session via socket
   */
  private sendControlMessage(
    sessionId: string,
    message: ResizeControlMessage | KillControlMessage | ResetSizeControlMessage
  ): boolean {
    const sessionPaths = this.sessionManager.getSessionPaths(sessionId);
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
  private convertSpecialKey(key: SpecialKey): string {
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
   * Resize a session terminal
   */
  resizeSession(sessionId: string, cols: number, rows: number): void {
    const memorySession = this.sessions.get(sessionId);
    const currentTime = Date.now();

    try {
      // If we have an in-memory session with active PTY, resize it
      if (memorySession?.ptyProcess) {
        memorySession.ptyProcess.resize(cols, rows);
        memorySession.asciinemaWriter?.writeResize(cols, rows);

        // Track this browser-initiated resize
        this.sessionResizeSources.set(sessionId, {
          cols,
          rows,
          source: 'browser',
          timestamp: currentTime,
        });

        logger.debug(`Resized session ${sessionId} to ${cols}x${rows} from browser`);
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
   * Update session name
   */
  updateSessionName(sessionId: string, name: string): string {
    logger.debug(
      `[PtyManager] updateSessionName called for session ${sessionId} with name: ${name}`
    );

    // Update in session manager (persisted storage) - get the unique name back
    logger.debug(`[PtyManager] Calling sessionManager.updateSessionName`);
    const uniqueName = this.sessionManager.updateSessionName(sessionId, name);

    // Update in-memory session if it exists
    const memorySession = this.sessions.get(sessionId);
    if (memorySession?.sessionInfo) {
      logger.debug(`[PtyManager] Found in-memory session, updating...`);
      const oldName = memorySession.sessionInfo.name;
      memorySession.sessionInfo.name = uniqueName;

      logger.debug(`[PtyManager] Session info after update:`, {
        sessionId: memorySession.id,
        newName: memorySession.sessionInfo.name,
        oldCurrentTitle: `${memorySession.currentTitle?.substring(0, 50)}...`,
      });

      // Force immediate title update for active sessions
      // For session name changes, always update title regardless of mode
      if (memorySession.isExternalTerminal && memorySession.stdoutQueue) {
        logger.debug(`[PtyManager] Forcing immediate title update for session ${sessionId}`, {
          titleMode: memorySession.titleMode,
          hadCurrentTitle: !!memorySession.currentTitle,
          titleUpdateNeeded: memorySession.titleUpdateNeeded,
        });
        // Clear current title to force regeneration
        memorySession.currentTitle = undefined;
        this.updateTerminalTitleForSessionName(memorySession);
      }

      logger.log(
        `[PtyManager] Updated session ${sessionId} name from "${oldName}" to "${uniqueName}"`
      );
    } else {
      logger.debug(`[PtyManager] No in-memory session found for ${sessionId}`, {
        sessionsMapSize: this.sessions.size,
        sessionIds: Array.from(this.sessions.keys()),
      });
    }

    // Emit event for clients to refresh their session data
    this.trackAndEmit('sessionNameChanged', sessionId, uniqueName);

    logger.debug(`[PtyManager] Updated session ${sessionId} name to: ${uniqueName}`);

    return uniqueName;
  }

  /**
   * Reset session size to terminal size (for external terminals)
   */
  resetSessionSize(sessionId: string): void {
    const memorySession = this.sessions.get(sessionId);

    try {
      // For in-memory sessions, we can't reset to terminal size since we don't know it
      if (memorySession?.ptyProcess) {
        throw new PtyError(
          `Cannot reset size for in-memory session ${sessionId}`,
          'INVALID_OPERATION',
          sessionId
        );
      }

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
   * Kill a session with proper SIGTERM -> SIGKILL escalation
   * Returns a promise that resolves when the process is actually terminated
   */
  async killSession(sessionId: string, signal: string | number = 'SIGTERM'): Promise<void> {
    const memorySession = this.sessions.get(sessionId);

    try {
      // If we have an in-memory session with active PTY, kill it directly
      if (memorySession?.ptyProcess) {
        // If signal is already SIGKILL, send it immediately and wait briefly
        if (signal === 'SIGKILL' || signal === 9) {
          const pid = memorySession.ptyProcess.pid;
          memorySession.ptyProcess.kill('SIGKILL');

          // Also kill the entire process group if on Unix
          if (process.platform !== 'win32' && pid) {
            try {
              process.kill(-pid, 'SIGKILL');
              logger.debug(`Sent SIGKILL to process group -${pid} for session ${sessionId}`);
            } catch (groupKillError) {
              logger.debug(
                `Failed to SIGKILL process group for session ${sessionId}:`,
                groupKillError
              );
            }
          }

          this.sessions.delete(sessionId);
          // Wait a bit for SIGKILL to take effect
          await new Promise((resolve) => setTimeout(resolve, 100));
          return;
        }

        // Start with SIGTERM and escalate if needed
        await this.killSessionWithEscalation(sessionId, memorySession);
      } else {
        // For external sessions, try control pipe first, then fall back to PID
        const killMessage: KillControlMessage = {
          cmd: 'kill',
          signal,
        };

        const sentControl = this.sendControlMessage(sessionId, killMessage);
        if (sentControl) {
          // Wait a bit for the control message to be processed
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        // Check if process is still running, if so, use direct PID kill
        const diskSession = this.sessionManager.loadSessionInfo(sessionId);
        if (!diskSession) {
          throw new PtyError(`Session ${sessionId} not found`, 'SESSION_NOT_FOUND', sessionId);
        }

        if (diskSession.pid && ProcessUtils.isProcessRunning(diskSession.pid)) {
          logger.log(
            chalk.yellow(`Killing external session ${sessionId} (PID: ${diskSession.pid})`)
          );

          if (signal === 'SIGKILL' || signal === 9) {
            process.kill(diskSession.pid, 'SIGKILL');

            // Also kill the entire process group if on Unix
            if (process.platform !== 'win32') {
              try {
                process.kill(-diskSession.pid, 'SIGKILL');
                logger.debug(
                  `Sent SIGKILL to process group -${diskSession.pid} for external session ${sessionId}`
                );
              } catch (groupKillError) {
                logger.debug(
                  `Failed to SIGKILL process group for external session ${sessionId}:`,
                  groupKillError
                );
              }
            }

            await new Promise((resolve) => setTimeout(resolve, 100));
            return;
          }

          // Send SIGTERM first
          process.kill(diskSession.pid, 'SIGTERM');

          // Also try to kill the entire process group if on Unix
          if (process.platform !== 'win32') {
            try {
              // Kill the process group by using negative PID
              process.kill(-diskSession.pid, 'SIGTERM');
              logger.debug(
                `Sent SIGTERM to process group -${diskSession.pid} for external session ${sessionId}`
              );
            } catch (groupKillError) {
              // Process group might not exist or we might not have permission
              logger.debug(
                `Failed to kill process group for external session ${sessionId}:`,
                groupKillError
              );
            }
          }

          // Wait up to 3 seconds for graceful termination
          const maxWaitTime = 3000;
          const checkInterval = 500;
          const maxChecks = maxWaitTime / checkInterval;

          for (let i = 0; i < maxChecks; i++) {
            await new Promise((resolve) => setTimeout(resolve, checkInterval));

            if (!ProcessUtils.isProcessRunning(diskSession.pid)) {
              logger.debug(chalk.green(`External session ${sessionId} terminated gracefully`));
              return;
            }
          }

          // Process didn't terminate gracefully, force kill
          logger.debug(chalk.yellow(`External session ${sessionId} requires SIGKILL`));
          process.kill(diskSession.pid, 'SIGKILL');

          // Also force kill the entire process group if on Unix
          if (process.platform !== 'win32') {
            try {
              // Kill the process group with SIGKILL
              process.kill(-diskSession.pid, 'SIGKILL');
              logger.debug(
                `Sent SIGKILL to process group -${diskSession.pid} for external session ${sessionId}`
              );
            } catch (groupKillError) {
              logger.debug(
                `Failed to SIGKILL process group for external session ${sessionId}:`,
                groupKillError
              );
            }
          }

          await new Promise((resolve) => setTimeout(resolve, 100));
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
   * Kill session with SIGTERM -> SIGKILL escalation (3 seconds, check every 500ms)
   */
  private async killSessionWithEscalation(sessionId: string, session: PtySession): Promise<void> {
    if (!session.ptyProcess) {
      this.sessions.delete(sessionId);
      return;
    }

    const pid = session.ptyProcess.pid;
    logger.debug(chalk.yellow(`Terminating session ${sessionId} (PID: ${pid})`));

    try {
      // Send SIGTERM first
      session.ptyProcess.kill('SIGTERM');

      // Also try to kill the entire process group if on Unix
      if (process.platform !== 'win32' && pid) {
        try {
          // Kill the process group by using negative PID
          process.kill(-pid, 'SIGTERM');
          logger.debug(`Sent SIGTERM to process group -${pid} for session ${sessionId}`);
        } catch (groupKillError) {
          // Process group might not exist or we might not have permission
          logger.debug(`Failed to kill process group for session ${sessionId}:`, groupKillError);
        }
      }

      // Wait up to 3 seconds for graceful termination (check every 500ms)
      const maxWaitTime = 3000;
      const checkInterval = 500;
      const maxChecks = maxWaitTime / checkInterval;

      for (let i = 0; i < maxChecks; i++) {
        // Wait for check interval
        await new Promise((resolve) => setTimeout(resolve, checkInterval));

        // Check if process is still alive
        if (!ProcessUtils.isProcessRunning(pid)) {
          // Process no longer exists - it terminated gracefully
          logger.debug(chalk.green(`Session ${sessionId} terminated gracefully`));
          this.sessions.delete(sessionId);
          return;
        }

        // Process still exists, continue waiting
        logger.debug(`Session ${sessionId} still running after ${(i + 1) * checkInterval}ms`);
      }

      // Process didn't terminate gracefully within 3 seconds, force kill
      logger.debug(chalk.yellow(`Session ${sessionId} requires SIGKILL`));
      try {
        session.ptyProcess.kill('SIGKILL');

        // Also force kill the entire process group if on Unix
        if (process.platform !== 'win32' && pid) {
          try {
            // Kill the process group with SIGKILL
            process.kill(-pid, 'SIGKILL');
            logger.debug(`Sent SIGKILL to process group -${pid} for session ${sessionId}`);
          } catch (groupKillError) {
            logger.debug(
              `Failed to SIGKILL process group for session ${sessionId}:`,
              groupKillError
            );
          }
        }

        // Wait a bit more for SIGKILL to take effect
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (_killError) {
        // Process might have died between our check and SIGKILL
        logger.debug(`SIGKILL failed for session ${sessionId} (process already terminated)`);
      }

      // Remove from sessions regardless
      this.sessions.delete(sessionId);
      logger.debug(chalk.yellow(`Session ${sessionId} forcefully terminated`));
    } catch (error) {
      // Remove from sessions even if kill failed
      this.sessions.delete(sessionId);
      throw new PtyError(
        `Failed to terminate session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
        'KILL_FAILED',
        sessionId
      );
    }
  }

  /**
   * List all sessions (both active and persisted)
   */
  listSessions() {
    // Update zombie sessions first and clean up socket connections
    const zombieSessionIds = this.sessionManager.updateZombieSessions();
    for (const sessionId of zombieSessionIds) {
      const socket = this.inputSocketClients.get(sessionId);
      if (socket) {
        socket.destroy();
        this.inputSocketClients.delete(sessionId);
      }
    }

    // Get all sessions from storage
    const sessions = this.sessionManager.listSessions();

    // Enhance with activity information
    return sessions.map((session) => {
      // First try to get activity from active session
      const activeSession = this.sessions.get(session.id);

      // Check for socket-based status updates first
      if (activeSession?.activityStatus) {
        return {
          ...session,
          activityStatus: activeSession.activityStatus,
        };
      }

      // Then check activity detector for dynamic mode
      if (activeSession?.activityDetector) {
        const activityState = activeSession.activityDetector.getActivityState();
        return {
          ...session,
          activityStatus: {
            isActive: activityState.isActive,
            specificStatus: activityState.specificStatus,
          },
        };
      }

      // Otherwise, try to read from activity file (for external sessions)
      try {
        const sessionPaths = this.sessionManager.getSessionPaths(session.id);
        if (!sessionPaths) {
          return session;
        }

        const activityPath = path.join(sessionPaths.controlDir, 'claude-activity.json');

        if (fs.existsSync(activityPath)) {
          const activityData = JSON.parse(fs.readFileSync(activityPath, 'utf-8'));
          // Check if activity is recent (within last 60 seconds)
          // Use Math.abs to handle future timestamps from system clock issues
          const timeDiff = Math.abs(Date.now() - new Date(activityData.timestamp).getTime());
          const isRecent = timeDiff < 60000;

          if (isRecent) {
            logger.debug(`Found recent activity for external session ${session.id}:`, {
              isActive: activityData.isActive,
              specificStatus: activityData.specificStatus,
            });
            return {
              ...session,
              activityStatus: {
                isActive: activityData.isActive,
                specificStatus: activityData.specificStatus,
              },
            };
          } else {
            logger.debug(
              `Activity file for session ${session.id} is stale (time diff: ${timeDiff}ms)`
            );
          }
        } else {
          // Only log once per session to avoid spam
          if (!this.activityFileWarningsLogged.has(session.id)) {
            this.activityFileWarningsLogged.add(session.id);
            logger.debug(
              `No claude-activity.json found for session ${session.id} at ${activityPath}`
            );
          }
        }
      } catch (error) {
        // Ignore errors reading activity file
        logger.debug(`Failed to read activity file for session ${session.id}:`, error);
      }

      return session;
    });
  }

  /**
   * Get a specific session
   */
  getSession(sessionId: string): Session | null {
    logger.debug(`[PtyManager] getSession called for sessionId: ${sessionId}`);

    const paths = this.sessionManager.getSessionPaths(sessionId, true);
    if (!paths) {
      logger.debug(`[PtyManager] No session paths found for ${sessionId}`);
      return null;
    }

    const sessionInfo = this.sessionManager.loadSessionInfo(sessionId);
    if (!sessionInfo) {
      logger.debug(`[PtyManager] No session info found for ${sessionId}`);
      return null;
    }

    // Create Session object with the id field
    const session: Session = {
      ...sessionInfo,
      id: sessionId, // Ensure the id field is set
      lastModified: sessionInfo.startedAt,
    };

    if (fs.existsSync(paths.stdoutPath)) {
      const lastModified = fs.statSync(paths.stdoutPath).mtime.toISOString();
      session.lastModified = lastModified;
    }

    logger.debug(`[PtyManager] Found session: ${JSON.stringify(session)}`);
    return session;
  }

  getSessionPaths(sessionId: string) {
    return this.sessionManager.getSessionPaths(sessionId);
  }

  /**
   * Cleanup a specific session
   */
  cleanupSession(sessionId: string): void {
    // Kill active session if exists (fire-and-forget for cleanup)
    if (this.sessions.has(sessionId)) {
      this.killSession(sessionId).catch((error) => {
        logger.error(`Failed to kill session ${sessionId} during cleanup:`, error);
      });
    }

    // Remove from storage
    this.sessionManager.cleanupSession(sessionId);

    // Clean up socket connection if any
    const socket = this.inputSocketClients.get(sessionId);
    if (socket) {
      socket.destroy();
      this.inputSocketClients.delete(sessionId);
    }
  }

  /**
   * Cleanup all exited sessions
   */
  cleanupExitedSessions(): string[] {
    return this.sessionManager.cleanupExitedSessions();
  }

  /**
   * Create environment variables for sessions
   */
  private createEnvVars(term: string): Record<string, string> {
    const envVars: Record<string, string> = {
      TERM: term,
    };

    // Include other important terminal-related environment variables if they exist
    const importantVars = ['SHELL', 'LANG', 'LC_ALL', 'PATH', 'USER', 'HOME'];
    for (const varName of importantVars) {
      const value = process.env[varName];
      if (value) {
        envVars[varName] = value;
      }
    }

    return envVars;
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
   * Capture process information for bell source identification
   */
  private async captureProcessInfoForBell(session: PtySession, bellCount: number): Promise<void> {
    try {
      const sessionPid = session.ptyProcess?.pid;
      if (!sessionPid) {
        logger.warn(`Cannot capture process info for session ${session.id}: no PID available`);
        // Emit basic bell event without process info
        this.emit('bell', {
          sessionInfo: session.sessionInfo,
          timestamp: new Date(),
          bellCount,
        });
        return;
      }

      logger.log(
        `Capturing process snapshot for bell in session ${session.id} (PID: ${sessionPid})`
      );

      // Capture process information asynchronously
      const processSnapshot = await this.processTreeAnalyzer.captureProcessSnapshot(sessionPid);

      // Emit enhanced bell event with process information
      this.emit('bell', {
        sessionInfo: session.sessionInfo,
        timestamp: new Date(),
        bellCount,
        processSnapshot,
        suspectedSource: processSnapshot.suspectedBellSource,
      });

      logger.log(
        `Bell event emitted for session ${session.id} with suspected source: ${
          processSnapshot.suspectedBellSource?.command || 'unknown'
        } (PID: ${processSnapshot.suspectedBellSource?.pid || 'unknown'})`
      );
    } catch (error) {
      logger.warn(`Failed to capture process info for bell in session ${session.id}:`, error);

      // Fallback: emit basic bell event without process info
      this.emit('bell', {
        sessionInfo: session.sessionInfo,
        timestamp: new Date(),
        bellCount,
      });
    }
  }

  /**
   * Shutdown all active sessions and clean up resources
   */
  async shutdown(): Promise<void> {
    for (const [sessionId, session] of Array.from(this.sessions.entries())) {
      try {
        if (session.ptyProcess) {
          const pid = session.ptyProcess.pid;
          session.ptyProcess.kill();

          // Also kill the entire process group if on Unix
          if (process.platform !== 'win32' && pid) {
            try {
              process.kill(-pid, 'SIGTERM');
              logger.debug(`Sent SIGTERM to process group -${pid} during shutdown`);
            } catch (groupKillError) {
              // Process group might not exist
              logger.debug(`Failed to kill process group during shutdown:`, groupKillError);
            }
          }
        }
        if (session.asciinemaWriter?.isOpen()) {
          await session.asciinemaWriter.close();
        }
        // Clean up all session resources
        this.cleanupSessionResources(session);
      } catch (error) {
        logger.error(`Failed to cleanup session ${sessionId} during shutdown:`, error);
      }
    }

    this.sessions.clear();

    // Clean up all socket clients
    for (const [_sessionId, socket] of this.inputSocketClients.entries()) {
      try {
        socket.destroy();
      } catch (_e) {
        // Socket already destroyed
      }
    }
    this.inputSocketClients.clear();

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
   * Setup stdin forwarding for fwd mode
   */
  private setupStdinForwarding(session: PtySession): void {
    if (!session.ptyProcess) return;

    // IMPORTANT: stdin forwarding is now handled via IPC socket in fwd.ts
    // This method is kept for backward compatibility but should not be used
    // as it would cause stdin duplication if multiple sessions are created
    logger.warn(
      `setupStdinForwarding called for session ${session.id} - stdin should be handled via IPC socket`
    );
  }

  /**
   * Write activity state only if it has changed
   */
  private writeActivityState(session: PtySession, activityState: ActivityState): void {
    const activityPath = path.join(session.controlDir, 'claude-activity.json');
    const activityData = {
      isActive: activityState.isActive,
      specificStatus: activityState.specificStatus,
      timestamp: new Date().toISOString(),
    };

    const stateJson = JSON.stringify(activityData);
    const lastState = this.lastWrittenActivityState.get(session.id);

    if (lastState !== stateJson) {
      try {
        fs.writeFileSync(activityPath, JSON.stringify(activityData, null, 2));
        this.lastWrittenActivityState.set(session.id, stateJson);

        // Debug log first write
        if (!session.activityFileWritten) {
          session.activityFileWritten = true;
          logger.debug(`Writing activity state to ${activityPath} for session ${session.id}`, {
            activityState,
            timestamp: activityData.timestamp,
          });
        }
      } catch (error) {
        logger.error(`Failed to write activity state for session ${session.id}:`, error);
      }
    }
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
    listeners.forEach((listener) => sessionListeners.add(listener));
    this.emit(event, sessionId, ...args);
  }

  /**
   * Clean up all resources associated with a session
   */
  private cleanupSessionResources(session: PtySession): void {
    // Clean up resize tracking
    this.sessionResizeSources.delete(session.id);

    // Clean up title update interval for dynamic mode
    if (session.titleUpdateInterval) {
      clearInterval(session.titleUpdateInterval);
      session.titleUpdateInterval = undefined;
    }

    // Clean up activity detector
    if (session.activityDetector) {
      session.activityDetector.clearStatus();
      session.activityDetector = undefined;
    }

    // Clean up title filter
    if (session.titleFilter) {
      // No need to reset, just remove reference
      session.titleFilter = undefined;
    }

    // Clean up session.json watcher/interval
    if (session.sessionJsonWatcher) {
      session.sessionJsonWatcher.close();
      session.sessionJsonWatcher = undefined;
    }
    if (session.sessionJsonInterval) {
      clearInterval(session.sessionJsonInterval);
      session.sessionJsonInterval = undefined;
    }

    // Clean up connected socket clients
    if (session.connectedClients) {
      for (const client of session.connectedClients) {
        try {
          client.destroy();
        } catch (_e) {
          // Client already destroyed
        }
      }
      session.connectedClients.clear();
    }

    // Clean up input socket server
    if (session.inputSocketServer) {
      // Close the server and wait for it to close
      session.inputSocketServer.close();
      // Unref the server so it doesn't keep the process alive
      session.inputSocketServer.unref();
      try {
        fs.unlinkSync(path.join(session.controlDir, 'ipc.sock'));
      } catch (_e) {
        // Socket already removed
      }
    }

    // Note: stdin handling is done via IPC socket, no global listeners to clean up

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

    // Clean up activity state tracking
    this.lastWrittenActivityState.delete(session.id);

    // Clean up title injection timer
    if (session.titleInjectionTimer) {
      clearInterval(session.titleInjectionTimer);
      session.titleInjectionTimer = undefined;
    }
  }

  /**
   * Mark session for title update and trigger immediate check
   */
  private markTitleUpdateNeeded(session: PtySession): void {
    logger.debug(`[markTitleUpdateNeeded] Called for session ${session.id}`, {
      titleMode: session.titleMode,
      sessionName: session.sessionInfo.name,
      titleUpdateNeeded: session.titleUpdateNeeded,
    });

    if (!session.titleMode || session.titleMode === TitleMode.NONE) {
      logger.debug(`[markTitleUpdateNeeded] Skipping - title mode is NONE or undefined`);
      return;
    }

    session.titleUpdateNeeded = true;
    logger.debug(`[markTitleUpdateNeeded] Set titleUpdateNeeded=true, calling checkAndUpdateTitle`);
    this.checkAndUpdateTitle(session);
  }

  /**
   * Update terminal title specifically for session name changes
   * This bypasses title mode checks to ensure name changes are always reflected
   */
  private updateTerminalTitleForSessionName(session: PtySession): void {
    if (!session.stdoutQueue || !session.isExternalTerminal) {
      logger.debug(
        `[updateTerminalTitleForSessionName] Early return - no stdout queue or not external terminal`
      );
      return;
    }

    // For NONE mode, just use the session name
    // For other modes, regenerate the title with the new name
    let newTitle: string | null = null;

    if (
      !session.titleMode ||
      session.titleMode === TitleMode.NONE ||
      session.titleMode === TitleMode.FILTER
    ) {
      // In NONE or FILTER mode, use simple session name
      newTitle = generateTitleSequence(
        session.currentWorkingDir || session.sessionInfo.workingDir,
        session.sessionInfo.command,
        session.sessionInfo.name || 'VibeTunnel'
      );
    } else {
      // For STATIC and DYNAMIC modes, use the standard generation logic
      newTitle = this.generateTerminalTitle(session);
    }

    if (newTitle && newTitle !== session.currentTitle) {
      logger.debug(`[updateTerminalTitleForSessionName] Updating title for session name change`);
      session.pendingTitleToInject = newTitle;
      session.titleUpdateNeeded = true;

      // Start injection monitor if not already running
      if (!session.titleInjectionTimer) {
        this.startTitleInjectionMonitor(session);
      }
    }
  }

  /**
   * Check if title needs updating and write if changed
   */
  private checkAndUpdateTitle(session: PtySession): void {
    logger.debug(`[checkAndUpdateTitle] Called for session ${session.id}`, {
      titleUpdateNeeded: session.titleUpdateNeeded,
      hasStdoutQueue: !!session.stdoutQueue,
      isExternalTerminal: session.isExternalTerminal,
      sessionName: session.sessionInfo.name,
    });

    if (!session.titleUpdateNeeded || !session.stdoutQueue || !session.isExternalTerminal) {
      logger.debug(`[checkAndUpdateTitle] Early return - conditions not met`);
      return;
    }

    // Generate new title
    logger.debug(`[checkAndUpdateTitle] Generating new title...`);
    const newTitle = this.generateTerminalTitle(session);

    // Debug logging for title updates
    logger.debug(`[Title Update] Session ${session.id}:`, {
      sessionName: session.sessionInfo.name,
      newTitle: newTitle ? `${newTitle.substring(0, 50)}...` : null,
      currentTitle: session.currentTitle ? `${session.currentTitle.substring(0, 50)}...` : null,
      titleChanged: newTitle !== session.currentTitle,
    });

    // Only proceed if title changed
    if (newTitle && newTitle !== session.currentTitle) {
      logger.debug(`[checkAndUpdateTitle] Title changed, queueing for injection`);
      // Store pending title
      session.pendingTitleToInject = newTitle;

      // Start injection monitor if not already running
      if (!session.titleInjectionTimer) {
        logger.debug(`[checkAndUpdateTitle] Starting title injection monitor`);
        this.startTitleInjectionMonitor(session);
      }
    } else {
      logger.debug(`[checkAndUpdateTitle] Title unchanged or null, skipping injection`, {
        newTitleNull: !newTitle,
        titlesEqual: newTitle === session.currentTitle,
      });
    }

    // Clear flag
    session.titleUpdateNeeded = false;
  }

  /**
   * Monitor for quiet period to safely inject title
   */
  private startTitleInjectionMonitor(session: PtySession): void {
    // Run periodically to find quiet period
    session.titleInjectionTimer = setInterval(() => {
      if (!session.pendingTitleToInject || !session.stdoutQueue) {
        // No title to inject or session ended, stop monitor
        if (session.titleInjectionTimer) {
          clearInterval(session.titleInjectionTimer);
          session.titleInjectionTimer = undefined;
        }
        return;
      }

      const now = Date.now();
      const timeSinceLastWrite = now - (session.lastWriteTimestamp || 0);

      // Check for quiet period and not already injecting
      if (
        timeSinceLastWrite >= TITLE_INJECTION_QUIET_PERIOD_MS &&
        !session.titleInjectionInProgress
      ) {
        // Safe to inject title - capture the title before clearing it
        const titleToInject = session.pendingTitleToInject;
        if (!titleToInject) {
          return;
        }

        // Mark injection as in progress
        session.titleInjectionInProgress = true;

        // Update timestamp immediately to prevent quiet period violations
        session.lastWriteTimestamp = Date.now();

        session.stdoutQueue.enqueue(async () => {
          try {
            logger.debug(`[Title Injection] Writing title to stdout for session ${session.id}:`, {
              title: `${titleToInject.substring(0, 50)}...`,
            });

            const canWrite = process.stdout.write(titleToInject);

            if (!canWrite) {
              await once(process.stdout, 'drain');
            }

            // Update tracking after successful write
            session.currentTitle = titleToInject;

            logger.debug(`[Title Injection] Successfully injected title for session ${session.id}`);

            // Clear pending title only after successful write
            if (session.pendingTitleToInject === titleToInject) {
              session.pendingTitleToInject = undefined;
            }

            // If no more titles pending, stop monitor
            if (!session.pendingTitleToInject && session.titleInjectionTimer) {
              clearInterval(session.titleInjectionTimer);
              session.titleInjectionTimer = undefined;
            }
          } finally {
            // Always clear the in-progress flag
            session.titleInjectionInProgress = false;
          }
        });

        logger.debug(
          `Injected title during quiet period (${timeSinceLastWrite}ms) for session ${session.id}`
        );
      }
    }, TITLE_INJECTION_CHECK_INTERVAL_MS);
  }

  /**
   * Generate terminal title based on session mode and state
   */
  private generateTerminalTitle(session: PtySession): string | null {
    if (!session.titleMode || session.titleMode === TitleMode.NONE) {
      return null;
    }

    const currentDir = session.currentWorkingDir || session.sessionInfo.workingDir;

    logger.debug(`[generateTerminalTitle] Session ${session.id}:`, {
      titleMode: session.titleMode,
      sessionName: session.sessionInfo.name,
      sessionInfoObjectId: session.sessionInfo,
      currentDir,
      command: session.sessionInfo.command,
      activityDetectorExists: !!session.activityDetector,
    });

    if (session.titleMode === TitleMode.STATIC) {
      return generateTitleSequence(
        currentDir,
        session.sessionInfo.command,
        session.sessionInfo.name
      );
    } else if (session.titleMode === TitleMode.DYNAMIC && session.activityDetector) {
      const activity = session.activityDetector.getActivityState();
      logger.debug(`[generateTerminalTitle] Calling generateDynamicTitle with:`, {
        currentDir,
        command: session.sessionInfo.command,
        sessionName: session.sessionInfo.name,
        activity: activity,
      });
      return generateDynamicTitle(
        currentDir,
        session.sessionInfo.command,
        activity,
        session.sessionInfo.name
      );
    }

    return null;
  }
}
