import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import type { TmuxPane, TmuxSession, TmuxWindow } from '../../shared/tmux-types.js';
import { type SessionCreateOptions, TitleMode } from '../../shared/types.js';
import type { PtyManager } from '../pty/pty-manager.js';
import { createLogger } from '../utils/logger.js';

const execAsync = promisify(exec);
const logger = createLogger('TmuxManager');

export class TmuxManager {
  private static instance: TmuxManager;
  private ptyManager: PtyManager;

  private constructor(ptyManager: PtyManager) {
    this.ptyManager = ptyManager;
  }

  static getInstance(ptyManager: PtyManager): TmuxManager {
    if (!TmuxManager.instance) {
      TmuxManager.instance = new TmuxManager(ptyManager);
    }
    return TmuxManager.instance;
  }

  /**
   * Check if tmux is installed and available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('which tmux', { shell: '/bin/sh' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all tmux sessions
   */
  async listSessions(): Promise<TmuxSession[]> {
    try {
      const { stdout } = await execAsync(
        "tmux list-sessions -F '#{session_name}|#{session_windows}|#{session_created}|#{?session_attached,attached,detached}|#{session_activity}|#{?session_active,active,}'",
        { shell: '/bin/sh' }
      );

      return stdout
        .trim()
        .split('\n')
        .filter((line) => line?.includes('|'))
        .map((line) => {
          // Handle potential shell output pollution
          const pipeIndex = line.indexOf('|');
          if (pipeIndex > 0 && !line.substring(0, pipeIndex).match(/^[a-zA-Z0-9_-]+$/)) {
            // If there's non-alphanumeric content before the first pipe, find the session name
            const match = line.match(/([a-zA-Z0-9_-]+)\|/);
            if (match) {
              line = line.substring(line.indexOf(match[0]));
            }
          }

          const [name, windows, created, attached, activity, current] = line.split('|');
          return {
            name,
            windows: Number.parseInt(windows, 10),
            created,
            attached: attached === 'attached',
            activity,
            current: current === 'active',
          };
        });
    } catch (error) {
      if (error instanceof Error && error.message.includes('no server running')) {
        return [];
      }
      throw error;
    }
  }

  /**
   * List windows in a tmux session
   */
  async listWindows(sessionName: string): Promise<TmuxWindow[]> {
    try {
      const { stdout } = await execAsync(
        `tmux list-windows -t '${sessionName}' -F '#{session_name}|#{window_index}|#{window_name}|#{?window_active,active,}|#{window_panes}'`,
        { shell: '/bin/sh' }
      );

      return stdout
        .trim()
        .split('\n')
        .filter((line) => line)
        .map((line) => {
          const [session, index, name, active, panes] = line.split('|');
          return {
            session,
            index: Number.parseInt(index, 10),
            name,
            active: active === 'active',
            panes: Number.parseInt(panes, 10),
          };
        });
    } catch (error) {
      logger.error('Failed to list windows', { sessionName, error });
      throw error;
    }
  }

  /**
   * List panes in a window
   */
  async listPanes(sessionName: string, windowIndex?: number): Promise<TmuxPane[]> {
    try {
      const target = windowIndex !== undefined ? `${sessionName}:${windowIndex}` : sessionName;

      const { stdout } = await execAsync(
        `tmux list-panes -t '${target}' -F '#{session_name}|#{window_index}|#{pane_index}|#{?pane_active,active,}|#{pane_title}|#{pane_pid}|#{pane_current_command}|#{pane_width}|#{pane_height}|#{pane_current_path}'`,
        { shell: '/bin/sh' }
      );

      return stdout
        .trim()
        .split('\n')
        .filter((line) => line)
        .map((line) => {
          const [session, window, index, active, title, pid, command, width, height, currentPath] =
            line.split('|');
          return {
            session,
            window: Number.parseInt(window, 10),
            index: Number.parseInt(index, 10),
            active: active === 'active',
            title: title || undefined,
            pid: pid ? Number.parseInt(pid, 10) : undefined,
            command: command || undefined,
            width: Number.parseInt(width, 10),
            height: Number.parseInt(height, 10),
            currentPath: currentPath || undefined,
          };
        });
    } catch (error) {
      logger.error('Failed to list panes', { sessionName, windowIndex, error });
      throw error;
    }
  }

  /**
   * Create a new tmux session
   */
  async createSession(name: string, command?: string[]): Promise<void> {
    try {
      const cmd = command ? command.join(' ') : '';
      await execAsync(`tmux new-session -d -s '${name}' ${cmd}`);
      logger.info('Created tmux session', { name, command });
    } catch (error) {
      logger.error('Failed to create tmux session', { name, error });
      throw error;
    }
  }

  /**
   * Attach to a tmux session/window/pane through VibeTunnel
   */
  async attachToTmux(
    sessionName: string,
    windowIndex?: number,
    paneIndex?: number,
    options?: Partial<SessionCreateOptions>
  ): Promise<string> {
    let target = sessionName;
    if (windowIndex !== undefined) {
      target = `${sessionName}:${windowIndex}`;
      if (paneIndex !== undefined) {
        target = `${target}.${paneIndex}`;
      }
    }

    // Always attach to session/window level, not individual panes
    // This gives users full control over pane management once attached
    const attachTarget = windowIndex !== undefined ? `${sessionName}:${windowIndex}` : sessionName;
    const tmuxCommand = ['tmux', 'attach-session', '-t', attachTarget];

    // Create a new VibeTunnel session that runs tmux attach
    const sessionOptions: SessionCreateOptions = {
      name: `tmux: ${target}`,
      workingDir: options?.workingDir || process.env.HOME || '/',
      cols: options?.cols || 80,
      rows: options?.rows || 24,
      titleMode: options?.titleMode || TitleMode.DYNAMIC,
    };

    const session = await this.ptyManager.createSession(tmuxCommand, sessionOptions);
    return session.sessionId;
  }

  /**
   * Send a command to a specific tmux pane
   */
  async sendToPane(
    sessionName: string,
    command: string,
    windowIndex?: number,
    paneIndex?: number
  ): Promise<void> {
    let target = sessionName;
    if (windowIndex !== undefined) {
      target = `${sessionName}:${windowIndex}`;
      if (paneIndex !== undefined) {
        target = `${target}.${paneIndex}`;
      }
    }

    try {
      // Use send-keys to send the command
      await execAsync(`tmux send-keys -t '${target}' '${command}' Enter`);
      logger.info('Sent command to tmux pane', { target, command });
    } catch (error) {
      logger.error('Failed to send command to tmux pane', { target, command, error });
      throw error;
    }
  }

  /**
   * Kill a tmux session
   */
  async killSession(sessionName: string): Promise<void> {
    try {
      await execAsync(`tmux kill-session -t '${sessionName}'`);
      logger.info('Killed tmux session', { sessionName });
    } catch (error) {
      logger.error('Failed to kill tmux session', { sessionName, error });
      throw error;
    }
  }

  /**
   * Check if inside a tmux session
   */
  isInsideTmux(): boolean {
    return !!process.env.TMUX;
  }

  /**
   * Get the current tmux session name if inside tmux
   */
  getCurrentSession(): string | null {
    if (!this.isInsideTmux()) {
      return null;
    }
    try {
      const result = execSync('tmux display-message -p "#{session_name}"', { encoding: 'utf8' });
      return result.trim();
    } catch {
      return null;
    }
  }
}
