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
  lastError?: string;
  startTime?: Date;
}

/**
 * Service to manage Tailscale Serve as a background process
 */
export class TailscaleServeServiceImpl implements TailscaleServeService {
  private serveProcess: ChildProcess | null = null;
  private currentPort: number | null = null;
  private isStarting = false;
  private tailscaleExecutable = 'tailscale'; // Default to PATH lookup
  private lastError: string | undefined;
  private startTime: Date | undefined;

  async start(port: number): Promise<void> {
    if (this.isStarting) {
      throw new Error('Tailscale Serve is already starting');
    }

    if (this.serveProcess) {
      logger.info('Tailscale Serve is already running, stopping first...');
      await this.stop();
    }

    this.isStarting = true;
    this.lastError = undefined; // Clear previous errors

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
          resetProcess.on('exit', (code) => {
            if (code === 0) {
              logger.debug('Previous Tailscale serve configuration reset successfully');
            } else {
              logger.debug(`Tailscale serve reset exited with code ${code} (may be normal if no config exists)`);
            }
            resolve();
          });
          resetProcess.on('error', (error) => {
            logger.debug(`Tailscale serve reset error: ${error.message} (may be normal)`);
            resolve(); // Continue even if reset fails
          });
          setTimeout(() => {
            if (!resetProcess.killed) {
              resetProcess.kill('SIGTERM');
            }
            resolve();
          }, 3000); // Timeout after 3 seconds
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
        this.lastError = error.message;
        this.cleanup();
      });

      this.serveProcess.on('exit', (code, signal) => {
        logger.info(`Tailscale Serve process exited with code ${code}, signal ${signal}`);
        if (code !== 0) {
          this.lastError = `Process exited with code ${code}`;
        }
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
          const stderr = data.toString().trim();
          logger.debug(`Tailscale Serve stderr: ${stderr}`);
          
          // Capture common error patterns and provide helpful hints
          if (stderr.includes('error') || stderr.includes('failed')) {
            this.lastError = stderr;
            
            // Provide specific guidance for common issues
            if (stderr.includes('dns') || stderr.includes('DNS') || stderr.includes('resolve')) {
              this.lastError += '\nHint: DNS resolution issues detected. Check your network settings, disable ad blockers like AdGuard, or try: sudo dscacheutil -flushcache';
            } else if (stderr.includes('connection refused') || stderr.includes('connect: connection refused')) {
              this.lastError += '\nHint: Connection refused. Make sure VibeTunnel is running and accessible on the specified port.';
            } else if (stderr.includes('permission') || stderr.includes('Permission')) {
              this.lastError += '\nHint: Permission issue. Try running with appropriate privileges or check Tailscale authentication.';
            } else if (stderr.includes('tailnet') || stderr.includes('not connected')) {
              this.lastError += '\nHint: Tailscale connection issue. Make sure you are logged in to Tailscale: tailscale status';
            }
          }
        });
      }

      // Wait a moment to see if it starts successfully
      await new Promise<void>((resolve, reject) => {
        let settled = false;

        const settlePromise = (isSuccess: boolean, error?: Error | string) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);

          if (isSuccess) {
            logger.info('Tailscale Serve started successfully');
            this.startTime = new Date();
            resolve();
          } else {
            const errorMessage =
              error instanceof Error ? error.message : error || 'Tailscale Serve failed to start';
            this.lastError = errorMessage;
            reject(new Error(errorMessage));
          }
        };

        const timeout = setTimeout(() => {
          if (this.serveProcess && !this.serveProcess.killed) {
            settlePromise(true);
          } else {
            settlePromise(false, this.lastError);
          }
        }, 5000); // Wait 5 seconds for configuration to apply

        if (this.serveProcess) {
          this.serveProcess.once('error', (error) => {
            settlePromise(false, error);
          });

          this.serveProcess.once('exit', (code) => {
            // For 'tailscale serve', exit code 0 means success - the serve config was applied
            // The tailscale serve command configures the serve and then exits
            if (code === 0) {
              logger.debug('Tailscale Serve configuration applied successfully');
              settlePromise(true);
            } else {
              settlePromise(false, `Tailscale Serve configuration failed with exit code ${code}`);
            }
          });
        }
      });
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
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
        // Clear configuration state when stopping
        this.currentPort = null;
        this.startTime = undefined;
        this.lastError = undefined;
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
    // Since tailscale serve doesn't run as a persistent process, we consider it
    // "running" if we have successfully configured it and haven't stopped it
    return this.currentPort !== null && this.startTime !== undefined && !this.lastError;
  }

  async getStatus(): Promise<TailscaleServeStatus> {
    const isRunning = this.isRunning();

    // Debug mode: simulate errors based on environment variable
    if (process.env.VIBETUNNEL_TAILSCALE_ERROR) {
      return {
        isRunning: false,
        lastError: process.env.VIBETUNNEL_TAILSCALE_ERROR,
      };
    }

    // If we think we're running, verify by checking actual Tailscale serve status
    if (isRunning && this.currentPort) {
      try {
        const verificationResult = await this.verifyServeConfiguration(this.currentPort);
        if (!verificationResult.isConfigured) {
          // Configuration is no longer active
          this.lastError = verificationResult.error || 'Tailscale serve configuration is no longer active';
          this.currentPort = null;
          this.startTime = undefined;
          return {
            isRunning: false,
            lastError: this.lastError,
          };
        }
      } catch (error) {
        logger.debug('Failed to verify Tailscale serve configuration:', error);
        // Don't fail the status check if verification fails
      }
    }

    return {
      isRunning,
      port: isRunning ? (this.currentPort ?? undefined) : undefined,
      lastError: this.lastError,
      startTime: this.startTime,
    };
  }

  private cleanup(): void {
    // Kill the process if it's still running (usually only during setup/teardown)
    if (this.serveProcess && !this.serveProcess.killed) {
      logger.debug('Terminating Tailscale Serve configuration process');
      try {
        this.serveProcess.kill('SIGTERM');
        // Give it a moment to terminate gracefully
        setTimeout(() => {
          if (this.serveProcess && !this.serveProcess.killed) {
            logger.warn('Force killing Tailscale Serve configuration process');
            this.serveProcess.kill('SIGKILL');
          }
        }, 1000);
      } catch (error) {
        logger.error('Failed to kill Tailscale Serve configuration process:', error);
      }
    }

    this.serveProcess = null;
    this.isStarting = false;
    // Don't clear currentPort and startTime here unless we're actually stopping
    // Keep lastError for debugging
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

  /**
   * Verify that the Tailscale serve configuration is actually active
   */
  private async verifyServeConfiguration(port: number): Promise<{isConfigured: boolean, error?: string}> {
    return new Promise((resolve) => {
      const checkProcess = spawn(this.tailscaleExecutable, ['serve', 'status'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      if (checkProcess.stdout) {
        checkProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });
      }

      if (checkProcess.stderr) {
        checkProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });
      }

      checkProcess.on('exit', (code) => {
        if (code === 0) {
          // Check if our port is mentioned in the output
          const portString = port.toString();
          if (stdout.includes(portString) || stdout.includes(`localhost:${portString}`) || stdout.includes(`127.0.0.1:${portString}`)) {
            resolve({ isConfigured: true });
          } else {
            resolve({ 
              isConfigured: false, 
              error: `Port ${port} not found in active Tailscale serve configuration`
            });
          }
        } else {
          resolve({ 
            isConfigured: false, 
            error: `Failed to check Tailscale serve status (exit code ${code}): ${stderr.trim()}`
          });
        }
      });

      checkProcess.on('error', (error) => {
        resolve({ 
          isConfigured: false, 
          error: `Error checking Tailscale serve status: ${error.message}`
        });
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        if (!checkProcess.killed) {
          checkProcess.kill('SIGTERM');
          resolve({ 
            isConfigured: false, 
            error: 'Timeout checking Tailscale serve status'
          });
        }
      }, 5000);
    });
  }
}

// Singleton instance
export const tailscaleServeService = new TailscaleServeServiceImpl();
