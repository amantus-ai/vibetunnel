/**
 * Session Action Service
 *
 * A singleton service that manages session actions like terminate and clear,
 * coordinating with the auth client and handling UI updates through callbacks.
 * Reusable across session-view, session-list, and session-card components.
 */

import type { Session } from '../components/session-list.js';
import { createLogger } from '../utils/logger.js';
import type { SessionActionResult } from '../utils/session-actions.js';
import { terminateSession as terminateSessionUtil } from '../utils/session-actions.js';
import type { AuthClient } from './auth-client.js';

const logger = createLogger('session-action-service');

export interface SessionActionCallbacks {
  onError?: (message: string) => void;
  onSuccess?: (action: 'terminate' | 'clear', sessionId: string) => void;
}

export interface SessionActionOptions {
  authClient: AuthClient;
  callbacks?: SessionActionCallbacks;
}

class SessionActionService {
  private static instance: SessionActionService;

  private constructor() {
    logger.log('SessionActionService initialized');
  }

  static getInstance(): SessionActionService {
    if (!SessionActionService.instance) {
      SessionActionService.instance = new SessionActionService();
    }
    return SessionActionService.instance;
  }

  /**
   * Terminates a running session
   */
  async terminateSession(
    session: Session,
    options: SessionActionOptions
  ): Promise<SessionActionResult> {
    if (!session || session.status !== 'running') {
      logger.warn('Cannot terminate session: invalid state', { session });
      options.callbacks?.onError?.('Cannot terminate session: invalid state');
      return { success: false, error: 'Invalid session state' };
    }

    logger.debug('Terminating session', { sessionId: session.id });

    const result = await terminateSessionUtil(session.id, options.authClient, 'running');

    if (!result.success) {
      const errorMessage = `Failed to terminate session: ${result.error}`;
      logger.error(errorMessage, { sessionId: session.id, error: result.error });
      options.callbacks?.onError?.(errorMessage);
    } else {
      logger.log('Session terminated successfully', { sessionId: session.id });
      options.callbacks?.onSuccess?.('terminate', session.id);
      // Emit global event for other components to react
      window.dispatchEvent(
        new CustomEvent('session-action', {
          detail: {
            action: 'terminate',
            sessionId: session.id,
          },
        })
      );
    }

    return result;
  }

  /**
   * Clears an exited session
   */
  async clearSession(
    session: Session,
    options: SessionActionOptions
  ): Promise<SessionActionResult> {
    if (!session || session.status !== 'exited') {
      logger.warn('Cannot clear session: invalid state', { session });
      options.callbacks?.onError?.('Cannot clear session: invalid state');
      return { success: false, error: 'Invalid session state' };
    }

    logger.debug('Clearing session', { sessionId: session.id });

    const result = await terminateSessionUtil(session.id, options.authClient, 'exited');

    if (!result.success) {
      const errorMessage = `Failed to clear session: ${result.error}`;
      logger.error(errorMessage, { sessionId: session.id, error: result.error });
      options.callbacks?.onError?.(errorMessage);
    } else {
      logger.log('Session cleared successfully', { sessionId: session.id });
      options.callbacks?.onSuccess?.('clear', session.id);
      // Emit global event for other components to react
      window.dispatchEvent(
        new CustomEvent('session-action', {
          detail: {
            action: 'clear',
            sessionId: session.id,
          },
        })
      );
    }

    return result;
  }

  /**
   * Deletes a session (supports both running and exited sessions)
   * This is a unified method that calls terminate or clear based on status
   */
  async deleteSession(
    session: Session,
    options: SessionActionOptions
  ): Promise<SessionActionResult> {
    if (session.status === 'running') {
      return this.terminateSession(session, options);
    } else if (session.status === 'exited') {
      return this.clearSession(session, options);
    } else {
      const errorMessage = `Cannot delete session with status: ${session.status}`;
      logger.warn(errorMessage, { session });
      options.callbacks?.onError?.(errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Direct API call to delete a session by ID
   * Used when we don't have the full session object
   */
  async deleteSessionById(
    sessionId: string,
    options: SessionActionOptions
  ): Promise<SessionActionResult> {
    try {
      const response = await fetch(`/api/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: {
          ...options.authClient.getAuthHeader(),
        },
      });

      if (!response.ok) {
        const errorData = await response.text();
        logger.error('Failed to delete session', { errorData, sessionId });
        throw new Error(`Delete failed: ${response.status}`);
      }

      logger.log('Session deleted successfully', { sessionId });
      options.callbacks?.onSuccess?.('terminate', sessionId);

      // Emit global event
      window.dispatchEvent(
        new CustomEvent('session-action', {
          detail: {
            action: 'delete',
            sessionId,
          },
        })
      );

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error deleting session', { error, sessionId });
      options.callbacks?.onError?.(errorMessage);
      return { success: false, error: errorMessage };
    }
  }
}

// Export singleton instance
export const sessionActionService = SessionActionService.getInstance();
