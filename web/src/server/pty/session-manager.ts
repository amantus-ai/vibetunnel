/**
 * SessionManager - Handles session persistence and file system operations
 *
 * This class manages the session directory structure, metadata persistence,
 * and file operations to maintain compatibility with tty-fwd format.
 */

import chalk from 'chalk';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Session, SessionInfo } from '../../shared/types.js';
import { createLogger } from '../utils/logger.js';
import { ProcessUtils } from './process-utils.js';
import { PtyError } from './types.js';

const logger = createLogger('session-manager');

export class SessionManager {
  private controlPath: string;

  constructor(controlPath?: string) {
    this.controlPath = controlPath || path.join(os.homedir(), '.vibetunnel', 'control');
    logger.debug(`initializing session manager with control path: ${this.controlPath}`);
    this.ensureControlDirectory();
  }

  /**
   * Ensure the control directory exists
   */
  private ensureControlDirectory(): void {
    if (!fs.existsSync(this.controlPath)) {
      fs.mkdirSync(this.controlPath, { recursive: true });
      logger.log(chalk.green(`control directory created: ${this.controlPath}`));
    }
  }

  /**
   * Create a new session directory structure
   */
  createSessionDirectory(sessionId: string): {
    controlDir: string;
    stdoutPath: string;
    stdinPath: string;
    sessionJsonPath: string;
    controlPipePath: string;
  } {
    const controlDir = path.join(this.controlPath, sessionId);

    // Create session directory
    if (!fs.existsSync(controlDir)) {
      fs.mkdirSync(controlDir, { recursive: true });
    }

    const paths = this.getSessionPaths(sessionId, true);
    if (!paths) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Create FIFO pipe for stdin (or regular file on systems without mkfifo)
    this.createStdinPipe(paths.stdinPath);
    logger.log(chalk.green(`session directory created for ${sessionId}`));
    return paths;
  }

  /**
   * Create stdin pipe (FIFO if possible, regular file otherwise)
   */
  private createStdinPipe(stdinPath: string): void {
    try {
      // Try to create FIFO pipe (Unix-like systems)
      if (process.platform !== 'win32') {
        const result = spawnSync('mkfifo', [stdinPath], { stdio: 'ignore' });
        if (result.status === 0) {
          logger.debug(`FIFO pipe created: ${stdinPath}`);
          return; // Successfully created FIFO
        }
      }

      // Fallback to regular file
      if (!fs.existsSync(stdinPath)) {
        fs.writeFileSync(stdinPath, '');
      }
    } catch (error) {
      // If mkfifo fails, create regular file
      logger.debug(
        `mkfifo failed (${error instanceof Error ? error.message : 'unknown error'}), creating regular file: ${stdinPath}`
      );
      if (!fs.existsSync(stdinPath)) {
        fs.writeFileSync(stdinPath, '');
      }
    }
  }

  /**
   * Save session info to JSON file
   */
  saveSessionInfo(sessionId: string, sessionInfo: SessionInfo): void {
    try {
      const sessionInfoStr = JSON.stringify(sessionInfo, null, 2);

      // Write to temporary file first, then move to final location (atomic write)
      const sessionJsonPath = path.join(this.controlPath, sessionId, 'session.json');
      const tempPath = `${sessionJsonPath}.tmp`;
      fs.writeFileSync(tempPath, sessionInfoStr, 'utf8');
      fs.renameSync(tempPath, sessionJsonPath);
      logger.debug(`session info saved for ${sessionId}`);
    } catch (error) {
      throw new PtyError(
        `Failed to save session info: ${error instanceof Error ? error.message : String(error)}`,
        'SAVE_SESSION_FAILED'
      );
    }
  }

  /**
   * Load session info from JSON file
   */
  loadSessionInfo(sessionId: string): SessionInfo | null {
    const sessionJsonPath = path.join(this.controlPath, sessionId, 'session.json');
    try {
      if (!fs.existsSync(sessionJsonPath)) {
        return null;
      }

      const content = fs.readFileSync(sessionJsonPath, 'utf8');
      return JSON.parse(content) as SessionInfo;
    } catch (error) {
      logger.warn(`failed to load session info for ${sessionId}:`, error);
      return null;
    }
  }

  /**
   * Update session status
   */
  updateSessionStatus(sessionId: string, status: string, pid?: number, exitCode?: number): void {
    const sessionInfo = this.loadSessionInfo(sessionId);
    if (!sessionInfo) {
      throw new PtyError('Session info not found', 'SESSION_NOT_FOUND');
    }

    if (pid !== undefined) {
      sessionInfo.pid = pid;
    }
    sessionInfo.status = status as 'starting' | 'running' | 'exited';
    if (exitCode !== undefined) {
      sessionInfo.exitCode = exitCode;
    }

    this.saveSessionInfo(sessionId, sessionInfo);
    logger.log(
      `session ${sessionId} status updated to ${status}${pid ? ` (pid: ${pid})` : ''}${exitCode !== undefined ? ` (exit code: ${exitCode})` : ''}`
    );
  }

  /**
   * List all sessions
   */
  listSessions(): Session[] {
    try {
      if (!fs.existsSync(this.controlPath)) {
        return [];
      }

      const sessions: Session[] = [];
      const entries = fs.readdirSync(this.controlPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const sessionId = entry.name;
          const sessionDir = path.join(this.controlPath, sessionId);
          const stdoutPath = path.join(sessionDir, 'stdout');

          const sessionInfo = this.loadSessionInfo(sessionId);
          if (sessionInfo) {
            // Determine active state for running processes
            if (sessionInfo.status === 'running' && sessionInfo.pid) {
              // Update status if process is no longer alive
              if (!ProcessUtils.isProcessRunning(sessionInfo.pid)) {
                logger.log(
                  chalk.yellow(
                    `process ${sessionInfo.pid} no longer running for session ${sessionId}`
                  )
                );
                sessionInfo.status = 'exited';
                if (sessionInfo.exitCode === undefined) {
                  sessionInfo.exitCode = 1; // Default exit code for dead processes
                }
                this.saveSessionInfo(sessionId, sessionInfo);
              }
            }
            if (fs.existsSync(stdoutPath)) {
              const lastModified = fs.statSync(stdoutPath).mtime.toISOString();
              sessions.push({ ...sessionInfo, id: sessionId, lastModified });
            } else {
              sessions.push({ ...sessionInfo, id: sessionId, lastModified: sessionInfo.startedAt });
            }
          }
        }
      }

      // Sort by startedAt timestamp (newest first)
      sessions.sort((a, b) => {
        const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0;
        const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0;
        return bTime - aTime;
      });

      logger.debug(`found ${sessions.length} sessions`);
      return sessions;
    } catch (error) {
      throw new PtyError(
        `Failed to list sessions: ${error instanceof Error ? error.message : String(error)}`,
        'LIST_SESSIONS_FAILED'
      );
    }
  }

  /**
   * Check if a session exists
   */
  sessionExists(sessionId: string): boolean {
    const sessionDir = path.join(this.controlPath, sessionId);
    const sessionJsonPath = path.join(sessionDir, 'session.json');
    return fs.existsSync(sessionJsonPath);
  }

  /**
   * Cleanup a specific session
   */
  cleanupSession(sessionId: string): void {
    if (!sessionId) {
      throw new PtyError('Session ID is required for cleanup', 'INVALID_SESSION_ID');
    }

    try {
      const sessionDir = path.join(this.controlPath, sessionId);

      if (fs.existsSync(sessionDir)) {
        // Remove directory and all contents
        fs.rmSync(sessionDir, { recursive: true, force: true });
        logger.log(chalk.green(`session ${sessionId} cleaned up`));
      }
    } catch (error) {
      throw new PtyError(
        `Failed to cleanup session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
        'CLEANUP_FAILED',
        sessionId
      );
    }
  }

  /**
   * Cleanup all exited sessions
   */
  cleanupExitedSessions(): string[] {
    const cleanedSessions: string[] = [];

    try {
      const sessions = this.listSessions();

      for (const session of sessions) {
        if (session.status === 'exited' && session.id) {
          this.cleanupSession(session.id);
          cleanedSessions.push(session.id);
        }
      }

      if (cleanedSessions.length > 0) {
        logger.log(chalk.green(`cleaned up ${cleanedSessions.length} exited sessions`));
      }
      return cleanedSessions;
    } catch (error) {
      throw new PtyError(
        `Failed to cleanup exited sessions: ${error instanceof Error ? error.message : String(error)}`,
        'CLEANUP_EXITED_FAILED'
      );
    }
  }

  /**
   * Get session paths for a given session ID
   */
  getSessionPaths(
    sessionId: string,
    checkExists: boolean = false
  ): {
    controlDir: string;
    stdoutPath: string;
    stdinPath: string;
    sessionJsonPath: string;
    controlPipePath: string;
  } | null {
    const sessionDir = path.join(this.controlPath, sessionId);

    if (checkExists && !fs.existsSync(sessionDir)) {
      return null;
    }

    return {
      controlDir: sessionDir,
      stdoutPath: path.join(sessionDir, 'stdout'),
      stdinPath: path.join(sessionDir, 'stdin'),
      sessionJsonPath: path.join(sessionDir, 'session.json'),
      controlPipePath: path.join(sessionDir, 'control'),
    };
  }

  /**
   * Write to stdin pipe/file
   */
  writeToStdin(sessionId: string, data: string): void {
    const paths = this.getSessionPaths(sessionId);
    if (!paths) {
      throw new PtyError(`Session ${sessionId} not found`, 'SESSION_NOT_FOUND', sessionId);
    }

    try {
      // For FIFO pipes, we need to open in append mode
      // For regular files, we also use append mode to avoid conflicts
      fs.appendFileSync(paths.stdinPath, data);
      logger.debug(`wrote ${data.length} bytes to stdin for session ${sessionId}`);
    } catch (error) {
      throw new PtyError(
        `Failed to write to stdin for session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
        'STDIN_WRITE_FAILED',
        sessionId
      );
    }
  }

  /**
   * Update sessions that have zombie processes
   */
  updateZombieSessions(): string[] {
    const updatedSessions: string[] = [];

    try {
      const sessions = this.listSessions();

      for (const session of sessions) {
        if (session.status === 'running' && session.pid) {
          if (!ProcessUtils.isProcessRunning(session.pid)) {
            // Process is dead, update status
            const paths = this.getSessionPaths(session.id);
            if (paths) {
              logger.log(
                chalk.yellow(
                  `marking zombie process ${session.pid} as exited for session ${session.id}`
                )
              );
              this.updateSessionStatus(session.id, 'exited', undefined, 1);
              updatedSessions.push(session.id);
            }
          }
        }
      }

      return updatedSessions;
    } catch (error) {
      logger.warn('failed to update zombie sessions:', error);
      return [];
    }
  }

  /**
   * Get control path
   */
  getControlPath(): string {
    return this.controlPath;
  }
}
