import chalk from 'chalk';
import { Router } from 'express';
import { isShuttingDown } from '../server.js';
import type { RemoteRegistry } from '../services/remote-registry.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('remotes');

interface RemoteRoutesConfig {
  remoteRegistry: RemoteRegistry | null;
  isHQMode: boolean;
}

export function createRemoteRoutes(config: RemoteRoutesConfig): Router {
  const router = Router();
  const { remoteRegistry, isHQMode } = config;

  // HQ Mode: List all registered remotes
  router.get('/remotes', (_req, res) => {
    if (!isHQMode || !remoteRegistry) {
      logger.debug('remotes list requested but not in HQ mode');
      return res.status(404).json({ error: 'Not running in HQ mode' });
    }

    const remotes = remoteRegistry.getRemotes();
    logger.debug(`listing ${remotes.length} registered remotes`);
    // Convert Set to Array for JSON serialization
    const remotesWithArraySessionIds = remotes.map((remote) => ({
      ...remote,
      sessionIds: Array.from(remote.sessionIds),
    }));
    res.json(remotesWithArraySessionIds);
  });

  // HQ Mode: Register a new remote
  router.post('/remotes/register', (req, res) => {
    if (!isHQMode || !remoteRegistry) {
      logger.debug('remote registration attempted but not in HQ mode');
      return res.status(404).json({ error: 'Not running in HQ mode' });
    }

    const { id, name, url, token } = req.body;

    if (!id || !name || !url || !token) {
      logger.warn(
        `remote registration missing required fields: got id=${!!id}, name=${!!name}, url=${!!url}, token=${!!token}`
      );
      return res.status(400).json({ error: 'Missing required fields: id, name, url, token' });
    }

    logger.debug(`attempting to register remote ${name} (${id}) from ${url}`);

    try {
      const remote = remoteRegistry.register({ id, name, url, token });
      logger.log(chalk.green(`remote registered: ${name} (${id}) from ${url}`));
      res.json({ success: true, remote });
    } catch (error) {
      if (error instanceof Error && error.message.includes('already registered')) {
        return res.status(409).json({ error: error.message });
      }
      logger.error('failed to register remote:', error);
      res.status(500).json({ error: 'Failed to register remote' });
    }
  });

  // HQ Mode: Unregister a remote
  router.delete('/remotes/:remoteId', (req, res) => {
    if (!isHQMode || !remoteRegistry) {
      logger.debug('remote unregistration attempted but not in HQ mode');
      return res.status(404).json({ error: 'Not running in HQ mode' });
    }

    const remoteId = req.params.remoteId;
    logger.debug(`attempting to unregister remote ${remoteId}`);
    const success = remoteRegistry.unregister(remoteId);

    if (success) {
      logger.log(chalk.yellow(`remote unregistered: ${remoteId}`));
      res.json({ success: true });
    } else {
      logger.warn(`attempted to unregister non-existent remote: ${remoteId}`);
      res.status(404).json({ error: 'Remote not found' });
    }
  });

  // HQ Mode: Refresh sessions for a specific remote
  router.post('/remotes/:remoteName/refresh-sessions', async (req, res) => {
    if (!isHQMode || !remoteRegistry) {
      logger.debug('session refresh attempted but not in HQ mode');
      return res.status(404).json({ error: 'Not running in HQ mode' });
    }

    // If server is shutting down, return service unavailable
    if (isShuttingDown()) {
      logger.debug('session refresh rejected during shutdown');
      return res.status(503).json({ error: 'Server is shutting down' });
    }

    const remoteName = req.params.remoteName;
    const { action, sessionId } = req.body;
    logger.debug(
      `refreshing sessions for remote ${remoteName} (action: ${action}, sessionId: ${sessionId})`
    );

    // Find remote by name
    const remotes = remoteRegistry.getRemotes();
    const remote = remotes.find((r) => r.name === remoteName);

    if (!remote) {
      logger.warn(`remote not found for session refresh: ${remoteName}`);
      return res.status(404).json({ error: 'Remote not found' });
    }

    try {
      // Fetch latest sessions from the remote
      const startTime = Date.now();
      const response = await fetch(`${remote.url}/api/sessions`, {
        headers: {
          Authorization: `Bearer ${remote.token}`,
        },
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const sessions = (await response.json()) as Array<{ id: string }>;
        const sessionIds = sessions.map((s) => s.id);
        const duration = Date.now() - startTime;

        remoteRegistry.updateRemoteSessions(remote.id, sessionIds);

        logger.log(
          chalk.green(`updated sessions for remote ${remote.name}: ${sessionIds.length} sessions`)
        );
        logger.debug(
          `session refresh completed in ${duration}ms (action: ${action}, sessionId: ${sessionId})`
        );
        res.json({ success: true, sessionCount: sessionIds.length });
      } else {
        throw new Error(`Failed to fetch sessions: ${response.status}`);
      }
    } catch (error) {
      // During shutdown, connection failures are expected
      if (isShuttingDown()) {
        logger.log(chalk.yellow(`remote ${remote.name} refresh failed during shutdown (expected)`));
        return res.status(503).json({ error: 'Server is shutting down' });
      }

      logger.error(`failed to refresh sessions for remote ${remote.name}:`, error);
      res.status(500).json({ error: 'Failed to refresh sessions' });
    }
  });

  return router;
}
