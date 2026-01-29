/**
 * ProcessTracker - Handles foreground process detection and command tracking
 *
 * Responsible for:
 * - Tracking foreground process changes in PTY sessions
 * - Detecting command start/completion events
 * - Emitting notifications when long-running commands finish
 */

import chalk from 'chalk';
import { exec } from 'child_process';
import { EventEmitter } from 'events';
import type { IPty } from 'node-pty';
import { promisify } from 'util';
import { ProcessTreeAnalyzer } from '../services/process-tree-analyzer.js';
import { createLogger } from '../utils/logger.js';
import type { PtySession } from './types.js';

/**
 * Extended IPty interface that includes internal node-pty properties.
 * The _pty property contains the PTY device name (e.g., /dev/ttys001)
 * and is used for querying the foreground process group.
 */
interface IPtyWithInternals extends IPty {
  _pty?: string;
}

const logger = createLogger('process-tracker');
const execAsync = promisify(exec);

// Foreground process tracking constants
const PROCESS_POLL_INTERVAL_MS = 500; // How often to check foreground process
const MIN_COMMAND_DURATION_MS = 3000; // Minimum duration for command completion notifications
const SHELL_COMMANDS = new Set(['cd', 'ls', 'pwd', 'echo', 'export', 'alias', 'unset']); // Built-in commands to ignore

/**
 * Event data emitted when a command finishes
 */
export interface CommandFinishedEvent {
  sessionId: string;
  command: string;
  exitCode: number;
  duration: number;
  timestamp: string;
}

/**
 * Tracks foreground processes for PTY sessions
 */
export class ProcessTracker extends EventEmitter {
  private processTreeAnalyzer = new ProcessTreeAnalyzer();
  private pollingIntervals = new Map<string, NodeJS.Timeout>();
  private shellPgids = new Map<string, number>();
  private currentForegroundPgids = new Map<string, number>();
  private currentCommands = new Map<string, string>();
  private commandStartTimes = new Map<string, number>();

  /**
   * Start tracking foreground process for a session
   */
  async startTracking(session: PtySession): Promise<void> {
    if (!session.ptyProcess) return;

    logger.debug(`Starting foreground process tracking for session ${session.id}`);
    const ptyPid = session.ptyProcess.pid;

    try {
      const shellPgid = await this.getProcessPgid(ptyPid);
      if (shellPgid) {
        this.shellPgids.set(session.id, shellPgid);
        this.currentForegroundPgids.set(session.id, shellPgid);

        logger.info(
          `🔔 NOTIFICATION DEBUG: Starting command tracking for session ${session.id} - shellPgid: ${shellPgid}, polling every ${PROCESS_POLL_INTERVAL_MS}ms`
        );
        logger.debug(`Session ${session.id}: Shell PGID is ${shellPgid}, starting polling`);

        // Start polling for foreground process changes
        const interval = setInterval(() => {
          this.checkForegroundProcess(session);
        }, PROCESS_POLL_INTERVAL_MS);

        this.pollingIntervals.set(session.id, interval);
      } else {
        logger.warn(`Session ${session.id}: Could not get shell PGID`);
      }
    } catch (err) {
      logger.warn(`Failed to get shell PGID for session ${session.id}:`, err);
    }
  }

  /**
   * Stop tracking for a session
   */
  stopTracking(sessionId: string): void {
    const interval = this.pollingIntervals.get(sessionId);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(sessionId);
    }

    this.shellPgids.delete(sessionId);
    this.currentForegroundPgids.delete(sessionId);
    this.currentCommands.delete(sessionId);
    this.commandStartTimes.delete(sessionId);
  }

  /**
   * Get the current command for a session
   */
  getCurrentCommand(sessionId: string): string | undefined {
    return this.currentCommands.get(sessionId);
  }

  /**
   * Get process group ID for a process
   */
  private async getProcessPgid(pid: number): Promise<number | null> {
    try {
      const { stdout } = await execAsync(`ps -o pgid= -p ${pid}`, { timeout: 1000 });
      const pgid = Number.parseInt(stdout.trim(), 10);
      return Number.isNaN(pgid) ? null : pgid;
    } catch (_error) {
      return null;
    }
  }

  /**
   * Get the foreground process group of a terminal
   */
  private async getTerminalForegroundPgid(session: PtySession): Promise<number | null> {
    if (!session.ptyProcess) return null;

    try {
      // On Unix-like systems, we can check the terminal's foreground process group
      const ttyName = (session.ptyProcess as IPtyWithInternals)._pty; // Internal PTY name
      if (!ttyName) {
        logger.debug(`Session ${session.id}: No TTY name found, falling back to process tree`);
        return this.getForegroundFromProcessTree(session);
      }

      // Use ps to find processes associated with this terminal
      const psCommand = `ps -t ${ttyName} -o pgid,pid,ppid,command | grep -v PGID | head -1`;
      const { stdout } = await execAsync(psCommand, { timeout: 1000 });

      const lines = stdout.trim().split('\n');
      if (lines.length > 0 && lines[0].trim()) {
        const parts = lines[0].trim().split(/\s+/);
        const pgid = Number.parseInt(parts[0], 10);

        // Log the raw ps output for debugging
        logger.debug(`Session ${session.id}: ps output for TTY ${ttyName}: "${lines[0].trim()}"`);

        if (!Number.isNaN(pgid)) {
          return pgid;
        }
      }

      logger.debug(`Session ${session.id}: Could not parse PGID from ps output, falling back`);
    } catch (error) {
      logger.debug(`Session ${session.id}: Error getting terminal PGID: ${error}, falling back`);
      // Fallback: try to get foreground process from process tree
      return this.getForegroundFromProcessTree(session);
    }

    return null;
  }

  /**
   * Get foreground process from process tree analysis
   */
  private async getForegroundFromProcessTree(session: PtySession): Promise<number | null> {
    if (!session.ptyProcess) return null;

    try {
      const shellPgid = this.shellPgids.get(session.id);
      const processTree = await this.processTreeAnalyzer.getProcessTree(session.ptyProcess.pid);

      // Find the most recent non-shell process
      for (const proc of processTree) {
        if (proc.pgid !== shellPgid && proc.command && !this.isShellProcess(proc.command)) {
          return proc.pgid;
        }
      }
    } catch (error) {
      logger.debug(`Failed to analyze process tree for session ${session.id}:`, error);
    }

    return this.shellPgids.get(session.id) || null;
  }

  /**
   * Check if a command is a shell process
   */
  private isShellProcess(command: string): boolean {
    const shellNames = ['bash', 'zsh', 'fish', 'sh', 'dash', 'tcsh', 'csh'];
    const cmdLower = command.toLowerCase();
    return shellNames.some((shell) => cmdLower.includes(shell));
  }

  /**
   * Check current foreground process and detect changes
   */
  private async checkForegroundProcess(session: PtySession): Promise<void> {
    const shellPgid = this.shellPgids.get(session.id);
    if (!session.ptyProcess || !shellPgid) return;

    try {
      const currentPgid = await this.getTerminalForegroundPgid(session);
      const previousPgid = this.currentForegroundPgids.get(session.id);

      // Enhanced debug logging
      const timestamp = new Date().toISOString();
      logger.debug(
        chalk.gray(
          `[${timestamp}] Session ${session.id} PGID check: current=${currentPgid}, previous=${previousPgid}, shell=${shellPgid}`
        )
      );

      // Add debug logging
      if (currentPgid !== previousPgid) {
        logger.info(
          `🔔 NOTIFICATION DEBUG: PGID change detected - sessionId: ${session.id}, from ${previousPgid} to ${currentPgid}, shellPgid: ${shellPgid}`
        );
        logger.debug(
          chalk.yellow(
            `Session ${session.id}: Foreground PGID changed from ${previousPgid} to ${currentPgid}`
          )
        );
      }

      if (currentPgid && currentPgid !== previousPgid) {
        // Foreground process changed
        this.currentForegroundPgids.set(session.id, currentPgid);

        if (currentPgid === shellPgid && previousPgid !== shellPgid) {
          // A command just finished (returned to shell)
          logger.debug(
            chalk.green(
              `Session ${session.id}: Command finished, returning to shell (PGID ${previousPgid} → ${currentPgid})`
            )
          );
          await this.handleCommandFinished(session, previousPgid);
        } else if (currentPgid !== shellPgid) {
          // A new command started
          logger.debug(
            chalk.blue(`Session ${session.id}: New command started (PGID ${currentPgid})`)
          );
          await this.handleCommandStarted(session, currentPgid);
        }
      }
    } catch (error) {
      logger.debug(`Error checking foreground process for session ${session.id}:`, error);
    }
  }

  /**
   * Handle when a new command starts
   */
  private async handleCommandStarted(session: PtySession, pgid: number): Promise<void> {
    try {
      // Get command info from process tree
      if (!session.ptyProcess) return;
      const processTree = await this.processTreeAnalyzer.getProcessTree(session.ptyProcess.pid);
      const commandProc = processTree.find((p) => p.pgid === pgid);

      if (commandProc) {
        this.currentCommands.set(session.id, commandProc.command);
        this.commandStartTimes.set(session.id, Date.now());

        // Emit command started event for external listeners (like SessionMonitor)
        this.emit('commandStarted', {
          sessionId: session.id,
          command: commandProc.command,
          timestamp: new Date().toISOString(),
        });

        // Special logging for Claude commands
        const isClaudeCommand = commandProc.command.toLowerCase().includes('claude');
        if (isClaudeCommand) {
          logger.log(
            chalk.cyan(
              `🤖 Session ${session.id}: Claude command started: "${commandProc.command}" (PGID: ${pgid})`
            )
          );
        } else {
          logger.debug(
            `Session ${session.id}: Command started: "${commandProc.command}" (PGID: ${pgid})`
          );
        }

        // Log process tree for debugging
        logger.debug(
          `Process tree for session ${session.id}:`,
          processTree.map((p) => `  PID: ${p.pid}, PGID: ${p.pgid}, CMD: ${p.command}`).join('\n')
        );
      } else {
        logger.warn(
          chalk.yellow(`Session ${session.id}: Could not find process info for PGID ${pgid}`)
        );
      }
    } catch (error) {
      logger.debug(`Failed to get command info for session ${session.id}:`, error);
    }
  }

  /**
   * Handle when a command finishes
   */
  private async handleCommandFinished(
    session: PtySession,
    pgid: number | undefined
  ): Promise<void> {
    const commandStartTime = this.commandStartTimes.get(session.id);
    const currentCommand = this.currentCommands.get(session.id);

    if (!pgid || !commandStartTime || !currentCommand) {
      logger.debug(
        chalk.red(
          `Session ${session.id}: Cannot handle command finished - missing data: pgid=${pgid}, startTime=${commandStartTime}, command="${currentCommand}"`
        )
      );
      return;
    }

    const duration = Date.now() - commandStartTime;
    const command = currentCommand;
    const isClaudeCommand = command.toLowerCase().includes('claude');

    // Reset tracking
    this.currentCommands.delete(session.id);
    this.commandStartTimes.delete(session.id);

    // Log command completion for Claude
    if (isClaudeCommand) {
      logger.log(
        chalk.cyan(
          `🤖 Session ${session.id}: Claude command completed: "${command}" (duration: ${duration}ms)`
        )
      );
    }

    // Check if we should notify - bypass duration check for Claude commands
    if (!isClaudeCommand && duration < MIN_COMMAND_DURATION_MS) {
      logger.debug(
        `Session ${session.id}: Command "${command}" too short (${duration}ms < ${MIN_COMMAND_DURATION_MS}ms), not notifying`
      );
      return;
    }

    // Log duration for Claude commands even if bypassing the check
    if (isClaudeCommand && duration < MIN_COMMAND_DURATION_MS) {
      logger.log(
        chalk.yellow(
          `⚡ Session ${session.id}: Claude command completed quickly (${duration}ms) - still notifying`
        )
      );
    }

    // Check if it's a built-in shell command
    const baseCommand = command.split(/\s+/)[0];
    if (SHELL_COMMANDS.has(baseCommand)) {
      logger.debug(`Session ${session.id}: Ignoring built-in command: ${baseCommand}`);
      return;
    }

    // Try to get exit code (this is tricky and might not always work)
    const exitCode = 0;
    try {
      // Check if we can find the exit status in shell history or process info
      // This is platform-specific and might not be reliable
      const { stdout } = await execAsync(
        `ps -o pid,stat -p ${pgid} 2>/dev/null || echo "NOTFOUND"`,
        { timeout: 500 }
      );
      if (stdout.includes('NOTFOUND') || stdout.includes('Z')) {
        // Process is zombie or not found, likely exited
        // We can't reliably get exit code this way
        logger.debug(
          `Session ${session.id}: Process ${pgid} not found or zombie, assuming exit code 0`
        );
      }
    } catch (_error) {
      // Ignore errors in exit code detection
      logger.debug(`Session ${session.id}: Could not detect exit code for process ${pgid}`);
    }

    // Emit the event
    const eventData: CommandFinishedEvent = {
      sessionId: session.id,
      command,
      exitCode,
      duration,
      timestamp: new Date().toISOString(),
    };

    logger.info(
      `🔔 NOTIFICATION DEBUG: Emitting commandFinished event - sessionId: ${session.id}, command: "${command}", duration: ${duration}ms, exitCode: ${exitCode}`
    );
    this.emit('commandFinished', eventData);

    // Enhanced logging for events
    if (isClaudeCommand) {
      logger.log(
        chalk.green(
          `✅ Session ${session.id}: Claude command notification event emitted: "${command}" (duration: ${duration}ms, exit: ${exitCode})`
        )
      );
    } else {
      logger.log(`Session ${session.id}: Command finished: "${command}" (duration: ${duration}ms)`);
    }

    logger.debug(`Session ${session.id}: commandFinished event data:`, eventData);
  }

  /**
   * Shutdown all tracking
   */
  shutdown(): void {
    for (const [sessionId, interval] of this.pollingIntervals) {
      clearInterval(interval);
      logger.debug(`Stopped tracking for session ${sessionId}`);
    }
    this.pollingIntervals.clear();
    this.shellPgids.clear();
    this.currentForegroundPgids.clear();
    this.currentCommands.clear();
    this.commandStartTimes.clear();
  }
}
