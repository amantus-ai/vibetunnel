import { type ChildProcess, spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ngrok-service');

export interface NgrokConfig {
  authToken?: string;
  domain?: string;
  port: number;
  region?: string;
}

export interface NgrokTunnel {
  publicUrl: string;
  proto: string;
  name: string;
  uri: string;
}

export class NgrokService {
  private ngrokProcess: ChildProcess | null = null;
  private currentTunnel: NgrokTunnel | null = null;
  private isRunning = false;

  constructor(private config: NgrokConfig) {}

  /**
   * Check if ngrok binary is available
   */
  private async checkNgrokBinary(): Promise<string | null> {
    const possiblePaths = [
      'ngrok', // Global PATH
      '/usr/local/bin/ngrok',
      '/opt/homebrew/bin/ngrok',
      path.join(os.homedir(), '.local', 'bin', 'ngrok'),
      // Windows paths
      'C:\\Program Files\\ngrok\\ngrok.exe',
      path.join(os.homedir(), 'AppData', 'Local', 'ngrok', 'ngrok.exe'),
    ];

    for (const ngrokPath of possiblePaths) {
      try {
        const result = await new Promise<boolean>((resolve) => {
          const proc = spawn(ngrokPath, ['version'], { stdio: 'ignore' });
          proc.on('close', (code) => resolve(code === 0));
          proc.on('error', () => resolve(false));
          // Timeout after 2 seconds
          setTimeout(() => {
            proc.kill();
            resolve(false);
          }, 2000);
        });
        if (result) {
          logger.debug(`Found ngrok at: ${ngrokPath}`);
          return ngrokPath;
        }
      } catch {
        // Continue checking other paths
      }
    }

    return null;
  }

  /**
   * Start ngrok tunnel
   */
  async start(): Promise<NgrokTunnel> {
    if (this.isRunning) {
      logger.warn('Ngrok tunnel is already running');
      if (this.currentTunnel) {
        return this.currentTunnel;
      }
    }

    const ngrokPath = await this.checkNgrokBinary();
    if (!ngrokPath) {
      throw new Error('ngrok binary not found. Please install ngrok: https://ngrok.com/download');
    }

    // Build ngrok command arguments
    const args = ['http', String(this.config.port), '--log=stdout', '--log-format=json'];

    if (this.config.authToken) {
      args.push('--authtoken', this.config.authToken);
    }

    if (this.config.domain) {
      args.push('--domain', this.config.domain);
    }

    if (this.config.region) {
      args.push('--region', this.config.region);
    }

    logger.log(`Starting ngrok tunnel on port ${this.config.port}...`);

    return new Promise((resolve, reject) => {
      this.ngrokProcess = spawn(ngrokPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let startupTimeout: NodeJS.Timeout;
      let resolved = false;

      const cleanup = () => {
        if (startupTimeout) clearTimeout(startupTimeout);
      };

      const handleOutput = (data: Buffer) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const log = JSON.parse(line);

            // Look for tunnel started message
            if (log.msg === 'started tunnel' && log.url && !resolved) {
              resolved = true;
              this.currentTunnel = {
                publicUrl: log.url,
                proto: 'http',
                name: 'command_line',
                uri: `http://localhost:${this.config.port}`,
              };
              this.isRunning = true;
              cleanup();
              logger.log(`Ngrok tunnel started: ${log.url}`);
              resolve(this.currentTunnel);
            }

            // Log errors
            if (log.lvl === 'error' || log.err) {
              logger.error('Ngrok error:', log.err || log.msg);
            }
          } catch {
            // Not JSON, log as debug
            logger.debug('Ngrok output:', line);
          }
        }
      };

      this.ngrokProcess.stdout?.on('data', handleOutput);
      this.ngrokProcess.stderr?.on('data', (data) => {
        logger.error('Ngrok stderr:', data.toString());
      });

      this.ngrokProcess.on('error', (error) => {
        if (!resolved) {
          resolved = true;
          this.isRunning = false;
          cleanup();
          reject(new Error(`Failed to start ngrok: ${error.message}`));
        }
      });

      this.ngrokProcess.on('close', (code) => {
        this.isRunning = false;
        this.currentTunnel = null;
        if (code !== 0 && code !== null) {
          logger.error(`Ngrok process exited with code ${code}`);
        }
      });

      // Timeout if tunnel doesn't start
      startupTimeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.stop().catch(() => {});
          reject(new Error('Ngrok startup timeout - tunnel failed to start'));
        }
      }, 30000);
    });
  }

  /**
   * Stop ngrok tunnel
   */
  async stop(): Promise<void> {
    if (!this.ngrokProcess) {
      return;
    }

    logger.log('Stopping ngrok tunnel...');

    return new Promise((resolve) => {
      if (!this.ngrokProcess) {
        resolve();
        return;
      }

      const killTimeout = setTimeout(() => {
        if (this.ngrokProcess) {
          logger.warn('Ngrok process did not exit gracefully, forcing kill');
          this.ngrokProcess.kill('SIGKILL');
        }
        resolve();
      }, 5000);

      this.ngrokProcess.on('close', () => {
        clearTimeout(killTimeout);
        this.ngrokProcess = null;
        this.currentTunnel = null;
        this.isRunning = false;
        logger.log('Ngrok tunnel stopped');
        resolve();
      });

      this.ngrokProcess.kill('SIGTERM');
    });
  }

  /**
   * Get current tunnel information
   */
  getTunnel(): NgrokTunnel | null {
    return this.currentTunnel;
  }

  /**
   * Check if tunnel is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Get public URL if available
   */
  getPublicUrl(): string | null {
    return this.currentTunnel?.publicUrl || null;
  }
}
