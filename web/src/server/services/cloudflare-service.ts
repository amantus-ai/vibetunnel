import { type ChildProcess, spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('cloudflare-service');

export interface CloudflareTunnel {
  publicUrl: string;
  proto: string;
  name: string;
  uri: string;
}

export class CloudflareService {
  private cloudflaredProcess: ChildProcess | null = null;
  private currentTunnel: CloudflareTunnel | null = null;
  private isRunning = false;
  private cloudflaredPath: string | null = null;

  constructor(private port: number) {}

  /**
   * Standard paths to check for cloudflared binary
   */
  private static readonly cloudflaredPaths = [
    'cloudflared', // Global PATH
    '/usr/local/bin/cloudflared',
    '/opt/homebrew/bin/cloudflared',
    '/usr/bin/cloudflared',
    path.join(os.homedir(), '.cloudflared', 'cloudflared'),
    // Windows paths
    'C:\\Program Files\\Cloudflare\\cloudflared\\cloudflared.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'cloudflared', 'cloudflared.exe'),
  ];

  /**
   * Check if cloudflared binary is available
   */
  private async checkCloudflaredBinary(): Promise<string | null> {
    for (const cloudflaredPath of CloudflareService.cloudflaredPaths) {
      try {
        const result = await new Promise<boolean>((resolve) => {
          const proc = spawn(cloudflaredPath, ['--version'], { stdio: 'ignore' });
          proc.on('close', (code) => resolve(code === 0));
          proc.on('error', () => resolve(false));
          // Timeout after 2 seconds
          setTimeout(() => {
            proc.kill();
            resolve(false);
          }, 2000);
        });
        if (result) {
          logger.debug(`Found cloudflared at: ${cloudflaredPath}`);
          return cloudflaredPath;
        }
      } catch {
        // Continue checking other paths
      }
    }

    return null;
  }

  /**
   * Start Cloudflare tunnel (Quick Tunnel)
   */
  async start(): Promise<CloudflareTunnel> {
    if (this.isRunning) {
      logger.warn('Cloudflare tunnel is already running');
      if (this.currentTunnel) {
        return this.currentTunnel;
      }
    }

    this.cloudflaredPath = await this.checkCloudflaredBinary();
    if (!this.cloudflaredPath) {
      throw new Error(
        'cloudflared binary not found. Please install cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/'
      );
    }

    // Use Quick Tunnel (no auth required)
    const args = ['tunnel', '--url', `http://localhost:${this.port}`];

    logger.log(`Starting Cloudflare tunnel on port ${this.port}...`);

    const cloudflaredPath = this.cloudflaredPath;
    if (!cloudflaredPath) {
      throw new Error(
        'cloudflared binary not found. Please install cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/'
      );
    }

    return new Promise((resolve, reject) => {
      this.cloudflaredProcess = spawn(cloudflaredPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let startupTimeout: NodeJS.Timeout;
      let resolved = false;

      const cleanup = () => {
        if (startupTimeout) clearTimeout(startupTimeout);
      };

      const handleOutput = (data: Buffer) => {
        const output = data.toString();
        logger.debug('Cloudflare output:', output);

        // Look for tunnel URL in output
        // Cloudflare outputs something like: "https://random-words.trycloudflare.com"
        const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (urlMatch && !resolved) {
          resolved = true;
          const publicUrl = urlMatch[0];
          this.currentTunnel = {
            publicUrl,
            proto: 'https',
            name: 'cloudflare-quick-tunnel',
            uri: `http://localhost:${this.port}`,
          };
          this.isRunning = true;
          cleanup();
          logger.log(`Cloudflare tunnel started: ${publicUrl}`);
          resolve(this.currentTunnel);
        }

        // Look for error messages
        if (output.toLowerCase().includes('error') && !resolved) {
          logger.error('Cloudflare error:', output);
        }
      };

      this.cloudflaredProcess.stdout?.on('data', handleOutput);
      this.cloudflaredProcess.stderr?.on('data', handleOutput);

      this.cloudflaredProcess.on('error', (error) => {
        if (!resolved) {
          resolved = true;
          this.isRunning = false;
          cleanup();
          reject(new Error(`Failed to start cloudflared: ${error.message}`));
        }
      });

      this.cloudflaredProcess.on('close', (code) => {
        this.isRunning = false;
        this.currentTunnel = null;
        if (code !== 0 && code !== null) {
          logger.error(`Cloudflared process exited with code ${code}`);
        }
      });

      // Timeout if tunnel doesn't start
      startupTimeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.stop().catch(() => {});
          reject(new Error('Cloudflare tunnel startup timeout - tunnel failed to start'));
        }
      }, 30000);
    });
  }

  /**
   * Stop Cloudflare tunnel
   */
  async stop(): Promise<void> {
    if (!this.cloudflaredProcess) {
      return;
    }

    logger.log('Stopping Cloudflare tunnel...');

    return new Promise((resolve) => {
      if (!this.cloudflaredProcess) {
        resolve();
        return;
      }

      const killTimeout = setTimeout(() => {
        if (this.cloudflaredProcess) {
          logger.warn('Cloudflared process did not exit gracefully, forcing kill');
          this.cloudflaredProcess.kill('SIGKILL');
        }
        resolve();
      }, 5000);

      this.cloudflaredProcess.on('close', () => {
        clearTimeout(killTimeout);
        this.cloudflaredProcess = null;
        this.currentTunnel = null;
        this.isRunning = false;
        logger.log('Cloudflare tunnel stopped');
        resolve();
      });

      this.cloudflaredProcess.kill('SIGTERM');
    });
  }

  /**
   * Get current tunnel information
   */
  getTunnel(): CloudflareTunnel | null {
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

  /**
   * Check if cloudflared is installed
   */
  async checkInstallation(): Promise<boolean> {
    this.cloudflaredPath = await this.checkCloudflaredBinary();
    return this.cloudflaredPath !== null;
  }
}
