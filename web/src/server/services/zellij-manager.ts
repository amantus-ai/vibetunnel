import { execFile } from 'child_process';
import { promisify } from 'util';
import { type SessionCreateOptions, TitleMode } from '../../shared/types.js';
import type { PtyManager } from '../pty/pty-manager.js';
import { createLogger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);
const logger = createLogger('ZellijManager');

export interface ZellijSession {
  name: string;
  created: string;
  exited: boolean;
}

export class ZellijManager {
  private static instance: ZellijManager;
  private ptyManager: PtyManager;

  private constructor(ptyManager: PtyManager) {
    this.ptyManager = ptyManager;
  }

  /**
   * Validate session name to prevent command injection
   */
  private validateSessionName(name: string): void {
    if (!name || typeof name !== 'string') {
      throw new Error('Session name must be a non-empty string');
    }
    // Only allow alphanumeric, dash, underscore, and dot
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
      throw new Error(
        'Session name can only contain letters, numbers, dots, dashes, and underscores'
      );
    }
    if (name.length > 100) {
      throw new Error('Session name too long (max 100 characters)');
    }
  }

  /**
   * Strip ANSI escape codes from text
   */
  private stripAnsiCodes(text: string): string {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes contain control characters
    return text.replace(/\x1b\[[0-9;]*m/g, '');
  }

  static getInstance(ptyManager: PtyManager): ZellijManager {
    if (!ZellijManager.instance) {
      ZellijManager.instance = new ZellijManager(ptyManager);
    }
    return ZellijManager.instance;
  }

  /**
   * Check if zellij is installed and available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync('which', ['zellij']);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all zellij sessions
   */
  async listSessions(): Promise<ZellijSession[]> {
    try {
      const { stdout } = await execFileAsync('zellij', ['list-sessions']);

      if (stdout.includes('No active zellij sessions found')) {
        return [];
      }

      // Parse zellij session output
      // Format: SESSION NAME [EXITED] (CREATED)
      const sessions: ZellijSession[] = [];
      const lines = stdout
        .trim()
        .split('\n')
        .filter((line) => line.trim());

      for (const line of lines) {
        // Strip ANSI codes first
        const cleanLine = this.stripAnsiCodes(line).trim();

        if (!cleanLine) continue;

        // Parse session info
        // Format: "session-name [Created 15s ago]" or "session-name [EXITED] [Created 1h ago]"
        const exited = cleanLine.includes('[EXITED]');

        // Extract session name (everything before the first [)
        const nameMatch = cleanLine.match(/^([^[]+)/);
        if (!nameMatch) continue;

        const name = nameMatch[1].trim();

        // Extract created time if available
        const createdMatch = cleanLine.match(/\[Created ([^\]]+)\]/);
        const created = createdMatch ? createdMatch[1] : 'unknown';

        if (name) {
          sessions.push({
            name,
            created,
            exited,
          });
        }
      }

      return sessions;
    } catch (error) {
      if (error instanceof Error && error.message.includes('No active zellij sessions found')) {
        return [];
      }
      logger.error('Failed to list zellij sessions', { error });
      throw error;
    }
  }

  /**
   * Get tabs for a session (requires being attached to query)
   * Note: Zellij doesn't provide a way to query tabs without being attached
   */
  async getSessionTabs(sessionName: string): Promise<string[]> {
    // This would need to be run inside the session
    // For now, return empty as we can't query from outside
    logger.warn('Cannot query tabs for zellij session from outside', { sessionName });
    return [];
  }

  /**
   * Create a new zellij session
   * Note: Zellij requires a terminal, so we create sessions through attachToZellij instead
   */
  async createSession(name: string, layout?: string): Promise<void> {
    // Zellij can't create detached sessions like tmux
    // Sessions are created when attaching to them
    logger.info('Zellij session will be created on first attach', { name, layout });

    // Store the layout preference if provided
    if (layout) {
      // We could store this in a temporary map or config file
      // For now, we'll just log it
      logger.info('Layout preference noted for session', { name, layout });
    }
  }

  /**
   * Attach to a zellij session through VibeTunnel
   */
  async attachToZellij(
    sessionName: string,
    options?: Partial<SessionCreateOptions> & { layout?: string }
  ): Promise<string> {
    // Zellij attach command with -c flag to create if doesn't exist
    const zellijCommand = ['zellij', 'attach', '-c', sessionName];

    // Add layout if provided and session doesn't exist yet
    if (options?.layout) {
      const sessions = await this.listSessions();
      const sessionExists = sessions.some((s) => s.name === sessionName && !s.exited);
      if (!sessionExists) {
        zellijCommand.push('-l', options.layout);
      }
    }

    // Create a new VibeTunnel session that runs zellij attach
    const sessionOptions: SessionCreateOptions = {
      name: `zellij: ${sessionName}`,
      workingDir: options?.workingDir || process.env.HOME || '/',
      cols: options?.cols || 80,
      rows: options?.rows || 24,
      titleMode: options?.titleMode || TitleMode.DYNAMIC,
    };

    const session = await this.ptyManager.createSession(zellijCommand, sessionOptions);
    return session.sessionId;
  }

  /**
   * Kill a zellij session
   */
  async killSession(sessionName: string): Promise<void> {
    this.validateSessionName(sessionName);

    try {
      // Use delete-session with --force flag to handle both running and exited sessions
      await execFileAsync('zellij', ['delete-session', '--force', sessionName]);
      logger.info('Killed zellij session', { sessionName });
    } catch (error) {
      logger.error('Failed to kill zellij session', { sessionName, error });
      throw error;
    }
  }

  /**
   * Delete a zellij session
   */
  async deleteSession(sessionName: string): Promise<void> {
    this.validateSessionName(sessionName);

    try {
      await execFileAsync('zellij', ['delete-session', sessionName]);
      logger.info('Deleted zellij session', { sessionName });
    } catch (error) {
      logger.error('Failed to delete zellij session', { sessionName, error });
      throw error;
    }
  }

  /**
   * Check if inside a zellij session
   */
  isInsideZellij(): boolean {
    return !!process.env.ZELLIJ;
  }

  /**
   * Get the current zellij session name if inside zellij
   */
  getCurrentSession(): string | null {
    if (!this.isInsideZellij()) {
      return null;
    }
    return process.env.ZELLIJ_SESSION_NAME || null;
  }
}
