/**
 * Session Action Service
 *
 * A singleton service that manages session actions like terminate and clear,
 * coordinating with the auth client and handling UI updates through callbacks.
 * Reusable across session-view, session-list, and session-card components.
 *
 * @remarks
 * This service provides a unified interface for session management operations,
 * emitting global events that other components can listen to for reactive updates.
 *
 * @example
 * ```typescript
 * // Get the singleton instance
 * const service = sessionActionService;
 *
 * // Terminate a running session
 * const result = await service.terminateSession(session, {
 *   authClient,
 *   callbacks: {
 *     onSuccess: (action, sessionId) => console.log(`${action} successful`),
 *     onError: (message) => console.error(message)
 *   }
 * });
 *
 * // Listen for session actions globally
 * window.addEventListener('session-action', (event) => {
 *   console.log(event.detail.action, event.detail.sessionId);
 * });
 * ```
 */

import type { Session } from '../../shared/types.js';
import { createLogger } from '../utils/logger.js';
import type { SessionActionResult } from '../utils/session-actions.js';
import { terminateSession as terminateSessionUtil } from '../utils/session-actions.js';
import type { AuthClient } from './auth-client.js';

const logger = createLogger('session-action-service');

/**
 * Callback functions for session action results
 *
 * @interface SessionActionCallbacks
 */
export interface SessionActionCallbacks {
  /**
   * Called when an error occurs during a session action
   * @param message - Human-readable error message
   */
  onError?: (message: string) => void;

  /**
   * Called when a session action completes successfully
   * @param action - The action that was performed ('terminate' or 'clear')
   * @param sessionId - The ID of the affected session
   */
  onSuccess?: (action: 'terminate' | 'clear', sessionId: string) => void;
}

/**
 * Options for session action operations
 *
 * @interface SessionActionOptions
 */
export interface SessionActionOptions {
  /**
   * AuthClient instance for API authentication
   */
  authClient: AuthClient;

  /**
   * Optional callbacks for handling action results
   */
  callbacks?: SessionActionCallbacks;
}

/**
 * Singleton service for managing session lifecycle actions
 *
 * @class SessionActionService
 * @singleton
 */
class SessionActionService {
  private static instance: SessionActionService;

  /**
   * Private constructor to enforce singleton pattern
   * @private
   */
  private constructor() {
    logger.log('SessionActionService initialized');
  }

  /**
   * Gets the singleton instance of SessionActionService
   *
   * @returns {SessionActionService} The singleton instance
   * @static
   *
   * @example
   * ```typescript
   * const service = SessionActionService.getInstance();
   * // or use the exported instance
   * import { sessionActionService } from './session-action-service.js';
   * ```
   */
  static getInstance(): SessionActionService {
    if (!SessionActionService.instance) {
      SessionActionService.instance = new SessionActionService();
    }
    return SessionActionService.instance;
  }

  /**
   * Terminates a running session
   *
   * @param {Session} session - The session to terminate (must have status 'running')
   * @param {SessionActionOptions} options - Options including auth client and callbacks
   * @returns {Promise<SessionActionResult>} Result indicating success or failure
   *
   * @remarks
   * - Only works on sessions with status 'running'
   * - Emits a 'session-action' event on window for global listeners
   * - Calls onSuccess callback with ('terminate', sessionId) on success
   * - Calls onError callback with error message on failure
   *
   * @example
   * ```typescript
   * const result = await service.terminateSession(runningSession, {
   *   authClient: myAuthClient,
   *   callbacks: {
   *     onSuccess: (action, id) => console.log(`Session ${id} terminated`),
   *     onError: (msg) => alert(msg)
   *   }
   * });
   *
   * if (result.success) {
   *   console.log('Termination successful');
   * } else {
   *   console.error('Failed:', result.error);
   * }
   * ```
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
      // Emit global event (only in browser environment) for other components to react (only in browser environment)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('session-action', {
            detail: {
              action: 'terminate',
              sessionId: session.id,
            },
          })
        );
      }
    }

    return result;
  }

  /**
   * Clears an exited session from the system
   *
   * @param {Session} session - The session to clear (must have status 'exited')
   * @param {SessionActionOptions} options - Options including auth client and callbacks
   * @returns {Promise<SessionActionResult>} Result indicating success or failure
   *
   * @remarks
   * - Only works on sessions with status 'exited'
   * - Removes the session record from the server
   * - Emits a 'session-action' event with action 'clear'
   * - Useful for cleaning up terminated sessions from the UI
   *
   * @example
   * ```typescript
   * const exitedSession = { ...session, status: 'exited' };
   * const result = await service.clearSession(exitedSession, {
   *   authClient,
   *   callbacks: {
   *     onSuccess: (action, id) => removeFromUI(id),
   *     onError: (msg) => showError(msg)
   *   }
   * });
   * ```
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
      // Emit global event for other components to react (only in browser environment)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('session-action', {
            detail: {
              action: 'clear',
              sessionId: session.id,
            },
          })
        );
      }
    }

    return result;
  }

  /**
   * Deletes a session regardless of its status
   *
   * @param {Session} session - The session to delete
   * @param {SessionActionOptions} options - Options including auth client and callbacks
   * @returns {Promise<SessionActionResult>} Result indicating success or failure
   *
   * @remarks
   * This is a unified method that intelligently handles different session states:
   * - For 'running' sessions: calls terminateSession()
   * - For 'exited' sessions: calls clearSession()
   * - For other statuses: returns an error
   *
   * This method is useful when you want to remove a session without
   * checking its status first.
   *
   * @example
   * ```typescript
   * // Delete any session without checking status
   * const result = await service.deleteSession(session, {
   *   authClient,
   *   callbacks: {
   *     onSuccess: (action, id) => {
   *       console.log(`Session ${id} deleted via ${action}`);
   *       removeFromSessionList(id);
   *     }
   *   }
   * });
   * ```
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
   * Deletes a session by ID without requiring the full session object
   *
   * @param {string} sessionId - The ID of the session to delete
   * @param {SessionActionOptions} options - Options including auth client and callbacks
   * @returns {Promise<SessionActionResult>} Result indicating success or failure
   *
   * @remarks
   * This method makes a direct DELETE API call to /api/sessions/:id
   * without needing to know the session's current status. Useful when:
   * - You only have the session ID (e.g., from a URL parameter)
   * - The session object is not readily available
   * - You want to force deletion regardless of client-side state
   *
   * The server will handle the deletion appropriately based on the
   * session's actual status.
   *
   * @throws {Error} Throws if the API request fails
   *
   * @example
   * ```typescript
   * // Delete by ID from URL parameter
   * const sessionId = new URLSearchParams(location.search).get('session');
   * if (sessionId) {
   *   const result = await service.deleteSessionById(sessionId, {
   *     authClient,
   *     callbacks: {
   *       onSuccess: () => navigate('/sessions'),
   *       onError: (msg) => showNotification(msg)
   *     }
   *   });
   * }
   * ```
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

      // Emit global event (only in browser environment)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('session-action', {
            detail: {
              action: 'delete',
              sessionId,
            },
          })
        );
      }

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error deleting session', { error, sessionId });
      options.callbacks?.onError?.(errorMessage);
      return { success: false, error: errorMessage };
    }
  }
}

/**
 * Global singleton instance of SessionActionService
 *
 * @remarks
 * Use this exported instance instead of calling getInstance() directly.
 * This ensures consistent usage across the application.
 *
 * @example
 * ```typescript
 * import { sessionActionService } from './services/session-action-service.js';
 *
 * // Use in components
 * await sessionActionService.terminateSession(session, options);
 * ```
 */
export const sessionActionService = SessionActionService.getInstance();
