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
import { VERSION } from '../version.js';
import { ProcessUtils } from './process-utils.js';
import { PtyError } from './types.js';

const logger = createLogger('session-manager');

export class SessionManager {
  private controlPath: string;
  private static readonly SESSION_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

  constructor(controlPath?: string) {
    this.controlPath = controlPath || path.join(os.homedir(), '.vibetunnel', 'control');
    logger.debug(`initializing session manager with control path: ${this.controlPath}`);
    this.ensureControlDirectory();
  }

  /**
   * Validate session ID format for security
   */
  private validateSessionId(sessionId: string): void {
    if (!SessionManager.SESSION_ID_REGEX.test(sessionId)) {
      throw new PtyError(
        `Invalid session ID format: "${sessionId}". Session IDs must only contain letters, numbers, hyphens (-), and underscores (_).`,
        'INVALID_SESSION_ID'
      );
    }
  }

  /**
   * Ensure the control directory exists
   */
  private ensureControlDirectory(): void {
    if (!fs.existsSync(this.controlPath)) {
      fs.mkdirSync(this.controlPath, { recursive: true });
      logger.debug(chalk.green(`control directory created: ${this.controlPath}`));
    }
  }

  /**
   * Get the path to the version tracking file
   */
  private getVersionFilePath(): string {
    return path.join(this.controlPath, '.version');
  }

  /**
   * Read the last known version from the version file
   */
  private readLastVersion(): string | null {
    try {
      const versionFile = this.getVersionFilePath();
      if (fs.existsSync(versionFile)) {
        const content = fs.readFileSync(versionFile, 'utf8').trim();
        logger.debug(`read last version from file: ${content}`);
        return content;
      }
      return null;
    } catch (error) {
      logger.warn(`failed to read version file: ${error}`);
      return null;
    }
  }

  /**
   * Write the current version to the version file
   */
  private writeCurrentVersion(): void {
    try {
      const versionFile = this.getVersionFilePath();
      fs.writeFileSync(versionFile, VERSION, 'utf8');
      logger.debug(`wrote current version to file: ${VERSION}`);
    } catch (error) {
      logger.warn(`failed to write version file: ${error}`);
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
  } {
    this.validateSessionId(sessionId);
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
    logger.debug(chalk.green(`session directory created for ${sessionId}`));
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
    this.validateSessionId(sessionId);
    try {
      const sessionDir = path.join(this.controlPath, sessionId);
      const sessionJsonPath = path.join(sessionDir, 'session.json');
      const tempPath = `${sessionJsonPath}.tmp`;

      // Ensure session directory exists before writing
      if (!fs.existsSync(sessionDir)) {
        logger.warn(`Session directory ${sessionDir} does not exist, creating it`);
        fs.mkdirSync(sessionDir, { recursive: true });
      }

      const sessionInfoStr = JSON.stringify(sessionInfo, null, 2);

      // Write to temporary file first, then move to final location (atomic write)
      fs.writeFileSync(tempPath, sessionInfoStr, 'utf8');

      // Double-check directory still exists before rename (handle race conditions)
      if (!fs.existsSync(sessionDir)) {
        logger.error(`Session directory ${sessionDir} was deleted during save operation`);
        // Clean up temp file if it exists
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
        throw new PtyError(
          `Session directory was deleted during save operation`,
          'SESSION_DIR_DELETED'
        );
      }

      fs.renameSync(tempPath, sessionJsonPath);
      logger.debug(
        `session.json file saved for session ${sessionId} with name: ${sessionInfo.name}`
      );
    } catch (error) {
      if (error instanceof PtyError) {
        throw error;
      }
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
    logger.debug(
      `session ${sessionId} status updated to ${status}${pid ? ` (pid: ${pid})` : ''}${exitCode !== undefined ? ` (exit code: ${exitCode})` : ''}`
    );
  }

  /**
   * Ensure a session name is unique by adding a suffix if necessary
   */
  private ensureUniqueName(desiredName: string, excludeSessionId?: string): string {
    const sessions = this.listSessions();
    let finalName = desiredName;
    let suffix = 2;

    // Keep checking until we find a unique name
    while (true) {
      const nameExists = sessions.some(
        (session) => session.name === finalName && session.id !== excludeSessionId
      );

      if (!nameExists) {
        break;
      }

      // Add or increment suffix
      finalName = `${desiredName} (${suffix})`;
      suffix++;
    }

    return finalName;
  }

  /**
   * Update session name
   */
  updateSessionName(sessionId: string, name: string): string {
    logger.debug(
      `[SessionManager] updateSessionName called for session ${sessionId} with name: ${name}`
    );

    const sessionInfo = this.loadSessionInfo(sessionId);
    if (!sessionInfo) {
      logger.error(`[SessionManager] Session info not found for ${sessionId}`);
      throw new PtyError('Session info not found', 'SESSION_NOT_FOUND');
    }

    logger.debug(`[SessionManager] Current session info: ${JSON.stringify(sessionInfo)}`);

    // Ensure the name is unique
    const uniqueName = this.ensureUniqueName(name, sessionId);

    if (uniqueName !== name) {
      logger.debug(`[SessionManager] Name "${name}" already exists, using "${uniqueName}" instead`);
    }

    sessionInfo.name = uniqueName;

    logger.debug(`[SessionManager] Updated session info: ${JSON.stringify(sessionInfo)}`);
    logger.debug(`[SessionManager] Calling saveSessionInfo`);

    this.saveSessionInfo(sessionId, sessionInfo);
    logger.debug(`[SessionManager] session ${sessionId} name updated to: ${uniqueName}`);

    return uniqueName;
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
                logger.debug(
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

      logger.debug(`listSessions found ${sessions.length} sessions`);
      sessions.forEach((session) => {
        logger.debug(
          `  - Session ${session.id}: name="${session.name}", status="${session.status}"`
        );
      });
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
        logger.debug(`Cleaning up session directory: ${sessionDir}`);

        // Log session info before cleanup for debugging
        const sessionInfo = this.loadSessionInfo(sessionId);
        if (sessionInfo) {
          logger.debug(`Cleaning up session ${sessionId} with status: ${sessionInfo.status}`);
        }

        // Remove directory and all contents
        fs.rmSync(sessionDir, { recursive: true, force: true });
        logger.debug(chalk.green(`session ${sessionId} cleaned up`));
      } else {
        logger.debug(`Session directory ${sessionDir} does not exist, nothing to clean up`);
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
        logger.debug(chalk.green(`cleaned up ${cleanedSessions.length} exited sessions`));
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
   * Cleanup sessions from old VibeTunnel versions
   * This is called during server startup to clean sessions when version changes
   */
  cleanupOldVersionSessions(): { versionChanged: boolean; cleanedCount: number } {
    const lastVersion = this.readLastVersion();
    const currentVersion = VERSION;

    // If no version file exists, this is likely a fresh install or first time with version tracking
    if (!lastVersion) {
      logger.debug('no previous version found, checking for legacy sessions');

      // Clean up any sessions without version field
      let cleanedCount = 0;
      const sessions = this.listSessions();
      for (const session of sessions) {
        if (!session.version) {
          logger.debug(`cleaning up legacy session ${session.id} (no version field)`);
          this.cleanupSession(session.id);
          cleanedCount++;
        }
      }

      this.writeCurrentVersion();
      return { versionChanged: false, cleanedCount };
    }

    // If version hasn't changed, nothing to do
    if (lastVersion === currentVersion) {
      logger.debug(`version unchanged (${currentVersion}), skipping cleanup`);
      return { versionChanged: false, cleanedCount: 0 };
    }

    logger.log(chalk.yellow(`VibeTunnel version changed from ${lastVersion} to ${currentVersion}`));
    logger.log(chalk.yellow('cleaning up old sessions...'));

    let cleanedCount = 0;
    try {
      const sessions = this.listSessions();

      for (const session of sessions) {
        // Clean all sessions that don't match the current version
        // Sessions without version field are considered old
        if (!session.version || session.version !== currentVersion) {
          logger.debug(
            `cleaning up session ${session.id} (version: ${session.version || 'unknown'})`
          );
          this.cleanupSession(session.id);
          cleanedCount++;
        }
      }

      // Update the version file to current version
      this.writeCurrentVersion();

      if (cleanedCount > 0) {
        logger.log(chalk.green(`cleaned up ${cleanedCount} sessions from previous version`));
      } else {
        logger.log(chalk.gray('no old sessions to clean up'));
      }

      return { versionChanged: true, cleanedCount };
    } catch (error) {
      logger.error(`failed to cleanup old version sessions: ${error}`);
      // Still update version file to prevent repeated cleanup attempts
      this.writeCurrentVersion();
      return { versionChanged: true, cleanedCount };
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
  } | null {
    const sessionDir = path.join(this.controlPath, sessionId);
    logger.debug(
      `[SessionManager] getSessionPaths for ${sessionId}, sessionDir: ${sessionDir}, checkExists: ${checkExists}`
    );

    if (checkExists && !fs.existsSync(sessionDir)) {
      logger.debug(`[SessionManager] Session directory does not exist: ${sessionDir}`);
      return null;
    }

    return {
      controlDir: sessionDir,
      stdoutPath: path.join(sessionDir, 'stdout'),
      stdinPath: path.join(sessionDir, 'stdin'),
      sessionJsonPath: path.join(sessionDir, 'session.json'),
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
              logger.debug(
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
