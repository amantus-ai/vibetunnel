import { exec } from 'child_process';
import { promisify } from 'util';
import { type SessionCreateOptions, TitleMode } from '../../shared/types.js';
import type { PtyManager } from '../pty/pty-manager.js';
import { createLogger } from '../utils/logger.js';

const execAsync = promisify(exec);
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
      await execAsync('which zellij', { shell: '/bin/sh' });
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
      const { stdout } = await execAsync('zellij list-sessions', { shell: '/bin/sh' });

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
        // Example: "my-session [EXITED]" or "active-session"
        const exited = line.includes('[EXITED]');
        const name = line.replace('[EXITED]', '').trim();

        if (name) {
          sessions.push({
            name,
            created: 'unknown', // Zellij doesn't provide creation time in list
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
   */
  async createSession(name: string, layout?: string): Promise<void> {
    try {
      const layoutArg = layout ? `-l ${layout}` : '';
      await execAsync(`zellij -s '${name}' ${layoutArg}`, { shell: '/bin/sh' });
      logger.info('Created zellij session', { name, layout });
    } catch (error) {
      logger.error('Failed to create zellij session', { name, error });
      throw error;
    }
  }

  /**
   * Attach to a zellij session through VibeTunnel
   */
  async attachToZellij(
    sessionName: string,
    options?: Partial<SessionCreateOptions>
  ): Promise<string> {
    // Zellij attach command
    const zellijCommand = ['zellij', 'attach', sessionName];

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
    try {
      await execAsync(`zellij kill-session '${sessionName}'`, { shell: '/bin/sh' });
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
    try {
      await execAsync(`zellij delete-session '${sessionName}'`, { shell: '/bin/sh' });
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
