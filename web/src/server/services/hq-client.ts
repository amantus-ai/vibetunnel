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
/**
 * Default interval (ms) between re-registration heartbeats.
 *
 * Chosen to be comfortably longer than the HQ's eviction window
 * (RemoteRegistry evicts a remote after 3 failed 15s health checks, i.e. ~45s),
 * so a remote that was evicted while its host slept is re-added within one cycle
 * of coming back online, without hammering the HQ while healthy.
 */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 60_000;
const HQ_REQUEST_TIMEOUT_MS = 10_000;

export class HQClient {
  private readonly hqUrl: string;
  private readonly remoteId: string;
  private readonly remoteName: string;
  private readonly token: string;
  private readonly hqUsername: string;
  private readonly hqPassword: string;
  private readonly remoteUrl: string;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatRequest: Promise<void> | null = null;
  private heartbeatActive = false;
  private heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS;

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
        signal: AbortSignal.timeout(HQ_REQUEST_TIMEOUT_MS),
      });

      if (response.status === 204) {
        logger.debug(`registration refreshed with hq: ${this.remoteName} (${this.remoteId})`);
        return;
      }

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`registration failed with status ${response.status}: ${errorText}`);
        logger.debug('registration request details:', {
          url: `${this.hqUrl}/api/remotes/register`,
          headers: {
            'Content-Type': 'application/json',
            Authorization: '[redacted]',
          },
          body: {
            id: this.remoteId,
            name: this.remoteName,
            url: this.remoteUrl,
            token: '[redacted]',
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
      });
    } catch (error) {
      logger.error('failed to register with hq:', error);
      throw error; // Let the caller handle retries if needed
    }
  }

  /**
   * Start a periodic re-registration heartbeat.
   *
   * The HQ's {@link RemoteRegistry} health-checks each remote every 15s and
   * evicts it after 3 consecutive failures (~45s). A remote registers only once
   * at startup, so if its host sleeps (or briefly loses the network) long enough
   * to be evicted, it never reappears in HQ until its process restarts — even
   * after the host wakes and is reachable again.
   *
   * This heartbeat closes that gap: it registers immediately, then re-calls
   * {@link register} after each completed request. HQ accepts an identical remote
   * ID as an idempotent refresh while rejecting another process that merely uses
   * the same name. Once the remote has been evicted, the next heartbeat registers
   * it again, so a slept/reconnected host is picked back up without a restart.
   *
   * Idempotent: calling it again while a heartbeat is running is a no-op.
   *
   * @param intervalMs - Milliseconds between heartbeats (default 60s).
   */
  startHeartbeat(intervalMs: number = DEFAULT_HEARTBEAT_INTERVAL_MS): void {
    if (this.heartbeatActive) {
      logger.debug('heartbeat already running; ignoring startHeartbeat');
      return;
    }
    this.heartbeatActive = true;
    this.heartbeatIntervalMs = intervalMs;
    logger.debug(`starting hq re-registration heartbeat every ${intervalMs}ms`);
    this.runHeartbeat();
  }

  private runHeartbeat(): void {
    if (!this.heartbeatActive) {
      return;
    }

    const request = this.register()
      .catch((err) => {
        // A transient failure (HQ briefly down, network blip) is expected to
        // recover on the next beat; log at debug so a flaky link doesn't spam.
        logger.debug('hq heartbeat re-registration failed (will retry):', err);
      })
      .finally(() => {
        if (this.heartbeatRequest === request) {
          this.heartbeatRequest = null;
        }
        if (!this.heartbeatActive) {
          return;
        }
        this.heartbeatTimer = setTimeout(() => {
          this.heartbeatTimer = null;
          this.runHeartbeat();
        }, this.heartbeatIntervalMs);
        this.heartbeatTimer.unref?.();
      });
    this.heartbeatRequest = request;
  }

  /**
   * Stop the re-registration heartbeat, if running.
   */
  stopHeartbeat(): void {
    this.heartbeatActive = false;
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    logger.debug('stopped hq re-registration heartbeat');
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

    // Stop the re-registration heartbeat first so it can't race the unregister
    // below and immediately re-add this remote during shutdown.
    this.stopHeartbeat();

    // An already-started registration cannot be cancelled without also
    // cancelling unrelated fetches. It is timeout-bounded, so let it settle
    // before unregistering to prevent a late POST from re-adding this remote.
    if (this.heartbeatRequest) {
      await this.heartbeatRequest;
    }

    try {
      // Try to unregister
      const response = await fetch(`${this.hqUrl}/api/remotes/${this.remoteId}`, {
        method: HttpMethod.DELETE,
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.hqUsername}:${this.hqPassword}`).toString('base64')}`,
        },
        signal: AbortSignal.timeout(HQ_REQUEST_TIMEOUT_MS),
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
