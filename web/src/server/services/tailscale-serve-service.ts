import { type ChildProcess, spawn } from 'child_process';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('tailscale-serve');

export interface TailscaleServeService {
  start(port: number): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  getStatus(): Promise<TailscaleServeStatus>;
}

export interface TailscaleServeStatus {
  isRunning: boolean;
  port?: number;
  error?: string;
}

/**
 * Service to manage Tailscale Serve as a background process
 */
export class TailscaleServeServiceImpl implements TailscaleServeService {
  private serveProcess: ChildProcess | null = null;
  private currentPort: number | null = null;
  private isStarting = false;
  private tailscaleExecutable = 'tailscale'; // Default to PATH lookup

  async start(port: number): Promise<void> {
    if (this.isStarting) {
      throw new Error('Tailscale Serve is already starting');
    }

    if (this.serveProcess) {
      logger.info('Tailscale Serve is already running, stopping first...');
      await this.stop();
    }

    this.isStarting = true;

    try {
      // Check if tailscale command is available
      await this.checkTailscaleAvailable();

      // First, reset any existing serve configuration
      try {
        logger.debug('Resetting Tailscale Serve configuration...');
        const resetProcess = spawn(this.tailscaleExecutable, ['serve', 'reset'], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        await new Promise<void>((resolve) => {
          resetProcess.on('exit', () => resolve());
          resetProcess.on('error', () => resolve()); // Continue even if reset fails
          setTimeout(resolve, 1000); // Timeout after 1 second
        });
      } catch (_error) {
        logger.debug('Failed to reset serve config (this is normal if none exists)');
      }

      // TCP port: tailscale serve port
      const args = ['serve', port.toString()];
      logger.info(`Starting Tailscale Serve on port ${port}`);
      logger.debug(`Command: ${this.tailscaleExecutable} ${args.join(' ')}`);
      this.currentPort = port;

      // Start the serve process
      this.serveProcess = spawn(this.tailscaleExecutable, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false, // Keep it attached to our process
      });

      // Handle process events
      this.serveProcess.on('error', (error) => {
        logger.error(`Tailscale Serve process error: ${error.message}`);
        this.cleanup();
      });

      this.serveProcess.on('exit', (code, signal) => {
        logger.info(`Tailscale Serve process exited with code ${code}, signal ${signal}`);
        this.cleanup();
      });

      // Log stdout/stderr
      if (this.serveProcess.stdout) {
        this.serveProcess.stdout.on('data', (data) => {
          logger.debug(`Tailscale Serve stdout: ${data.toString().trim()}`);
        });
      }

      if (this.serveProcess.stderr) {
        this.serveProcess.stderr.on('data', (data) => {
          logger.debug(`Tailscale Serve stderr: ${data.toString().trim()}`);
        });
      }

      // Wait a moment to see if it starts successfully
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (this.serveProcess && !this.serveProcess.killed) {
            logger.info('Tailscale Serve started successfully');
            resolve();
          } else {
            reject(new Error('Tailscale Serve failed to start'));
          }
        }, 3000); // Wait 3 seconds

        if (this.serveProcess) {
          this.serveProcess.once('error', (error) => {
            clearTimeout(timeout);
            reject(error);
          });

          this.serveProcess.once('exit', (code) => {
            clearTimeout(timeout);
            // Any exit during startup is considered a failure
            reject(new Error(`Tailscale Serve exited unexpectedly with code ${code}`));
          });
        }
      });
    } catch (error) {
      this.cleanup();
      throw error;
    } finally {
      this.isStarting = false;
    }
  }

  async stop(): Promise<void> {
    // First try to remove the serve configuration
    try {
      logger.debug('Removing Tailscale Serve configuration...');

      // Use 'reset' to completely clear all serve configuration
      const resetProcess = spawn(this.tailscaleExecutable, ['serve', 'reset'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      await new Promise<void>((resolve) => {
        resetProcess.on('exit', (code) => {
          if (code === 0) {
            logger.debug('Tailscale Serve configuration reset successfully');
          }
          resolve();
        });
        resetProcess.on('error', () => resolve());
        setTimeout(resolve, 2000); // Timeout after 2 seconds
      });
    } catch (_error) {
      logger.debug('Failed to reset serve config during stop');
    }

    if (!this.serveProcess) {
      logger.debug('No Tailscale Serve process to stop');
      return;
    }

    logger.info('Stopping Tailscale Serve process...');

    return new Promise<void>((resolve) => {
      if (!this.serveProcess) {
        resolve();
        return;
      }

      const cleanup = () => {
        this.cleanup();
        resolve();
      };

      // Set a timeout to force kill if graceful shutdown fails
      const forceKillTimeout = setTimeout(() => {
        if (this.serveProcess && !this.serveProcess.killed) {
          logger.warn('Force killing Tailscale Serve process');
          this.serveProcess.kill('SIGKILL');
        }
        cleanup();
      }, 5000);

      this.serveProcess.once('exit', () => {
        clearTimeout(forceKillTimeout);
        cleanup();
      });

      // Try graceful shutdown first
      this.serveProcess.kill('SIGTERM');
    });
  }

  isRunning(): boolean {
    return this.serveProcess !== null && !this.serveProcess.killed;
  }

  async getStatus(): Promise<TailscaleServeStatus> {
    const isRunning = this.isRunning();

    return {
      isRunning,
      port: isRunning ? (this.currentPort ?? undefined) : undefined,
    };
  }

  private cleanup(): void {
    this.serveProcess = null;
    this.currentPort = null;
    this.isStarting = false;
  }

  private async checkTailscaleAvailable(): Promise<void> {
    const fs = await import('fs/promises');

    // Platform-specific paths to check
    let tailscalePaths: string[] = [];

    if (process.platform === 'darwin') {
      // macOS paths
      tailscalePaths = [
        '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
        '/usr/local/bin/tailscale',
        '/opt/homebrew/bin/tailscale',
      ];
    } else if (process.platform === 'linux') {
      // Linux paths
      tailscalePaths = [
        '/usr/bin/tailscale',
        '/usr/local/bin/tailscale',
        '/opt/tailscale/bin/tailscale',
        '/snap/bin/tailscale',
      ];
    }

    // Check platform-specific paths first
    for (const path of tailscalePaths) {
      try {
        await fs.access(path, fs.constants.X_OK);
        this.tailscaleExecutable = path;
        logger.debug(`Found Tailscale at: ${path}`);
        return;
      } catch {
        // Continue checking other paths
      }
    }

    // Fallback to checking PATH
    return new Promise<void>((resolve, reject) => {
      const checkProcess = spawn('which', ['tailscale'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      checkProcess.on('exit', (code) => {
        if (code === 0) {
          // Keep default 'tailscale' which will use PATH
          resolve();
        } else {
          reject(new Error('Tailscale command not found. Please install Tailscale first.'));
        }
      });

      checkProcess.on('error', (error) => {
        reject(new Error(`Failed to check Tailscale availability: ${error.message}`));
      });
    });
  }
}

// Singleton instance
export const tailscaleServeService = new TailscaleServeServiceImpl();
