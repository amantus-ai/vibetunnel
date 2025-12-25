/**
 * Session Service
 *
 * Handles terminal session creation through the VibeTunnel API. This service
 * provides the primary interface for creating new terminal sessions with various
 * configurations including Git integration, terminal dimensions, and title modes.
 *
 * ## Main Features
 * - Create terminal sessions with custom commands and working directories
 * - Configure terminal dimensions (cols/rows) for proper rendering
 * - Set title management modes (none, filter, static, dynamic alias)
 * - Integrate with Git repositories for branch-aware sessions
 * - Support for both local and remote session creation (in HQ mode)
 *
 * ## Usage Example
 * ```typescript
 * const sessionService = new SessionService(authClient);
 *
 * // Create a basic terminal session
 * const result = await sessionService.createSession({
 *   command: ['zsh'],
 *   workingDir: '/home/user/project'
 * });
 * console.log('Session created:', result.sessionId);
 *
 * // Create a session with Git integration
 * const gitSession = await sessionService.createSession({
 *   command: ['npm', 'run', 'dev'],
 *   workingDir: '/home/user/my-app',
 *   name: 'Dev Server',
 *   gitRepoPath: '/home/user/my-app',
 *   gitBranch: 'feature/new-ui',
 *   titleMode: TitleMode.STATIC,
 *   cols: 120,
 *   rows: 40
 * });
 * ```
 *
 * @see web/src/server/routes/sessions.ts:262-396 for server-side implementation
 * @see web/src/client/components/session-create-form.ts for UI integration
 */

import type { TitleMode } from '../../shared/types.js';
import { HttpMethod } from '../../shared/types.js';
import { createLogger } from '../utils/logger.js';
import type { AuthClient } from './auth-client.js';

const logger = createLogger('session-service');

/**
 * Session creation configuration
 *
 * @property command - Array of command and arguments to execute (e.g., ['npm', 'run', 'dev'])
 * @property workingDir - Absolute path where the session should start
 * @property name - Optional human-readable name for the session (auto-generated if not provided)
 * @property spawn_terminal - Whether to spawn in a new macOS Terminal.app window (Mac app only)
 * @property cols - Initial terminal width in columns (default: 80)
 * @property rows - Initial terminal height in rows (default: 24)
 * @property titleMode - How to handle terminal title updates from applications
 * @property gitRepoPath - Path to Git repository (enables Git integration features)
 * @property gitBranch - Current Git branch name (for display and tracking)
 */
export interface SessionCreateData {
  command: string[];
  workingDir: string;
  name?: string;
  spawn_terminal?: boolean;
  cols?: number;
  rows?: number;
  titleMode?: TitleMode;
  gitRepoPath?: string;
  gitBranch?: string;
}

/**
 * Successful session creation response
 *
 * @property sessionId - Unique identifier for the created session
 * @property message - Optional success message from the server
 */
export interface SessionCreateResult {
  sessionId: string;
  message?: string;
}

/**
 * Session creation error response
 *
 * The server may return either 'error' or 'details' fields. The 'details'
 * field typically contains more specific error information.
 *
 * @property error - General error message
 * @property details - Detailed error information (preferred when available)
 */
export interface SessionCreateError {
  error?: string;
  details?: string;
}

/**
 * SessionService manages terminal session creation via the VibeTunnel API.
 *
 * This service handles:
 * - API communication with proper authentication
 * - Error handling and message extraction
 * - Request/response serialization
 * - Logging for debugging
 *
 * The service requires an AuthClient for authentication headers.
 */
export class SessionService {
  private authClient: AuthClient;

  constructor(authClient: AuthClient) {
    this.authClient = authClient;
  }

  /**
   * Create a new terminal session
   *
   * Creates a terminal session with the specified configuration. The session
   * will start executing the provided command in the given working directory.
   *
   * **Session Lifecycle:**
   * 1. Session is created with 'starting' status
   * 2. PTY (pseudo-terminal) is spawned with the command
   * 3. Session transitions to 'running' status
   * 4. Session remains active until the process exits
   * 5. Session transitions to 'exited' status with exit code
   *
   * **Git Integration:**
   * When gitRepoPath and gitBranch are provided, the session gains:
   * - Branch name display in the UI
   * - Ahead/behind commit tracking
   * - Uncommitted changes indicators
   * - Worktree awareness
   *
   * **Title Modes:**
   * - `none`: No title management, apps control the title
   * - `filter`: Block all title changes from applications
   * - `static`: Fixed title format: "path — command — session"
   * - `dynamic`: Legacy alias of `static`
   *
   * @param sessionData - The session configuration
   * @returns Promise resolving to the created session details
   *
   * @example
   * ```typescript
   * // Basic shell session
   * const { sessionId } = await sessionService.createSession({
   *   command: ['bash'],
   *   workingDir: process.env.HOME
   * });
   *
   * // Development server with Git tracking
   * const devSession = await sessionService.createSession({
   *   command: ['npm', 'run', 'dev'],
   *   workingDir: '/path/to/project',
   *   name: 'Dev Server',
   *   gitRepoPath: '/path/to/project',
   *   gitBranch: 'main',
   *   titleMode: TitleMode.STATIC,
   *   cols: 120,
   *   rows: 40
   * });
   *
   * // Spawn in new Terminal.app window (Mac only)
   * const terminalSession = await sessionService.createSession({
   *   command: ['vim', 'README.md'],
   *   workingDir: '/path/to/project',
   *   spawn_terminal: true
   * });
   * ```
   *
   * @throws Error with detailed message if:
   * - Invalid command array provided
   * - Working directory doesn't exist or isn't accessible
   * - Authentication fails (401)
   * - Server error occurs (500)
   * - Network request fails
   */
  async createSession(sessionData: SessionCreateData): Promise<SessionCreateResult> {
    try {
      const response = await fetch('/api/sessions', {
        method: HttpMethod.POST,
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
