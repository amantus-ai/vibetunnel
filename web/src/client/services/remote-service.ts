import { createLogger } from '../utils/logger.js';
import type { AuthClient } from './auth-client.js';

const logger = createLogger('remote-service');

/**
 * A registered remote machine in HQ mode, narrowed to what the session-create UI
 * needs: a stable id (sent to the server as `remoteId`) and a display name.
 */
export interface RemoteSummary {
  id: string;
  name: string;
}

/**
 * Service for listing the machines registered with an HQ server.
 *
 * In HQ mode the server aggregates terminal sessions from registered remotes; a
 * new session must target one of them by `remoteId` (the HQ never spawns locally).
 * This service backs the machine picker in the session-create form.
 *
 * @example
 * ```typescript
 * const remoteService = new RemoteService(authClient);
 * const remotes = await remoteService.listRemotes();
 * // Registered machines; callers only invoke this after confirming HQ mode
 * ```
 *
 * @see web/src/server/routes/remotes.ts - Server-side remote registry endpoints
 */
export class RemoteService {
  private authClient: AuthClient;

  constructor(authClient: AuthClient) {
    this.authClient = authClient;
  }

  /**
   * List the machines registered with this HQ server.
   *
   * @returns Promise resolving to the registered remotes.
   *
   * @throws When the server cannot provide a valid remote list. Callers must not
   *         treat transport or authorization failures as an empty HQ.
   */
  async listRemotes(): Promise<RemoteSummary[]> {
    const response = await fetch('/api/remotes', {
      headers: this.authClient.getAuthHeader(),
    });

    if (!response.ok) {
      logger.error(`Failed to list remotes (status ${response.status})`);
      throw new Error(`Failed to load machines (${response.status})`);
    }

    const remotes: unknown = await response.json();
    if (!Array.isArray(remotes)) {
      throw new Error('Failed to load machines: invalid server response');
    }

    return remotes
      .filter(
        (remote): remote is RemoteSummary =>
          remote !== null &&
          typeof remote === 'object' &&
          'id' in remote &&
          typeof remote.id === 'string' &&
          'name' in remote &&
          typeof remote.name === 'string'
      )
      .map((remote) => ({ id: remote.id, name: remote.name }));
  }
}
