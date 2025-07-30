import { execFile } from 'child_process';
import { promisify } from 'util';
import type { MultiplexerSession } from '../../shared/multiplexer-types.js';
import { createLogger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);
const logger = createLogger('screen-manager');

/**
 * GNU Screen manager for terminal multiplexing
 *
 * Note: GNU Screen has a simpler model than tmux:
 * - Sessions (like tmux sessions)
 * - Windows (like tmux windows)
 * - No panes concept (screen uses split regions but they're not addressable like tmux panes)
 */
export class ScreenManager {
  private static instance: ScreenManager;

  static getInstance(): ScreenManager {
    if (!ScreenManager.instance) {
      ScreenManager.instance = new ScreenManager();
    }
    return ScreenManager.instance;
  }

  /**
   * Validate session name to prevent command injection
   */
  private validateSessionName(name: string): void {
    if (!name || typeof name !== 'string') {
      throw new Error('Session name must be a non-empty string');
    }
    // Allow dots for screen sessions (PID.name format), but still restrict dangerous chars
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
   * Validate window index
   */
  private validateWindowIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index > 999) {
      throw new Error('Window index must be an integer between 0 and 999');
    }
  }

  /**
   * Check if screen is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync('which', ['screen']);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all screen sessions
   * Screen output format: <pid>.<sessionname>\t(<status>)
   * Example: 12345.my-session	(Detached)
   */
  async listSessions(): Promise<MultiplexerSession[]> {
    try {
      const { stdout } = await execFileAsync('screen', ['-ls']).catch((error) => {
        // Screen returns exit code 1 when there are sessions (non-zero means "has sessions")
        // We need to check the output to determine if it's a real error
        if (error.stdout && !error.stdout.includes('No Sockets found')) {
          return { stdout: error.stdout, stderr: error.stderr };
        }
        throw error;
      });

      const lines = stdout.split('\n');
      const sessions: MultiplexerSession[] = [];

      for (const line of lines) {
        // Match lines like: 12345.session-name	(Detached)
        // Note: session name may contain dots, so we match until tab character
        const match = line.match(/^\s*(\d+)\.([^\t]+)\s*\t\s*\(([^)]+)\)/);
        if (match) {
          const [, pid, name, status] = match;
          sessions.push({
            name: `${pid}.${name}`, // Use full name including PID for uniqueness
            type: 'screen',
            attached: status.toLowerCase().includes('attached'),
            exited: status.toLowerCase().includes('dead'),
            // Screen doesn't provide window count in list output
          });
        }
      }

      return sessions;
    } catch (error) {
      // If no sessions exist, screen returns "No Sockets found"
      if (
        error instanceof Error &&
        'stdout' in error &&
        typeof error.stdout === 'string' &&
        error.stdout.includes('No Sockets found')
      ) {
        return [];
      }
      logger.error('Failed to list screen sessions', { error });
      throw error;
    }
  }

  /**
   * Create a new screen session
   */
  async createSession(sessionName: string, command?: string): Promise<void> {
    this.validateSessionName(sessionName);

    try {
      // Remove PID prefix if present (for creating new sessions)
      const cleanName = sessionName.includes('.')
        ? sessionName.split('.').slice(1).join('.')
        : sessionName;

      const args = ['screen', '-dmS', cleanName];

      // If command is provided, validate and add it
      if (command) {
        if (typeof command !== 'string') {
          throw new Error('Command must be a string');
        }
        // For screen, we need to pass the command as a single argument
        // Screen expects the command and its args as separate elements
        args.push(command);
      }

      await execFileAsync(args[0], args.slice(1));
      logger.info('Created screen session', { sessionName: cleanName });
    } catch (error) {
      logger.error('Failed to create screen session', { sessionName, error });
      throw error;
    }
  }

  /**
   * Attach to a screen session
   * For programmatic use, we'll create a new window in the session
   */
  async attachToSession(sessionName: string, command?: string): Promise<string[]> {
    try {
      // For newly created sessions, we might need to wait a bit or handle differently
      // First check if this looks like a full session name with PID
      const isFullName = /^\d+\./.test(sessionName);

      if (!isFullName) {
        // This is a simple name, we need to find the full name with PID
        const sessions = await this.listSessions();
        const session = sessions.find((s) => {
          // Check if the session name ends with our provided name
          const parts = s.name.split('.');
          const simpleName = parts.slice(1).join('.');
          return simpleName === sessionName;
        });

        if (session) {
          sessionName = session.name;
        } else {
          // Session might have just been created, use -R flag which is more forgiving
          return ['screen', '-R', sessionName];
        }
      }

      // Create a new window in the session if command is provided
      if (command) {
        if (typeof command !== 'string') {
          throw new Error('Command must be a string');
        }
        await execFileAsync('screen', ['-S', sessionName, '-X', 'screen', command]);
      }

      // Return a command array that can be used to attach
      // Use -r for existing sessions with full name
      return ['screen', '-r', sessionName];
    } catch (error) {
      logger.error('Failed to attach to screen session', { sessionName, error });
      throw error;
    }
  }

  /**
   * Kill a screen session
   */
  async killSession(sessionName: string): Promise<void> {
    this.validateSessionName(sessionName);

    try {
      // Screen can be killed using the full name with PID or just the PID
      await execFileAsync('screen', ['-S', sessionName, '-X', 'quit']);
      logger.info('Killed screen session', { sessionName });
    } catch (error) {
      logger.error('Failed to kill screen session', { sessionName, error });
      throw error;
    }
  }

  /**
   * Check if inside a screen session
   */
  isInsideScreen(): boolean {
    return !!process.env.STY;
  }

  /**
   * Get the current screen session name if inside screen
   */
  getCurrentSession(): string | null {
    const sty = process.env.STY;
    if (!sty) return null;

    // STY format is pid.sessionname or pid.tty.host
    const parts = sty.split('.');
    if (parts.length >= 2) {
      return parts.slice(1).join('.');
    }
    return null;
  }

  /**
   * List windows in a screen session
   * Note: This is more limited than tmux - screen doesn't provide easy machine-readable output
   */
  async listWindows(sessionName: string): Promise<Array<{ index: number; name: string }>> {
    try {
      // Screen doesn't have a good way to list windows programmatically
      // We could parse the windowlist output but it's not reliable
      // For now, return empty array
      logger.warn('Window listing not fully implemented for screen');
      return [];
    } catch (error) {
      logger.error('Failed to list screen windows', { sessionName, error });
      return [];
    }
  }

  /**
   * Create a new window in a screen session
   */
  async createWindow(sessionName: string, windowName?: string, command?: string): Promise<void> {
    this.validateSessionName(sessionName);

    try {
      const args = ['screen', '-S', sessionName, '-X', 'screen'];

      if (windowName) {
        if (typeof windowName !== 'string' || windowName.length > 50) {
          throw new Error('Window name must be a string (max 50 characters)');
        }
        args.push('-t', windowName);
      }

      if (command) {
        if (typeof command !== 'string') {
          throw new Error('Command must be a string');
        }
        args.push(command);
      }

      await execFileAsync(args[0], args.slice(1));
      logger.info('Created window in screen session', { sessionName, windowName });
    } catch (error) {
      logger.error('Failed to create window', { sessionName, windowName, error });
      throw error;
    }
  }

  /**
   * Kill a window in a screen session
   * Note: Screen uses window numbers, not names for targeting
   */
  async killWindow(sessionName: string, windowIndex: number): Promise<void> {
    this.validateSessionName(sessionName);
    this.validateWindowIndex(windowIndex);

    try {
      // First select the window, then kill it
      await execFileAsync('screen', ['-S', sessionName, '-p', String(windowIndex), '-X', 'kill']);
      logger.info('Killed window in screen session', { sessionName, windowIndex });
    } catch (error) {
      logger.error('Failed to kill window', { sessionName, windowIndex, error });
      throw error;
    }
  }
}
