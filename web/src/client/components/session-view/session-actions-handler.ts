/**
 * SessionActionsHandler
 *
 * Handles all session-related actions including:
 * - Session renaming
 * - Session termination
 * - Session clearing
 * - View mode toggling (terminal vs worktree)
 */
import type { Session } from '../../../shared/types.js';
import { authClient } from '../../services/auth-client.js';
import { sessionActionService } from '../../services/session-action-service.js';
import { createLogger } from '../../utils/logger.js';
import { renameSession } from '../../utils/session-actions.js';
import { titleManager } from '../../utils/title-manager.js';

const logger = createLogger('session-actions-handler');

export interface SessionActionsCallbacks {
  getSession: () => Session | null;
  setSession: (session: Session) => void;
  getViewMode: () => 'terminal' | 'worktree';
  setViewMode: (mode: 'terminal' | 'worktree') => void;
  dispatchEvent: (event: Event) => boolean;
  requestUpdate: () => void;
  handleBack: () => void;
  ensureTerminalInitialized: () => void;
}

export class SessionActionsHandler {
  private callbacks: SessionActionsCallbacks | null = null;

  setCallbacks(callbacks: SessionActionsCallbacks): void {
    this.callbacks = callbacks;
  }

  async handleRename(sessionId: string, newName: string): Promise<void> {
    if (!this.callbacks) return;

    const session = this.callbacks.getSession();
    if (!session || sessionId !== session.id) return;

    const result = await renameSession(sessionId, newName, authClient);

    if (result.success) {
      // Note: We're using newName here as the server doesn't return the actual name
      // in our current implementation. This matches the existing behavior.
      const actualName = newName;

      // Update the local session object with the new name
      this.callbacks.setSession({ ...session, name: actualName });

      // Update the page title with the new session name
      const sessionName = actualName || session.command.join(' ');
      titleManager.setSessionTitle(sessionName);

      // Dispatch event to notify parent components
      this.callbacks.dispatchEvent(
        new CustomEvent('session-renamed', {
          detail: { sessionId, newName: actualName },
          bubbles: true,
          composed: true,
        })
      );

      logger.log(`Session ${sessionId} renamed to: ${actualName}`);
    } else {
      // Show error to user
      this.callbacks.dispatchEvent(
        new CustomEvent('error', {
          detail: `Failed to rename session: ${result.error}`,
          bubbles: true,
          composed: true,
        })
      );
    }
  }

  async handleTerminateSession(): Promise<void> {
    if (!this.callbacks) return;

    const session = this.callbacks.getSession();
    if (!session) return;

    await sessionActionService.terminateSession(session, {
      authClient: authClient,
      callbacks: {
        onError: (message: string) => {
          if (this.callbacks) {
            this.callbacks.dispatchEvent(
              new CustomEvent('error', {
                detail: message,
                bubbles: true,
                composed: true,
              })
            );
          }
        },
        onSuccess: () => {
          // For terminate, session status will be updated via SSE
        },
      },
    });
  }

  async handleClearSession(): Promise<void> {
    if (!this.callbacks) return;

    const session = this.callbacks.getSession();
    if (!session) return;

    await sessionActionService.clearSession(session, {
      authClient: authClient,
      callbacks: {
        onError: (message: string) => {
          if (this.callbacks) {
            this.callbacks.dispatchEvent(
              new CustomEvent('error', {
                detail: message,
                bubbles: true,
                composed: true,
              })
            );
          }
        },
        onSuccess: () => {
          // Session cleared successfully - navigate back to list
          if (this.callbacks) {
            this.callbacks.handleBack();
          }
        },
      },
    });
  }

  handleToggleViewMode(): void {
    if (!this.callbacks) return;

    const session = this.callbacks.getSession();
    if (!session?.gitRepoPath) return;

    const currentMode = this.callbacks.getViewMode();
    const newMode = currentMode === 'terminal' ? 'worktree' : 'terminal';
    this.callbacks.setViewMode(newMode);

    // Update managers for view mode change
    if (newMode === 'terminal') {
      // Re-initialize terminal when switching back
      requestAnimationFrame(() => {
        this.callbacks?.ensureTerminalInitialized();
      });
    }
  }

  handleSessionExit(sessionId: string, exitCode?: number): void {
    if (!this.callbacks) return;

    const session = this.callbacks.getSession();
    if (!session || sessionId !== session.id) return;

    logger.log('Session exit event received', { sessionId, exitCode });

    // Update session status to exited
    this.callbacks.setSession({ ...session, status: 'exited' });
    this.callbacks.requestUpdate();

    // Notify parent app that session status changed so it can refresh the session list
    this.callbacks.dispatchEvent(
      new CustomEvent('session-status-changed', {
        detail: {
          sessionId: session.id,
          newStatus: 'exited',
          exitCode: exitCode,
        },
        bubbles: true,
      })
    );

    // Check if this window should auto-close
    // Only attempt to close if we're on a session-specific URL
    const urlParams = new URLSearchParams(window.location.search);
    const sessionParam = urlParams.get('session');

    if (sessionParam === sessionId) {
      // This window was opened specifically for this session
      logger.log(`Session ${sessionId} exited, attempting to close window`);

      // Try to close the window
      // This will work for:
      // 1. Windows opened via window.open() from JavaScript
      // 2. Windows where the user has granted permission
      // It won't work for regular browser tabs, which is fine
      setTimeout(() => {
        try {
          window.close();

          // If window.close() didn't work (we're still here after 100ms),
          // show a message to the user
          setTimeout(() => {
            logger.log('Window close failed - likely opened as a regular tab');
          }, 100);
        } catch (e) {
          logger.warn('Failed to close window:', e);
        }
      }, 500); // Give user time to see the "exited" status
    }
  }

  // Check if worktree view is available
  canToggleViewMode(session: Session | null): boolean {
    return !!session?.gitRepoPath;
  }
}
