import type { TitleMode } from '../../shared/types.js';
import { createLogger } from '../utils/logger.js';
import type { AuthClient } from './auth-client.js';

const logger = createLogger('session-service');

export interface SessionCreateData {
  command: string[];
  workingDir: string;
  name?: string;
  spawn_terminal?: boolean;
  cols?: number;
  rows?: number;
  titleMode?: TitleMode;
}

export interface SessionCreateResult {
  sessionId: string;
  message?: string;
}

export interface SessionCreateError {
  error?: string;
  details?: string;
}

export class SessionService {
  private authClient: AuthClient;

  constructor(authClient: AuthClient) {
    this.authClient = authClient;
  }

  /**
   * Create a new terminal session
   * @param sessionData The session configuration
   * @returns Promise with the created session result
   * @throws Error if the session creation fails
   */
  async createSession(sessionData: SessionCreateData): Promise<SessionCreateResult> {
    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.authClient.getAuthHeader(),
        },
        body: JSON.stringify(sessionData),
      });

      if (response.ok) {
        const result = await response.json();
        logger.log('Session created successfully:', result.sessionId);
        return result;
      } else {
        const error: SessionCreateError = await response.json();
        // Use the detailed error message if available, otherwise fall back to the error field
        const errorMessage = error.details || error.error || 'Unknown error';
        logger.error('Failed to create session:', errorMessage);
        throw new Error(errorMessage);
      }
    } catch (error) {
      // Re-throw if it's already an Error with a message
      if (error instanceof Error && error.message) {
        throw error;
      }
      // Otherwise wrap it
      logger.error('Error creating session:', error);
      throw new Error('Failed to create session');
    }
  }
}
