import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import type { PtyManager } from '../pty/index.js';
import { isShuttingDown } from '../server.js';
import { createLogger } from '../utils/logger.js';
import type { HQClient } from './hq-client.js';
import type { RemoteRegistry } from './remote-registry.js';

const logger = createLogger('control-dir-watcher');

interface ControlDirWatcherConfig {
  controlDir: string;
  remoteRegistry: RemoteRegistry | null;
  isHQMode: boolean;
  hqClient: HQClient | null;
  ptyManager?: PtyManager;
}

export class ControlDirWatcher {
  private watcher: fs.FSWatcher | null = null;
  private config: ControlDirWatcherConfig;

  constructor(config: ControlDirWatcherConfig) {
    this.config = config;
    logger.debug(`Initialized with control dir: ${config.controlDir}, HQ mode: ${config.isHQMode}`);
  }

  start(): void {
    // Create control directory if it doesn't exist
    if (!fs.existsSync(this.config.controlDir)) {
      logger.log(
        chalk.yellow(`Control directory ${this.config.controlDir} does not exist, creating it`)
      );
      fs.mkdirSync(this.config.controlDir, { recursive: true });
    }

    this.watcher = fs.watch(
      this.config.controlDir,
      { persistent: true },
      async (eventType, filename) => {
        if (eventType === 'rename' && filename) {
          await this.handleFileChange(filename);
        }
      }
    );

    logger.log(chalk.green(`Control directory watcher started for ${this.config.controlDir}`));
  }

  private async handleFileChange(filename: string): Promise<void> {
    const sessionPath = path.join(this.config.controlDir, filename);
    const sessionJsonPath = path.join(sessionPath, 'session.json');

    try {
      // Give it a moment for the session.json to be written
      logger.debug(`Waiting 100ms for session.json to be written for ${filename}`);
      await new Promise((resolve) => setTimeout(resolve, 100));

      if (fs.existsSync(sessionJsonPath)) {
        // Session was created
        const sessionData = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf8'));
        const sessionId = sessionData.session_id || filename;

        logger.log(chalk.blue(`Detected new external session: ${sessionId}`));

        // Check if PtyManager already knows about this session
        if (this.config.ptyManager) {
          const existingSession = this.config.ptyManager.getSession(sessionId);
          if (!existingSession) {
            // This is a new external session, PtyManager needs to track it
            logger.log(chalk.green(`Attaching to external session: ${sessionId}`));
            // PtyManager will pick it up through its own session listing
            // since it reads from the control directory
          }
        }

        // If we're a remote server registered with HQ, immediately notify HQ
        if (this.config.hqClient && !isShuttingDown()) {
          try {
            await this.notifyHQAboutSession(sessionId, 'created');
          } catch (error) {
            logger.error(`Failed to notify HQ about new session ${sessionId}:`, error);
          }
        }

        // If we're in HQ mode and this is a local session, no special handling needed
        // The session is already tracked locally
      } else if (!fs.existsSync(sessionPath)) {
        // Session directory was removed
        const sessionId = filename;
        logger.log(chalk.yellow(`Detected removed session: ${sessionId}`));

        // If we're a remote server registered with HQ, immediately notify HQ
        if (this.config.hqClient && !isShuttingDown()) {
          try {
            await this.notifyHQAboutSession(sessionId, 'deleted');
          } catch (error) {
            // During shutdown, this is expected
            if (!isShuttingDown()) {
              logger.error(`Failed to notify HQ about deleted session ${sessionId}:`, error);
            }
          }
        }

        // If in HQ mode, remove from tracking
        if (this.config.isHQMode && this.config.remoteRegistry) {
          logger.debug(`Removing session ${sessionId} from remote registry`);
          this.config.remoteRegistry.removeSessionFromRemote(sessionId);
        }
      }
    } catch (error) {
      logger.error(`Error handling file change for ${filename}:`, error);
    }
  }

  private async notifyHQAboutSession(
    sessionId: string,
    action: 'created' | 'deleted'
  ): Promise<void> {
    if (!this.config.hqClient || isShuttingDown()) {
      logger.debug(
        `Skipping HQ notification for ${sessionId} (${action}): shutting down or no HQ client`
      );
      return;
    }

    const hqUrl = this.config.hqClient.getHQUrl();
    const hqAuth = this.config.hqClient.getHQAuth();
    const remoteName = this.config.hqClient.getName();

    logger.debug(
      `Notifying HQ at ${hqUrl} about ${action} session ${sessionId} from remote ${remoteName}`
    );
    const startTime = Date.now();

    // Notify HQ about session change
    // For now, we'll trigger a session list refresh by calling the HQ's session endpoint
    // This will cause HQ to update its registry with the latest session information
    const response = await fetch(`${hqUrl}/api/remotes/${remoteName}/refresh-sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: hqAuth,
      },
      body: JSON.stringify({
        action,
        sessionId,
      }),
    });

    if (!response.ok) {
      // If we get a 503 during shutdown, that's expected
      if (response.status === 503 && isShuttingDown()) {
        logger.debug(`Got expected 503 from HQ during shutdown`);
        return;
      }
      throw new Error(`HQ responded with ${response.status}: ${await response.text()}`);
    }

    const duration = Date.now() - startTime;
    logger.log(chalk.green(`Notified HQ about ${action} session ${sessionId} (${duration}ms)`));
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      logger.log(chalk.yellow('Control directory watcher stopped'));
    } else {
      logger.debug('Stop called but watcher was not running');
    }
  }
}
