/**
 * PtyManager - Core PTY management using node-pty
 *
 * This class handles PTY creation, process management, and I/O operations
 * using the node-pty library while maintaining compatibility with tty-fwd.
 */

import * as pty from '@homebridge/node-pty-prebuilt-multiarch';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';
import { EventEmitter } from 'events';
import {
  PtySession,
  SessionCreationResult,
  PtyError,
  ResizeControlMessage,
  KillControlMessage,
} from './types.js';
import { AsciinemaWriter } from './asciinema-writer.js';
import { SessionManager } from './session-manager.js';
import { ProcessUtils } from './process-utils.js';
import {
  Session,
  SessionCreateOptions,
  SessionInfo,
  SessionInput,
  SpecialKey,
} from '../../shared/types.js';
import { IPty } from '@homebridge/node-pty-prebuilt-multiarch';
import { createLogger } from '../utils/logger.js';
import chalk from 'chalk';

const logger = createLogger('pty-manager');

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
  private lastBellTime = new Map<string, number>(); // Track last bell time per session
  private sessionExitTimes = new Map<string, number>(); // Track session exit times to avoid false bells

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
    const cols = options.cols || 80;
    const rows = options.rows || 24;

    try {
      // Create session directory structure
      const paths = this.sessionManager.createSessionDirectory(sessionId);

      // Create initial session info
      const sessionInfo: SessionInfo = {
        id: sessionId,
        command: command,
        name: sessionName,
        workingDir: workingDir,
        status: 'starting',
        startedAt: new Date().toISOString(),
      };

      // Save initial session info
      this.sessionManager.saveSessionInfo(sessionId, sessionInfo);

      // Create asciinema writer
      const asciinemaWriter = AsciinemaWriter.create(
        paths.stdoutPath,
        cols,
        rows,
        command.join(' '),
        sessionName,
        this.createEnvVars(term)
      );

      // Create PTY process
      let ptyProcess;
      try {
        // Set up environment like Linux implementation
        const ptyEnv = {
          ...process.env,
          TERM: term,
        };

        // Resolve command to handle aliases and shell builtins
        const resolved = ProcessUtils.resolveCommand(command);

        if (resolved.useShell) {
          logger.debug(`Using shell to execute command: ${command.join(' ')}`);
        }

        ptyProcess = pty.spawn(resolved.command, resolved.args, {
          name: term,
          cols,
          rows,
          cwd: workingDir,
          env: ptyEnv,
        });
      } catch (spawnError) {
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

        logger.error(`Failed to spawn PTY for command '${command.join(' ')}':`, spawnError);
        throw new PtyError(errorMessage, 'SPAWN_FAILED');
      }

      // Create session object
      const session: PtySession = {
        id: sessionId,
        sessionInfo,
        ptyProcess,
        asciinemaWriter,
        controlDir: paths.controlDir,
        stdoutPath: paths.stdoutPath,
        stdinPath: paths.stdinPath,
        controlPipePath: paths.controlPipePath,
        sessionJsonPath: paths.sessionJsonPath,
        startTime: new Date(),
      };

      this.sessions.set(sessionId, session);

      // Update session info with PID and running status
      sessionInfo.pid = ptyProcess.pid;
      sessionInfo.status = 'running';
      this.sessionManager.saveSessionInfo(sessionId, sessionInfo);

      logger.log(chalk.green(`Session ${sessionId} created successfully (PID: ${ptyProcess.pid})`));

      // Setup PTY event handlers
      this.setupPtyHandlers(session, options.forwardToStdout || false, options.onExit);

      // Setup control pipe if forwarding to stdout
      if (options.forwardToStdout) {
        this.setupControlPipe(session);

        // Setup stdin forwarding for fwd mode
        this.setupStdinForwarding(session);
        logger.log(chalk.gray('Stdin forwarding enabled'));
      }

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

    // Handle PTY data output
    ptyProcess?.onData((data: string) => {
      try {
        // Check for bell character (ASCII 7) - filter out OSC sequences
        if (data.includes('\x07')) {
          logger.debug(`Bell data in session ${session.id}: ${JSON.stringify(data)}`);

          // Count total bells and OSC-terminated bells
          const totalBells = (data.match(/\x07/g) || []).length;

          // Count OSC sequences terminated with bell: \x1b]...\x07
          const oscMatches = data.match(/\x1b]([^\x07\x1b]|\x1b[^]])*\x07/g) || [];
          const oscTerminatedBells = oscMatches.length;

          // If there are more bells than OSC terminators, we have real bells
          const realBells = totalBells - oscTerminatedBells;

          if (realBells > 0) {
            logger.debug(
              `Real bell(s) detected in session ${session.id}: ${realBells} bells (${oscTerminatedBells} OSC-terminated)`
            );
            this.emit('bell', {
              sessionInfo: session.sessionInfo,
              timestamp: new Date(),
            });
          } else {
            logger.debug(
              `Ignoring OSC sequence bells in session ${session.id}: ${oscTerminatedBells} OSC bells, ${realBells} real bells`
            );
          }
        }

        // Write to asciinema file
        asciinemaWriter?.writeOutput(Buffer.from(data, 'utf8'));

        // Forward to stdout if requested (for fwd.ts)
        if (forwardToStdout) {
          process.stdout.write(data);
        }
      } catch (error) {
        logger.error(`Failed to write PTY data for session ${session.id}:`, error);
      }
    });

    // Handle PTY exit
    ptyProcess?.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
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

        // Clean up session resources
        this.cleanupSessionResources(session);

        // Remove from active sessions
        this.sessions.delete(session.id);

        // Clean up bell tracking
        this.lastBellTime.delete(session.id);
        this.sessionExitTimes.delete(session.id);

        // Call exit callback if provided (for fwd.ts)
        if (onExit) {
          onExit(exitCode || 0, signal);
        }
      } catch (error) {
        logger.error(`Failed to handle exit for session ${session.id}:`, error);
      }
    });

    // Monitor stdin file for input
    this.monitorStdinFile(session);
  }

  /**
   * Monitor stdin file for input data using Unix socket for lowest latency
   */
  private monitorStdinFile(session: PtySession): void {
    // Create Unix domain socket for fast IPC
    const socketPath = path.join(session.controlDir, 'input.sock');

    try {
      // Remove existing socket if it exists
      try {
        fs.unlinkSync(socketPath);
      } catch (_e) {
        // Socket doesn't exist, this is expected
      }

      // Create Unix domain socket server
      const inputServer = net.createServer((client) => {
        client.setNoDelay(true);
        client.on('data', (data) => {
          const text = data.toString('utf8');
          if (session.ptyProcess) {
            // Write input first for fastest response
            session.ptyProcess.write(text);
            // Then record it (non-blocking)
            session.asciinemaWriter?.writeInput(text);
          }
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

    // Socket-only approach - no FIFO monitoring
  }

  /**
   * Setup control pipe for fwd mode to handle resize and kill commands
   */
  private setupControlPipe(session: PtySession): void {
    const controlPipePath = session.controlPipePath;

    try {
      // Create control file if it doesn't exist
      if (!fs.existsSync(controlPipePath)) {
        fs.writeFileSync(controlPipePath, '');
      }

      // Use file watching approach for all platforms
      let lastControlPosition = 0;

      const readNewControlData = () => {
        try {
          if (!fs.existsSync(controlPipePath)) return;

          const stats = fs.statSync(controlPipePath);
          if (stats.size > lastControlPosition) {
            const fd = fs.openSync(controlPipePath, 'r');
            const buffer = Buffer.allocUnsafe(stats.size - lastControlPosition);
            fs.readSync(fd, buffer, 0, buffer.length, lastControlPosition);
            fs.closeSync(fd);
            const data = buffer.toString('utf8');

            const lines = data.split('\n');
            for (const line of lines) {
              if (line.trim()) {
                try {
                  const message = JSON.parse(line);
                  this.handleControlMessage(session, message);
                } catch (_e) {
                  logger.warn(`Invalid control message in session ${session.id}: ${line}`);
                }
              }
            }

            lastControlPosition = stats.size;
          }
        } catch (error) {
          logger.debug(`Failed to read control data for session ${session.id}:`, error);
        }
      };

      // Use file watcher
      const watcher = fs.watch(controlPipePath, (eventType) => {
        if (eventType === 'change') {
          readNewControlData();
        }
      });

      // Store watcher for cleanup
      session.controlWatcher = watcher;

      // Unref the watcher so it doesn't keep the process alive
      watcher.unref();

      // Read any existing data
      readNewControlData();
    } catch (error) {
      logger.error(`Failed to set up control pipe for session ${session.id}:`, error);
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
      } else if (input.key !== undefined) {
        dataToSend = this.convertSpecialKey(input.key);
      } else {
        throw new PtyError('No text or key specified in input', 'INVALID_INPUT');
      }

      // If we have an in-memory session with active PTY, use it
      const memorySession = this.sessions.get(sessionId);
      if (memorySession?.ptyProcess) {
        memorySession.ptyProcess.write(dataToSend);
        memorySession.asciinemaWriter?.writeInput(dataToSend);
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
        const socketPath = path.join(sessionPaths.controlDir, 'input.sock');

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
          // Write and flush immediately
          socketClient.write(dataToSend);
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
   * Send a control message to an external session
   */
  private sendControlMessage(
    sessionId: string,
    message: ResizeControlMessage | KillControlMessage
  ): boolean {
    const sessionPaths = this.sessionManager.getSessionPaths(sessionId);
    if (!sessionPaths) {
      return false;
    }

    try {
      const messageStr = JSON.stringify(message) + '\n';
      fs.appendFileSync(sessionPaths.controlPipePath, messageStr);
      return true;
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
          memorySession.ptyProcess.kill('SIGKILL');
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
            await new Promise((resolve) => setTimeout(resolve, 100));
            return;
          }

          // Send SIGTERM first
          process.kill(diskSession.pid, 'SIGTERM');

          // Wait up to 3 seconds for graceful termination
          const maxWaitTime = 3000;
          const checkInterval = 500;
          const maxChecks = maxWaitTime / checkInterval;

          for (let i = 0; i < maxChecks; i++) {
            await new Promise((resolve) => setTimeout(resolve, checkInterval));

            if (!ProcessUtils.isProcessRunning(diskSession.pid)) {
              logger.log(chalk.green(`External session ${sessionId} terminated gracefully`));
              return;
            }
          }

          // Process didn't terminate gracefully, force kill
          logger.log(chalk.yellow(`External session ${sessionId} requires SIGKILL`));
          process.kill(diskSession.pid, 'SIGKILL');
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
    logger.log(chalk.yellow(`Terminating session ${sessionId} (PID: ${pid})`));

    try {
      // Send SIGTERM first
      session.ptyProcess.kill('SIGTERM');

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
          logger.log(chalk.green(`Session ${sessionId} terminated gracefully`));
          this.sessions.delete(sessionId);
          return;
        }

        // Process still exists, continue waiting
        logger.debug(`Session ${sessionId} still running after ${(i + 1) * checkInterval}ms`);
      }

      // Process didn't terminate gracefully within 3 seconds, force kill
      logger.log(chalk.yellow(`Session ${sessionId} requires SIGKILL`));
      try {
        session.ptyProcess.kill('SIGKILL');
        // Wait a bit more for SIGKILL to take effect
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (_killError) {
        // Process might have died between our check and SIGKILL
        logger.debug(`SIGKILL failed for session ${sessionId} (process already terminated)`);
      }

      // Remove from sessions regardless
      this.sessions.delete(sessionId);
      logger.log(chalk.yellow(`Session ${sessionId} forcefully terminated`));
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

    // Return all sessions from storage
    return this.sessionManager.listSessions();
  }

  /**
   * Get a specific session
   */
  getSession(sessionId: string): Session | null {
    const paths = this.sessionManager.getSessionPaths(sessionId, true);
    if (!paths) {
      return null;
    }
    const session = this.sessionManager.loadSessionInfo(sessionId);
    if (!session) {
      return null;
    }

    if (fs.existsSync(paths.stdoutPath)) {
      const lastModified = fs.statSync(paths.stdoutPath).mtime.toISOString();
      return { ...session, lastModified };
    }

    return { ...session, lastModified: session.startedAt };
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

    // Forward stdin to PTY with maximum speed
    process.stdin.on('data', (data: string) => {
      try {
        session.ptyProcess?.write(data);
      } catch (error) {
        logger.error(`Failed to forward stdin to session ${session.id}:`, error);
      }
    });
  }

  /**
   * Clean up all resources associated with a session
   */
  private cleanupSessionResources(session: PtySession): void {
    // Clean up resize tracking
    this.sessionResizeSources.delete(session.id);

    // Clean up input socket server
    if (session.inputSocketServer) {
      // Close the server and wait for it to close
      session.inputSocketServer.close();
      // Unref the server so it doesn't keep the process alive
      session.inputSocketServer.unref();
      try {
        fs.unlinkSync(path.join(session.controlDir, 'input.sock'));
      } catch (_e) {
        // Socket already removed
      }
    }

    // Close control watcher
    if (session.controlWatcher) {
      session.controlWatcher.close();
    }

    // Remove control pipe
    if (fs.existsSync(session.controlPipePath)) {
      try {
        fs.unlinkSync(session.controlPipePath);
      } catch (_e) {
        // Control pipe already removed
      }
    }
  }
}
