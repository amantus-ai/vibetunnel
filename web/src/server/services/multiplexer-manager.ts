import type {
  MultiplexerSession,
  MultiplexerStatus,
  MultiplexerType,
  TmuxPane,
  TmuxWindow,
} from '../../shared/multiplexer-types.js';
import type { SessionCreateOptions } from '../../shared/types.js';
import { TitleMode } from '../../shared/types.js';
import type { PtyManager } from '../pty/pty-manager.js';
import { createLogger } from '../utils/logger.js';
import { ScreenManager } from './screen-manager.js';
import { TmuxManager } from './tmux-manager.js';
import { ZellijManager } from './zellij-manager.js';

const logger = createLogger('MultiplexerManager');

export class MultiplexerManager {
  private static instance: MultiplexerManager;
  private tmuxManager: TmuxManager;
  private zellijManager: ZellijManager;
  private screenManager: ScreenManager;
  private ptyManager: PtyManager;

  private constructor(ptyManager: PtyManager) {
    this.ptyManager = ptyManager;
    this.tmuxManager = TmuxManager.getInstance(ptyManager);
    this.zellijManager = ZellijManager.getInstance(ptyManager);
    this.screenManager = ScreenManager.getInstance();
  }

  static getInstance(ptyManager: PtyManager): MultiplexerManager {
    if (!MultiplexerManager.instance) {
      MultiplexerManager.instance = new MultiplexerManager(ptyManager);
    }
    return MultiplexerManager.instance;
  }

  /**
   * Get available multiplexers and their sessions
   */
  async getAvailableMultiplexers(): Promise<MultiplexerStatus> {
    const [tmuxAvailable, zellijAvailable, screenAvailable] = await Promise.all([
      this.tmuxManager.isAvailable(),
      this.zellijManager.isAvailable(),
      this.screenManager.isAvailable(),
    ]);

    const result: MultiplexerStatus = {
      tmux: {
        available: tmuxAvailable,
        type: 'tmux' as MultiplexerType,
        sessions: [] as MultiplexerSession[],
      },
      zellij: {
        available: zellijAvailable,
        type: 'zellij' as MultiplexerType,
        sessions: [] as MultiplexerSession[],
      },
      screen: {
        available: screenAvailable,
        type: 'screen' as MultiplexerType,
        sessions: [] as MultiplexerSession[],
      },
    };

    // Load sessions for available multiplexers
    if (tmuxAvailable) {
      try {
        const tmuxSessions = await this.tmuxManager.listSessions();
        result.tmux.sessions = tmuxSessions.map((session) => ({
          ...session,
          type: 'tmux' as MultiplexerType,
        }));
      } catch (error) {
        logger.error('Failed to list tmux sessions', { error });
      }
    }

    if (zellijAvailable) {
      try {
        const zellijSessions = await this.zellijManager.listSessions();
        result.zellij.sessions = zellijSessions.map((session) => ({
          ...session,
          type: 'zellij' as MultiplexerType,
        }));
      } catch (error) {
        logger.error('Failed to list zellij sessions', { error });
      }
    }

    if (screenAvailable) {
      try {
        const screenSessions = await this.screenManager.listSessions();
        result.screen.sessions = screenSessions.map((session) => ({
          ...session,
          type: 'screen' as MultiplexerType,
        }));
      } catch (error) {
        logger.error('Failed to list screen sessions', { error });
      }
    }

    return result;
  }

  /**
   * Get windows for a tmux session
   */
  async getTmuxWindows(sessionName: string): Promise<TmuxWindow[]> {
    return this.tmuxManager.listWindows(sessionName);
  }

  /**
   * Get panes for a tmux window
   */
  async getTmuxPanes(sessionName: string, windowIndex?: number): Promise<TmuxPane[]> {
    return this.tmuxManager.listPanes(sessionName, windowIndex);
  }

  /**
   * Create a new session
   */
  async createSession(
    type: MultiplexerType,
    name: string,
    options?: { command?: string[]; layout?: string }
  ): Promise<void> {
    if (type === 'tmux') {
      await this.tmuxManager.createSession(name, options?.command);
    } else if (type === 'zellij') {
      await this.zellijManager.createSession(name, options?.layout);
    } else if (type === 'screen') {
      // Screen expects a single command string, not an array
      const command = options?.command ? options.command.join(' ') : undefined;
      await this.screenManager.createSession(name, command);
    } else {
      throw new Error(`Unknown multiplexer type: ${type}`);
    }
  }

  /**
   * Attach to a session
   */
  async attachToSession(
    type: MultiplexerType,
    sessionName: string,
    options?: Partial<SessionCreateOptions> & { windowIndex?: number; paneIndex?: number }
  ): Promise<string> {
    if (type === 'tmux') {
      return this.tmuxManager.attachToTmux(
        sessionName,
        options?.windowIndex,
        options?.paneIndex,
        options
      );
    } else if (type === 'zellij') {
      return this.zellijManager.attachToZellij(sessionName, options);
    } else if (type === 'screen') {
      // Screen doesn't support programmatic attach like tmux/zellij
      // We need to create a new session that runs the attach command
      const attachCmd = await this.screenManager.attachToSession(sessionName);
      // Create a new PTY session that will run the screen attach command
      const result = await this.ptyManager.createSession(attachCmd, {
        ...options,
        titleMode: options?.titleMode ?? TitleMode.STATIC,
      });
      return result.sessionId;
    } else {
      throw new Error(`Unknown multiplexer type: ${type}`);
    }
  }

  /**
   * Kill/delete a session
   */
  async killSession(type: MultiplexerType, sessionName: string): Promise<void> {
    if (type === 'tmux') {
      await this.tmuxManager.killSession(sessionName);
    } else if (type === 'zellij') {
      await this.zellijManager.killSession(sessionName);
    } else if (type === 'screen') {
      await this.screenManager.killSession(sessionName);
    } else {
      throw new Error(`Unknown multiplexer type: ${type}`);
    }
  }

  /**
   * Kill a tmux window
   */
  async killTmuxWindow(sessionName: string, windowIndex: number): Promise<void> {
    await this.tmuxManager.killWindow(sessionName, windowIndex);
  }

  /**
   * Kill a tmux pane
   */
  async killTmuxPane(sessionName: string, paneId: string): Promise<void> {
    await this.tmuxManager.killPane(sessionName, paneId);
  }

  /**
   * Check which multiplexer we're currently inside
   */
  getCurrentMultiplexer(): { type: MultiplexerType; session: string } | null {
    if (this.tmuxManager.isInsideTmux()) {
      const session = this.tmuxManager.getCurrentSession();
      if (session) {
        return { type: 'tmux', session };
      }
    }

    if (this.zellijManager.isInsideZellij()) {
      const session = this.zellijManager.getCurrentSession();
      if (session) {
        return { type: 'zellij', session };
      }
    }

    if (this.screenManager.isInsideScreen()) {
      const session = this.screenManager.getCurrentSession();
      if (session) {
        return { type: 'screen', session };
      }
    }

    return null;
  }
}
