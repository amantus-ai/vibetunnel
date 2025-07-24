import chalk from 'chalk';
import { v4 as uuidv4 } from 'uuid';
import { HttpMethod } from '../../shared/types.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('hq-client');

/**
 * HQ Client
 *
 * Manages registration of a remote VibeTunnel server with a headquarters (HQ) server.
 * This enables distributed VibeTunnel architecture where multiple remote servers can
 * connect to a central HQ server, allowing users to access terminal sessions across
 * different servers through a single entry point.
 *
 * ## Architecture Overview
 *
 * In HQ mode, VibeTunnel supports a distributed architecture:
 * - **HQ Server**: Central server that acts as a gateway and registry
 * - **Remote Servers**: Individual VibeTunnel instances that register with HQ
 * - **Session Routing**: HQ routes client requests to appropriate remote servers
 * - **WebSocket Aggregation**: HQ aggregates terminal buffers from all remotes
 *
 * ## Registration Process
 *
 * 1. Remote server starts with HQ configuration (URL, credentials, bearer token)
 * 2. HQClient generates a unique remote ID and registers with HQ
 * 3. HQ stores remote information and uses bearer token for authentication
 * 4. Remote server maintains registration until shutdown
 * 5. On shutdown, remote unregisters from HQ gracefully
 *
 * ## Authentication
 *
 * Two-way authentication is used:
 * - **Remote → HQ**: Uses HTTP Basic Auth (username/password)
 * - **HQ → Remote**: Uses Bearer token provided during registration
 *
 * ## Usage Example
 *
 * ```typescript
 * // Create HQ client for remote server
 * const hqClient = new HQClient(
 *   'https://hq.example.com',      // HQ server URL
 *   'remote-user',                 // HQ username
 *   'remote-password',             // HQ password
 *   'us-west-1',                   // Remote name
 *   'https://remote1.example.com', // This server's public URL
 *   'secret-bearer-token'          // Token for HQ to authenticate back
 * );
 *
 * // Register with HQ
 * try {
 *   await hqClient.register();
 *   console.log(`Registered as: ${hqClient.getRemoteId()}`);
 * } catch (error) {
 *   console.error('Failed to register with HQ:', error);
 * }
 *
 * // On shutdown
 * await hqClient.destroy();
 * ```
 *
 * @see web/src/server/services/remote-registry.ts for HQ-side registry
 * @see web/src/server/services/buffer-aggregator.ts for cross-server buffer streaming
 * @see web/src/server/server.ts for HQ mode initialization
 */
export class HQClient {
  private readonly hqUrl: string;
  private readonly remoteId: string;
  private readonly remoteName: string;
  private readonly token: string;
  private readonly hqUsername: string;
  private readonly hqPassword: string;
  private readonly remoteUrl: string;

  /**
   * Create a new HQ client
   *
   * @param hqUrl - Base URL of the HQ server (e.g., 'https://hq.example.com')
   * @param hqUsername - Username for authenticating with HQ (Basic Auth)
   * @param hqPassword - Password for authenticating with HQ (Basic Auth)
   * @param remoteName - Human-readable name for this remote server (e.g., 'us-west-1')
   * @param remoteUrl - Public URL of this remote server for HQ to connect back
   * @param bearerToken - Bearer token that HQ will use to authenticate with this remote
   */
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

  /**
   * Register this remote server with HQ
   *
   * Sends a registration request to the HQ server with this remote's information.
   * The HQ server will store this registration and use it to route sessions and
   * establish WebSocket connections for buffer streaming.
   *
   * Registration includes:
   * - Unique remote ID (UUID v4)
   * - Remote name for display
   * - Public URL for HQ to connect back
   * - Bearer token for HQ authentication
   *
   * @throws {Error} If registration fails (network error, auth failure, etc.)
   *
   * @example
   * ```typescript
   * try {
   *   await hqClient.register();
   *   console.log('Successfully registered with HQ');
   * } catch (error) {
   *   console.error('Registration failed:', error.message);
   *   // Implement retry logic if needed
   * }
   * ```
   */
  async register(): Promise<void> {
    logger.log(`registering with hq at ${this.hqUrl}`);

    try {
      const response = await fetch(`${this.hqUrl}/api/remotes/register`, {
        method: HttpMethod.POST,
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

  /**
   * Unregister from HQ and clean up
   *
   * Attempts to gracefully unregister this remote from the HQ server.
   * This should be called during shutdown to inform HQ that this remote
   * is no longer available.
   *
   * The method is designed to be safe during shutdown:
   * - Errors are logged but not thrown
   * - Timeouts are handled gracefully
   * - Always completes without blocking shutdown
   *
   * @example
   * ```typescript
   * // In shutdown handler
   * process.on('SIGTERM', async () => {
   *   await hqClient.destroy();
   *   process.exit(0);
   * });
   * ```
   */
  async destroy(): Promise<void> {
    logger.log(chalk.yellow(`unregistering from hq: ${this.remoteName} (${this.remoteId})`));

    try {
      // Try to unregister
      const response = await fetch(`${this.hqUrl}/api/remotes/${this.remoteId}`, {
        method: HttpMethod.DELETE,
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

  /**
   * Get the unique ID of this remote
   *
   * The remote ID is a UUID v4 generated when the HQClient is created.
   * This ID uniquely identifies this remote server in the HQ registry.
   *
   * @returns The remote's unique identifier
   */
  getRemoteId(): string {
    return this.remoteId;
  }

  /**
   * Get the bearer token for this remote
   *
   * This token is provided by the remote server and given to HQ during
   * registration. HQ uses this token to authenticate when connecting
   * back to this remote (e.g., for WebSocket buffer streaming).
   *
   * @returns The bearer token for HQ authentication
   */
  getToken(): string {
    return this.token;
  }

  /**
   * Get the HQ server URL
   *
   * @returns The base URL of the HQ server
   */
  getHQUrl(): string {
    return this.hqUrl;
  }

  /**
   * Get the Authorization header value for HQ requests
   *
   * Constructs a Basic Authentication header using the HQ username and password.
   * This is used by the remote to authenticate with the HQ server.
   *
   * @returns Authorization header value (e.g., 'Basic base64credentials')
   */
  getHQAuth(): string {
    const credentials = Buffer.from(`${this.hqUsername}:${this.hqPassword}`).toString('base64');
    return `Basic ${credentials}`;
  }

  /**
   * Get the human-readable name of this remote
   *
   * The remote name is used for display purposes in HQ interfaces
   * and logs (e.g., 'us-west-1', 'europe-1', 'dev-server').
   *
   * @returns The remote's display name
   */
  getName(): string {
    return this.remoteName;
  }
}
