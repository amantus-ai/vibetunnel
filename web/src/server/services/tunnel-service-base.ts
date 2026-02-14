import { type ChildProcess, spawn } from 'child_process';
import { createLogger, type Logger } from '../utils/logger.js';

/**
 * Common tunnel information returned by all tunnel services.
 */
export interface TunnelInfo {
  publicUrl: string;
  proto: string;
  name: string;
  uri: string;
}

/**
 * Configuration for tunnel startup behavior.
 */
export interface TunnelStartupConfig {
  /** Timeout in milliseconds before giving up on tunnel startup. Default: 30000 */
  startupTimeoutMs?: number;
  /** Timeout in milliseconds for graceful shutdown. Default: 5000 */
  shutdownTimeoutMs?: number;
}

/**
 * Abstract base class for tunnel services (ngrok, cloudflared, etc.).
 *
 * This class extracts common functionality:
 * - Binary discovery across multiple paths
 * - Process lifecycle management (start/stop)
 * - Graceful shutdown with SIGTERM -> SIGKILL fallback
 * - State tracking (isRunning, currentTunnel)
 *
 * Subclasses must implement:
 * - getBinaryPaths(): Return list of paths to search for the binary
 * - getBinaryVersionArgs(): Return args to check binary version
 * - buildStartArgs(): Return args to start the tunnel
 * - parseOutput(): Parse stdout/stderr to extract tunnel URL
 */
export abstract class TunnelServiceBase {
  protected process: ChildProcess | null = null;
  protected currentTunnel: TunnelInfo | null = null;
  protected isRunning = false;
  protected readonly logger: Logger;
  protected readonly startupTimeoutMs: number;
  protected readonly shutdownTimeoutMs: number;

  constructor(
    loggerName: string,
    protected readonly port: number,
    config: TunnelStartupConfig = {}
  ) {
    this.logger = createLogger(loggerName);
    this.startupTimeoutMs = config.startupTimeoutMs ?? 30000;
    this.shutdownTimeoutMs = config.shutdownTimeoutMs ?? 5000;
  }

  /**
   * Get list of paths to search for the tunnel binary.
   * Should include global PATH name, common install locations, etc.
   */
  protected abstract getBinaryPaths(): string[];

  /**
   * Get arguments to verify binary version/availability.
   * E.g., ['--version'] or ['version']
   */
  protected abstract getBinaryVersionArgs(): string[];

  /**
   * Build command line arguments to start the tunnel.
   */
  protected abstract buildStartArgs(): string[];

  /**
   * Parse process output to extract tunnel URL.
   * Called for each chunk of stdout/stderr data.
   *
   * @param output - Raw output string from the process
   * @returns Tunnel URL if found, null otherwise
   */
  protected abstract parseOutput(output: string): string | null;

  /**
   * Get the service name for logging and error messages.
   */
  protected abstract getServiceName(): string;

  /**
   * Check if the tunnel binary is available.
   * Searches through all paths returned by getBinaryPaths().
   *
   * @returns Path to the binary if found, null otherwise
   */
  async checkBinary(): Promise<string | null> {
    const paths = this.getBinaryPaths();
    const versionArgs = this.getBinaryVersionArgs();

    for (const binaryPath of paths) {
      try {
        const result = await new Promise<boolean>((resolve) => {
          const proc = spawn(binaryPath, versionArgs, { stdio: 'ignore' });
          proc.on('close', (code) => resolve(code === 0));
          proc.on('error', () => resolve(false));
          // Timeout after 2 seconds
          setTimeout(() => {
            proc.kill();
            resolve(false);
          }, 2000);
        });

        if (result) {
          this.logger.debug(`Found ${this.getServiceName()} at: ${binaryPath}`);
          return binaryPath;
        }
      } catch {
        // Continue checking other paths
      }
    }

    return null;
  }

  /**
   * Start the tunnel.
   *
   * @returns Tunnel information on success
   * @throws Error if binary not found or startup fails/times out
   */
  async start(): Promise<TunnelInfo> {
    if (this.isRunning) {
      this.logger.warn(`${this.getServiceName()} tunnel is already running`);
      if (this.currentTunnel) {
        return this.currentTunnel;
      }
    }

    const binaryPath = await this.checkBinary();
    if (!binaryPath) {
      throw new Error(`${this.getServiceName()} binary not found`);
    }

    const args = this.buildStartArgs();
    this.logger.log(`Starting ${this.getServiceName()} tunnel on port ${this.port}...`);

    return new Promise((resolve, reject) => {
      this.process = spawn(binaryPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let startupTimeout: NodeJS.Timeout;
      let resolved = false;

      const cleanup = () => {
        if (startupTimeout) clearTimeout(startupTimeout);
      };

      const handleOutput = (data: Buffer) => {
        const output = data.toString();
        this.logger.debug(`${this.getServiceName()} output:`, output);

        const url = this.parseOutput(output);
        if (url && !resolved) {
          resolved = true;
          this.currentTunnel = {
            publicUrl: url,
            proto: url.startsWith('https') ? 'https' : 'http',
            name: this.getServiceName().toLowerCase(),
            uri: `http://localhost:${this.port}`,
          };
          this.isRunning = true;
          cleanup();
          this.logger.log(`${this.getServiceName()} tunnel started: ${url}`);
          resolve(this.currentTunnel);
        }

        // Log errors
        if (output.toLowerCase().includes('error') && !resolved) {
          this.logger.error(`${this.getServiceName()} error:`, output);
        }
      };

      this.process.stdout?.on('data', handleOutput);
      this.process.stderr?.on('data', handleOutput);

      this.process.on('error', (error) => {
        if (!resolved) {
          resolved = true;
          this.isRunning = false;
          cleanup();
          reject(new Error(`Failed to start ${this.getServiceName()}: ${error.message}`));
        }
      });

      this.process.on('close', (code) => {
        this.isRunning = false;
        this.currentTunnel = null;
        if (code !== 0 && code !== null) {
          this.logger.error(`${this.getServiceName()} process exited with code ${code}`);
        }
      });

      // Timeout if tunnel doesn't start
      startupTimeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.stop().catch(() => {});
          reject(new Error(`${this.getServiceName()} startup timeout - tunnel failed to start`));
        }
      }, this.startupTimeoutMs);
    });
  }

  /**
   * Stop the tunnel gracefully.
   * Sends SIGTERM first, then SIGKILL after timeout.
   */
  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    this.logger.log(`Stopping ${this.getServiceName()} tunnel...`);

    return new Promise((resolve) => {
      if (!this.process) {
        resolve();
        return;
      }

      const killTimeout = setTimeout(() => {
        if (this.process) {
          this.logger.warn(`${this.getServiceName()} process did not exit gracefully, forcing kill`);
          this.process.kill('SIGKILL');
        }
        resolve();
      }, this.shutdownTimeoutMs);

      this.process.on('close', () => {
        clearTimeout(killTimeout);
        this.process = null;
        this.currentTunnel = null;
        this.isRunning = false;
        this.logger.log(`${this.getServiceName()} tunnel stopped`);
        resolve();
      });

      this.process.kill('SIGTERM');
    });
  }

  /**
   * Get current tunnel information.
   */
  getTunnel(): TunnelInfo | null {
    return this.currentTunnel;
  }

  /**
   * Check if tunnel is currently running.
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Get public URL if tunnel is active.
   */
  getPublicUrl(): string | null {
    return this.currentTunnel?.publicUrl || null;
  }
}
