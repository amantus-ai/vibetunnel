/**
 * Session Action Utilities
 *
 * Provides common session operations like termination and cleanup
 * that can be reused across components.
 */

import type { AuthClient } from '../services/auth-client.js';
import { createLogger } from './logger.js';

const logger = createLogger('session-actions');

export interface SessionActionResult {
  success: boolean;
  error?: string;
}

/**
 * Terminates a running session or cleans up an exited session
 * @param sessionId - The ID of the session to terminate/cleanup
 * @param authClient - The auth client for authentication headers
 * @param status - The current status of the session
 * @returns Result indicating success or failure with error message
 */
export async function terminateSession(
  sessionId: string,
  authClient: AuthClient,
  status: 'running' | 'exited'
): Promise<SessionActionResult> {
  const action = status === 'exited' ? 'cleanup' : 'terminate';

  try {
    const response = await fetch(`/api/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: {
        ...authClient.getAuthHeader(),
      },
    });

    if (!response.ok) {
      const errorData = await response.text();
      logger.error(`Failed to ${action} session`, { errorData, sessionId });
      throw new Error(`${action} failed: ${response.status}`);
    }

    logger.debug(`Session ${action} successful`, { sessionId });
    return { success: true };
  } catch (error) {
    logger.error(`Failed to ${action} session:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Cleans up all exited sessions
 * @param authClient - The auth client for authentication headers
 * @returns Result indicating success or failure with error message
 */
export async function cleanupAllExitedSessions(
  authClient: AuthClient
): Promise<SessionActionResult> {
  try {
    const response = await fetch('/api/cleanup-exited', {
      method: 'POST',
      headers: {
        ...authClient.getAuthHeader(),
      },
    });

    if (!response.ok) {
      const errorData = await response.text();
      logger.error('Failed to cleanup exited sessions', { errorData });
      throw new Error(`Cleanup failed: ${response.status}`);
    }

    logger.debug('Exited sessions cleanup successful');
    return { success: true };
  } catch (error) {
    logger.error('Failed to cleanup exited sessions:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
