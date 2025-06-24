import chalk from 'chalk';
import { isShuttingDown } from '../server.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('remote-registry');

export interface RemoteServer {
  id: string;
  name: string;
  url: string;
  token: string;
  registeredAt: Date;
  lastHeartbeat: Date;
  sessionIds: Set<string>; // Track which sessions belong to this remote
}

export class RemoteRegistry {
  private remotes: Map<string, RemoteServer> = new Map();
  private remotesByName: Map<string, RemoteServer> = new Map();
  private sessionToRemote: Map<string, string> = new Map(); // sessionId -> remoteId
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private readonly HEALTH_CHECK_INTERVAL = 15000; // Check every 15 seconds
  private readonly HEALTH_CHECK_TIMEOUT = 5000; // 5 second timeout per check

  constructor() {
    this.startHealthChecker();
    logger.debug('remote registry initialized with health check interval', {
      interval: this.HEALTH_CHECK_INTERVAL,
      timeout: this.HEALTH_CHECK_TIMEOUT,
    });
  }

  register(
    remote: Omit<RemoteServer, 'registeredAt' | 'lastHeartbeat' | 'sessionIds'>
  ): RemoteServer {
    // Check if a remote with the same name already exists
    if (this.remotesByName.has(remote.name)) {
      throw new Error(`Remote with name '${remote.name}' is already registered`);
    }

    const now = new Date();
    const registeredRemote: RemoteServer = {
      ...remote,
      registeredAt: now,
      lastHeartbeat: now,
      sessionIds: new Set<string>(),
    };

    this.remotes.set(remote.id, registeredRemote);
    this.remotesByName.set(remote.name, registeredRemote);
    logger.log(chalk.green(`remote registered: ${remote.name} (${remote.id}) from ${remote.url}`));

    // Immediately check health of new remote
    this.checkRemoteHealth(registeredRemote);

    return registeredRemote;
  }

  unregister(remoteId: string): boolean {
    const remote = this.remotes.get(remoteId);
    if (remote) {
      logger.log(chalk.yellow(`remote unregistered: ${remote.name} (${remoteId})`));

      // Clean up session mappings
      for (const sessionId of remote.sessionIds) {
        this.sessionToRemote.delete(sessionId);
      }

      this.remotesByName.delete(remote.name);
      return this.remotes.delete(remoteId);
    }
    return false;
  }

  getRemote(remoteId: string): RemoteServer | undefined {
    const remote = this.remotes.get(remoteId);
    if (!remote) {
      logger.debug(`remote not found: ${remoteId}`);
    }
    return remote;
  }

  getRemoteByUrl(url: string): RemoteServer | undefined {
    return Array.from(this.remotes.values()).find((r) => r.url === url);
  }

  getRemotes(): RemoteServer[] {
    return Array.from(this.remotes.values());
  }

  getRemoteBySessionId(sessionId: string): RemoteServer | undefined {
    const remoteId = this.sessionToRemote.get(sessionId);
    return remoteId ? this.remotes.get(remoteId) : undefined;
  }

  updateRemoteSessions(remoteId: string, sessionIds: string[]): void {
    const remote = this.remotes.get(remoteId);
    if (!remote) {
      logger.debug(`cannot update sessions: remote ${remoteId} not found`);
      return;
    }

    const oldCount = remote.sessionIds.size;

    // Remove old session mappings
    for (const oldSessionId of remote.sessionIds) {
      this.sessionToRemote.delete(oldSessionId);
    }

    // Update with new sessions
    remote.sessionIds = new Set(sessionIds);
    for (const sessionId of sessionIds) {
      this.sessionToRemote.set(sessionId, remoteId);
    }

    logger.debug(`updated sessions for remote ${remote.name}`, {
      oldCount,
      newCount: sessionIds.length,
    });
  }

  addSessionToRemote(remoteId: string, sessionId: string): void {
    const remote = this.remotes.get(remoteId);
    if (!remote) {
      logger.warn(`cannot add session ${sessionId}: remote ${remoteId} not found`);
      return;
    }

    remote.sessionIds.add(sessionId);
    this.sessionToRemote.set(sessionId, remoteId);
    logger.debug(`session ${sessionId} added to remote ${remote.name}`);
  }

  removeSessionFromRemote(sessionId: string): void {
    const remoteId = this.sessionToRemote.get(sessionId);
    if (!remoteId) {
      logger.debug(`session ${sessionId} not mapped to any remote`);
      return;
    }

    const remote = this.remotes.get(remoteId);
    if (remote) {
      remote.sessionIds.delete(sessionId);
      logger.debug(`session ${sessionId} removed from remote ${remote.name}`);
    }

    this.sessionToRemote.delete(sessionId);
  }

  private async checkRemoteHealth(remote: RemoteServer): Promise<void> {
    // Skip health checks during shutdown
    if (isShuttingDown()) {
      return;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.HEALTH_CHECK_TIMEOUT);

      // Use the token provided by the remote for authentication
      const headers: Record<string, string> = {
        Authorization: `Bearer ${remote.token}`,
      };

      // Only check health endpoint - all remotes MUST have it
      const response = await fetch(`${remote.url}/api/health`, {
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        remote.lastHeartbeat = new Date();
        logger.debug(`health check passed for ${remote.name}`);
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      // During shutdown, don't log errors or unregister remotes
      if (!isShuttingDown()) {
        logger.warn(`remote failed health check: ${remote.name} (${remote.id})`, error);
        // Remove the remote if it fails health check
        this.unregister(remote.id);
      }
    }
  }

  private startHealthChecker() {
    logger.debug('starting health checker');
    this.healthCheckInterval = setInterval(() => {
      // Skip health checks during shutdown
      if (isShuttingDown()) {
        return;
      }

      // Check all remotes in parallel
      const healthChecks = Array.from(this.remotes.values()).map((remote) =>
        this.checkRemoteHealth(remote)
      );

      Promise.all(healthChecks).catch((err) => {
        logger.error('error in health checks:', err);
      });
    }, this.HEALTH_CHECK_INTERVAL);
  }

  destroy() {
    logger.log(chalk.yellow('destroying remote registry'));
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      logger.debug('health checker stopped');
    }
  }
}
