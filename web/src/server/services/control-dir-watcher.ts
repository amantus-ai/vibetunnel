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
      logger.debug(
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

    logger.debug(chalk.green(`Control directory watcher started for ${this.config.controlDir}`));
  }

  private async handleFileChange(filename: string): Promise<void> {
    const sessionPath = path.join(this.config.controlDir, filename);
    const sessionJsonPath = path.join(sessionPath, 'session.json');

    try {
      // Check if this is a directory creation event
      if (fs.existsSync(sessionPath) && fs.statSync(sessionPath).isDirectory()) {
        // This is a new session directory, wait for session.json with retries
        const maxRetries = 5;
        const baseDelay = 100;
        let sessionData: Record<string, unknown> | null = null;

        for (let i = 0; i < maxRetries; i++) {
          const delay = baseDelay * 2 ** i; // Exponential backoff: 100, 200, 400, 800, 1600ms
          logger.debug(
            `Attempt ${i + 1}/${maxRetries}: Waiting ${delay}ms for session.json for ${filename}`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));

          if (fs.existsSync(sessionJsonPath)) {
            try {
              const content = fs.readFileSync(sessionJsonPath, 'utf8');
              sessionData = JSON.parse(content);
              logger.debug(`Successfully read session.json for ${filename} on attempt ${i + 1}`);
              break;
            } catch (error) {
              logger.debug(`Failed to read/parse session.json on attempt ${i + 1}:`, error);
              // Continue to next retry
            }
          }
        }

        if (sessionData) {
          // Session was created
          const sessionId = (sessionData.id || sessionData.session_id || filename) as string;

          logger.debug(chalk.blue(`Detected new external session: ${sessionId}`));

          // Check if PtyManager already knows about this session
          if (this.config.ptyManager) {
            const existingSession = this.config.ptyManager.getSession(sessionId);
            if (!existingSession) {
              // This is a new external session, PtyManager needs to track it
              logger.debug(chalk.green(`Attaching to external session: ${sessionId}`));
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
        } else {
          logger.warn(`Session.json not found for ${filename} after ${maxRetries} retries`);
        }
      } else if (!fs.existsSync(sessionPath)) {
        // Session directory was removed
        const sessionId = filename;
        logger.debug(chalk.yellow(`Detected removed session: ${sessionId}`));

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
    logger.debug(chalk.green(`Notified HQ about ${action} session ${sessionId} (${duration}ms)`));
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      logger.debug(chalk.yellow('Control directory watcher stopped'));
    } else {
      logger.debug('Stop called but watcher was not running');
    }
  }
}
