import type { TmuxPane, TmuxWindow } from '../../shared/tmux-types.js';
import type { SessionCreateOptions } from '../../shared/types.js';
import type { PtyManager } from '../pty/pty-manager.js';
import { createLogger } from '../utils/logger.js';
import { TmuxManager } from './tmux-manager.js';
import { ZellijManager } from './zellij-manager.js';

const logger = createLogger('MultiplexerManager');

export type MultiplexerType = 'tmux' | 'zellij';

export interface MultiplexerSession {
  name: string;
  type: MultiplexerType;
  windows?: number; // tmux specific
  created?: string;
  attached?: boolean; // tmux specific
  exited?: boolean; // zellij specific
  activity?: string; // tmux specific
  current?: boolean; // tmux specific
}

export interface MultiplexerInfo {
  available: boolean;
  type: MultiplexerType;
  sessions: MultiplexerSession[];
}

export class MultiplexerManager {
  private static instance: MultiplexerManager;
  private tmuxManager: TmuxManager;
  private zellijManager: ZellijManager;

  private constructor(ptyManager: PtyManager) {
    this.tmuxManager = TmuxManager.getInstance(ptyManager);
    this.zellijManager = ZellijManager.getInstance(ptyManager);
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
  async getAvailableMultiplexers(): Promise<{
    tmux: MultiplexerInfo;
    zellij: MultiplexerInfo;
  }> {
    const [tmuxAvailable, zellijAvailable] = await Promise.all([
      this.tmuxManager.isAvailable(),
      this.zellijManager.isAvailable(),
    ]);

    const result = {
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
  async createSession(type: MultiplexerType, name: string, options?: any): Promise<void> {
    if (type === 'tmux') {
      await this.tmuxManager.createSession(name, options?.command);
    } else if (type === 'zellij') {
      await this.zellijManager.createSession(name, options?.layout);
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

    return null;
  }
}
