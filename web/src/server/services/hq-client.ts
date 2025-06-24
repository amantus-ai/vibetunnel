import chalk from 'chalk';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('hq-client');

export class HQClient {
  private readonly hqUrl: string;
  private readonly remoteId: string;
  private readonly remoteName: string;
  private readonly token: string;
  private readonly hqUsername: string;
  private readonly hqPassword: string;
  private readonly remoteUrl: string;

  constructor(
    hqUrl: string,
    hqUsername: string,
    hqPassword: string,
    remoteName: string,
    remoteUrl: string,
    bearerToken: string
  ) {
    this.hqUrl = hqUrl;
    this.remoteId = uuidv4();
    this.remoteName = remoteName;
    this.token = bearerToken;
    this.hqUsername = hqUsername;
    this.hqPassword = hqPassword;
    this.remoteUrl = remoteUrl;

    logger.debug('hq client initialized', {
      hqUrl,
      remoteName,
      remoteId: this.remoteId,
      remoteUrl,
    });
  }

  async register(): Promise<void> {
    logger.log(`registering with hq at ${this.hqUrl}`);

    try {
      const response = await fetch(`${this.hqUrl}/api/remotes/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`${this.hqUsername}:${this.hqPassword}`).toString('base64')}`,
        },
        body: JSON.stringify({
          id: this.remoteId,
          name: this.remoteName,
          url: this.remoteUrl,
          token: this.token, // Token for HQ to authenticate with this remote
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`registration failed with status ${response.status}: ${errorText}`);
        logger.debug('registration request details:', {
          url: `${this.hqUrl}/api/remotes/register`,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${Buffer.from(`${this.hqUsername}:${this.hqPassword}`).toString('base64')}`,
          },
          body: {
            id: this.remoteId,
            name: this.remoteName,
            url: this.remoteUrl,
            token: `${this.token.substring(0, 8)}...`,
          },
        });
        throw new Error(`Registration failed (${response.status}): ${errorText}`);
      }

      logger.log(
        chalk.green(`successfully registered with hq: ${this.remoteName} (${this.remoteId})`) +
          chalk.gray(` at ${this.hqUrl}`)
      );
      logger.debug('registration details', {
        remoteId: this.remoteId,
        remoteName: this.remoteName,
        token: `${this.token.substring(0, 8)}...`,
      });
    } catch (error) {
      logger.error('failed to register with hq:', error);
      throw error; // Let the caller handle retries if needed
    }
  }

  async destroy(): Promise<void> {
    logger.log(chalk.yellow(`unregistering from hq: ${this.remoteName} (${this.remoteId})`));

    try {
      // Try to unregister
      const response = await fetch(`${this.hqUrl}/api/remotes/${this.remoteId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.hqUsername}:${this.hqPassword}`).toString('base64')}`,
        },
      });

      if (response.ok) {
        logger.debug('successfully unregistered from hq');
      } else {
        logger.debug(`unregistration returned status ${response.status}`);
      }
    } catch (error) {
      // Log but don't throw during shutdown
      logger.debug('error during unregistration:', error);
    }
  }

  getRemoteId(): string {
    return this.remoteId;
  }

  getToken(): string {
    return this.token;
  }

  getHQUrl(): string {
    return this.hqUrl;
  }

  getHQAuth(): string {
    const credentials = Buffer.from(`${this.hqUsername}:${this.hqPassword}`).toString('base64');
    return `Basic ${credentials}`;
  }

  getName(): string {
    return this.remoteName;
  }
}
