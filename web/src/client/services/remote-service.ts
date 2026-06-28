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
 * `GET /api/remotes` returns 404 when the server is NOT in HQ mode (a plain
 * single-server deploy). That's not an error here — it simply means there are no
 * remotes to choose from, so we return an empty list and the caller falls back to
 * a local session.
 *
 * @example
 * ```typescript
 * const remoteService = new RemoteService(authClient);
 * const remotes = await remoteService.listRemotes();
 * // [] when not in HQ mode; otherwise the registered machines
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
   * @returns Promise resolving to the registered remotes, or an empty array when
   *          the server isn't in HQ mode (404) or the request fails.
   *
   * @throws Never throws - errors are logged and an empty array returned.
   */
  async listRemotes(): Promise<RemoteSummary[]> {
    try {
      const response = await fetch('/api/remotes', {
        headers: this.authClient.getAuthHeader(),
      });

      if (response.ok) {
        const remotes = await response.json();
        if (!Array.isArray(remotes)) {
          return [];
        }
        return remotes
          .filter(
            (r): r is RemoteSummary => r && typeof r.id === 'string' && typeof r.name === 'string'
          )
          .map((r) => ({ id: r.id, name: r.name }));
      }

      // 404 = not in HQ mode (single-server); any non-OK = no remotes to offer.
      logger.debug(`remotes unavailable (status ${response.status}); treating as none`);
      return [];
    } catch (error) {
      logger.error('Error listing remotes:', error);
      return [];
    }
  }
}
