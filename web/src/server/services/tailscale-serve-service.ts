import { type ChildProcess, spawn } from 'child_process';
import { constants as fsConstants } from 'fs';
import { access } from 'fs/promises';
import { delimiter, join } from 'path';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('tailscale-serve');

export function getTailscaleSearchPaths(
  platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env
): string[] {
  const pathEntries = (environment.PATH?.split(delimiter) ?? [])
    .filter((entry) => entry.length > 0)
    .map((entry) => join(entry, platform === 'win32' ? 'tailscale.exe' : 'tailscale'));
  const nixPaths = [
    '/run/current-system/sw/bin/tailscale',
    environment.USER ? `/etc/profiles/per-user/${environment.USER}/bin/tailscale` : undefined,
    environment.HOME ? `${environment.HOME}/.nix-profile/bin/tailscale` : undefined,
  ].filter((path): path is string => path !== undefined);

  if (platform === 'darwin') {
    return Array.from(
      new Set([
        '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
        '/usr/local/bin/tailscale',
        '/opt/homebrew/bin/tailscale',
        ...nixPaths,
        ...pathEntries,
      ])
    );
  }

  if (platform === 'linux') {
    return Array.from(
      new Set([
        '/usr/bin/tailscale',
        '/usr/local/bin/tailscale',
        '/opt/tailscale/bin/tailscale',
        '/snap/bin/tailscale',
        ...nixPaths,
        ...pathEntries,
      ])
    );
  }

  return Array.from(new Set([...nixPaths, ...pathEntries]));
}

export async function findTailscaleExecutable(
  searchPaths = getTailscaleSearchPaths()
): Promise<string | null> {
  for (const executablePath of searchPaths) {
    try {
      await access(executablePath, fsConstants.X_OK);
      return executablePath;
    } catch {
      // Continue checking other paths.
    }
  }

  return null;
}

export interface TailscaleServeService {
  start(port: number, enableFunnel?: boolean): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  isFunnelEnabled(): boolean;
  getStatus(): Promise<TailscaleServeStatus>;
  getExecutablePath(): Promise<string>;
}

export interface TailscaleServeStatus {
  isRunning: boolean;
  port?: number;
  error?: string;
  lastError?: string;
  startTime?: Date;
  isPermanentlyDisabled?: boolean;
  funnelEnabled?: boolean;
  funnelStartTime?: Date;
  desiredMode?: 'private' | 'public'; // What the user requested
  actualMode?: 'private' | 'public'; // What's actually running
  funnelError?: string; // Specific Funnel error if it failed
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
  private isPermanentlyDisabled = false;
  private funnelEnabled = false;
  private funnelStartTime: Date | undefined;
  private desiredFunnel = false; // Track what the user requested
  private funnelError: string | undefined; // Track specific Funnel errors

  async start(port: number, enableFunnel = false): Promise<void> {
    logger.info(
      `🚀 Starting Tailscale Serve on port ${port} ${enableFunnel ? 'with Funnel (Public Internet)' : '(Tailnet only - Private)'}`
    );

    if (this.isPermanentlyDisabled) {
      logger.warn(`❌ Cannot start - permanently disabled on this tailnet`);
      throw new Error('Tailscale Serve is permanently disabled on this tailnet');
    }

    if (this.isStarting) {
      logger.warn(`⚠️ Already starting, rejecting duplicate request`);
      throw new Error('Tailscale Serve is already starting');
    }

    if (this.serveProcess) {
      logger.info('🔄 Serve already running, stopping first...');
      await this.stop();
    }

    this.isStarting = true;
    this.lastError = undefined; // Clear previous errors
    this.funnelError = undefined; // Clear previous Funnel errors
    this.currentPort = port; // Set the port even if start fails

    // Store what the user requested
    this.desiredFunnel = enableFunnel;
    logger.info(
      `🌍 ${enableFunnel ? 'PUBLIC Internet access (Funnel)' : 'PRIVATE Tailnet-only access (no Funnel)'} requested`
    );
    this.funnelEnabled = false; // Reset initially, will enable after Serve starts

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

      // Set up HTTPS proxy to local port using new CLI syntax
      // Format: tailscale serve --bg http://localhost:4020
      const args = ['serve', '--bg', `http://localhost:${port}`];
      logger.info(`🚀 Starting Tailscale Serve - HTTPS proxy to localhost:${port}`);
      logger.debug(`🔧 Command: ${this.tailscaleExecutable} ${args.join(' ')}`);
      this.currentPort = port;

      // Start the serve process
      this.serveProcess = spawn(this.tailscaleExecutable, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false, // Keep it attached to our process
      });

      // Handle process events
      this.serveProcess.on('error', (error) => {
        logger.info(`Tailscale Serve process error: ${error.message}`);
        this.lastError = error.message;
        this.cleanup();
      });

      this.serveProcess.on('exit', (code, signal) => {
        this.handleServeProcessExit(code, signal);
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

          // Handle specific "Serve not enabled on tailnet" error
          if (stderr.includes('Serve is not enabled on your tailnet')) {
            logger.warn(
              'Tailscale Serve is not enabled on this tailnet - marking as permanently disabled'
            );
            this.lastError = 'Tailscale Serve feature not enabled on your tailnet';
            this.isPermanentlyDisabled = true;
            return;
          }

          // Capture other common error patterns
          if (stderr.includes('error') || stderr.includes('failed')) {
            this.lastError = stderr;
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
        }, 3000); // Wait 3 seconds

        if (this.serveProcess) {
          this.serveProcess.once('error', (error) => {
            settlePromise(false, error);
          });

          this.serveProcess.once('exit', (code) => {
            // With --bg flag, the command exits immediately after configuration
            // Exit code 0 means successful configuration
            if (code === 0) {
              logger.info('Tailscale Serve configured successfully (exit code 0)');
              // The serve process is now running in background
              this.serveProcess = null; // Clear reference as process has exited
              clearTimeout(timeout);
              void this.waitForServeConfiguration(port).then(
                (isConfigured) => {
                  settlePromise(
                    isConfigured,
                    'Tailscale Serve proxy was not configured after the command completed'
                  );
                },
                (error) => settlePromise(false, error)
              );
            } else {
              settlePromise(false, `Tailscale Serve failed with exit code ${code}`);
            }
          });
        }
      });

      // If Funnel is requested (Public Internet access), start Funnel after Serve
      if (enableFunnel) {
        logger.info(
          `🌍 Starting Funnel for PUBLIC internet access on HTTPS port 443 (Serve to localhost:${port} completed successfully)`
        );
        try {
          await this.startFunnel(port);
          logger.info(
            `✅ Funnel started successfully - VibeTunnel now accessible via public internet`
          );
        } catch (funnelError) {
          const errorMsg = funnelError instanceof Error ? funnelError.message : String(funnelError);
          this.funnelError = errorMsg;
          logger.info(`❌ Failed to start Funnel: ${errorMsg}`);
          logger.warn(
            `Funnel failed to start, continuing with PRIVATE Tailnet-only access: ${errorMsg}`
          );
          // Don't throw - Serve is still working for Tailnet access
        }
      } else {
        logger.info(
          `🔒 Running in PRIVATE mode - accessible only within your Tailnet, not from public internet`
        );
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.cleanup();
      throw error;
    } finally {
      this.isStarting = false;
    }
  }

  /**
   * Start Tailscale Funnel for public internet access
   */
  private async startFunnel(port: number): Promise<void> {
    // Funnel operates on the HTTPS port that Tailscale Serve uses (443), not the local port
    const httpsPort = 443;
    logger.info(
      `🌍 Starting Tailscale Funnel on HTTPS port ${httpsPort} for public internet access (proxying to local port ${port})`
    );

    // First, reset any existing Funnel configuration to avoid "foreground already exists" error
    try {
      logger.debug('Resetting Funnel configuration before starting...');
      const resetProcess = spawn(this.tailscaleExecutable, ['funnel', 'reset'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      await new Promise<void>((resolve) => {
        resetProcess.on('exit', () => resolve());
        resetProcess.on('error', () => resolve()); // Continue even if reset fails
        setTimeout(resolve, 2000); // Timeout after 2 seconds
      });
      logger.debug('Funnel configuration reset completed');
    } catch (_error) {
      logger.debug('Failed to reset Funnel config (this is normal if none exists)');
    }

    logger.debug(
      `🔧 Command: ${this.tailscaleExecutable} funnel --bg --https=${httpsPort} http://localhost:${port}`
    );

    try {
      // Enable Funnel with the correct proxy target
      // Must specify the full target URL to avoid overriding the proxy destination
      const funnelProcess = spawn(
        this.tailscaleExecutable,
        ['funnel', '--bg', `--https=${httpsPort}`, `http://localhost:${port}`],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );

      logger.debug(`📝 Process spawned with PID: ${funnelProcess.pid}`);

      let stdout = '';
      let stderr = '';

      if (funnelProcess.stdout) {
        funnelProcess.stdout.on('data', (data) => {
          stdout += data.toString();
          logger.debug(`📤 Funnel stdout: ${data.toString().trim()}`);
        });
      }

      if (funnelProcess.stderr) {
        funnelProcess.stderr.on('data', (data) => {
          stderr += data.toString();
          logger.debug(`📥 Funnel stderr: ${data.toString().trim()}`);
        });
      }

      // Wait for funnel to start
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Funnel start timeout'));
        }, 10000); // 10 second timeout

        funnelProcess.on('exit', (code) => {
          clearTimeout(timeout);
          logger.debug(`🔚 Funnel process exited with code: ${code}`);
          if (stderr.trim()) {
            logger.debug(`📥 Funnel stderr: ${stderr.trim()}`);
          }
          if (stdout.trim()) {
            logger.debug(`📤 Funnel stdout: ${stdout.trim()}`);
          }

          if (code === 0) {
            logger.info('✅ Tailscale Funnel started successfully');
            this.funnelEnabled = true;
            this.funnelError = undefined; // Clear any previous Funnel errors
            this.funnelStartTime = new Date();
            resolve();
          } else {
            logger.info(`❌ Funnel failed with exit code ${code}: ${stderr || 'No error message'}`);
            reject(new Error(`Funnel failed with exit code ${code}: ${stderr}`));
          }
        });

        funnelProcess.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.info(`Failed to start Tailscale Funnel: ${errorMsg}`);
      throw new Error(`Funnel start failed: ${errorMsg}`);
    }
  }

  /**
   * Stop Tailscale Funnel
   */
  private async stopFunnel(): Promise<void> {
    if (!this.funnelEnabled) {
      return;
    }

    try {
      logger.info('Stopping Tailscale Funnel...');

      // Reset funnel configuration
      const resetProcess = spawn(this.tailscaleExecutable, ['funnel', 'reset'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      await new Promise<void>((resolve) => {
        resetProcess.on('exit', (code) => {
          if (code === 0) {
            logger.info('✅ Tailscale Funnel stopped successfully');
          } else {
            logger.warn(`Funnel reset exited with code ${code}`);
          }
          resolve();
        });
        resetProcess.on('error', () => resolve());
        setTimeout(resolve, 3000); // Timeout after 3 seconds
      });

      this.funnelEnabled = false;
      this.funnelStartTime = undefined;
    } catch (error) {
      logger.info(`Failed to stop Funnel: ${error}`);
      throw error;
    }
  }

  async stop(): Promise<void> {
    // First, stop Funnel if it's enabled
    if (this.funnelEnabled) {
      try {
        logger.info('🌍 Stopping Tailscale Funnel...');
        await this.stopFunnel();
      } catch (error) {
        logger.warn(`Failed to stop Funnel: ${error}`);
      }
    }

    if (!this.serveProcess && this.currentPort === null) {
      logger.debug('No Tailscale Serve configuration to stop');
      this.cleanup();
      return;
    }

    // Reset Serve configuration (since --bg usually leaves no process to kill).
    const resetSucceeded = await this.resetServeConfiguration();
    if (!resetSucceeded) {
      this.lastError = 'Failed to reset Tailscale Serve configuration';
      logger.warn(this.lastError);
      if (!this.serveProcess) {
        return;
      }
    } else {
      this.lastError = undefined;
    }

    if (!this.serveProcess) {
      logger.debug('No Tailscale Serve process to stop');
      this.cleanup();
      return;
    }

    logger.info('Stopping Tailscale Serve process...');
    const stateToPreserve = resetSucceeded
      ? null
      : {
          currentPort: this.currentPort,
          lastError: this.lastError,
          startTime: this.startTime,
        };

    return new Promise<void>((resolve) => {
      if (!this.serveProcess) {
        resolve();
        return;
      }

      const cleanup = () => {
        this.cleanup();
        if (stateToPreserve) {
          this.currentPort = stateToPreserve.currentPort;
          this.lastError = stateToPreserve.lastError;
          this.startTime = stateToPreserve.startTime;
        }
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

  private async resetServeConfiguration(): Promise<boolean> {
    logger.debug('Removing Tailscale Serve configuration...');

    try {
      const resetProcess = spawn(this.tailscaleExecutable, ['serve', 'reset'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      return await new Promise<boolean>((resolve) => {
        let settled = false;

        const settle = (succeeded: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve(succeeded);
        };

        resetProcess.once('exit', (code) => {
          if (code === 0) {
            logger.debug('Tailscale Serve configuration reset successfully');
            settle(true);
          } else {
            logger.warn(`Tailscale Serve reset exited with code ${code}`);
            settle(false);
          }
        });
        resetProcess.once('error', (error) => {
          logger.warn(`Tailscale Serve reset failed: ${error.message}`);
          settle(false);
        });

        const timeout = setTimeout(() => {
          logger.warn('Tailscale Serve reset timed out');
          if (!resetProcess.killed) {
            try {
              resetProcess.kill('SIGTERM');
            } catch (error) {
              logger.warn(`Failed to terminate timed-out Tailscale Serve reset: ${error}`);
            }
          }
          settle(false);
        }, 2000);
      });
    } catch (error) {
      logger.warn(`Failed to reset Tailscale Serve configuration: ${error}`);
      return false;
    }
  }

  isRunning(): boolean {
    // With --bg flag, the serve process exits immediately after configuration
    // We track running state based on whether we've started and not stopped
    return this.currentPort !== null && !this.isStarting;
  }

  isFunnelEnabled(): boolean {
    return this.funnelEnabled;
  }

  async getStatus(): Promise<TailscaleServeStatus> {
    logger.debug('[TAILSCALE STATUS] Getting status', {
      isPermanentlyDisabled: this.isPermanentlyDisabled,
      lastError: this.lastError,
      processActive: !!this.serveProcess,
      currentPort: this.currentPort,
    });

    // Debug mode: simulate errors based on environment variable
    if (process.env.VIBETUNNEL_TAILSCALE_ERROR) {
      return {
        isRunning: false,
        lastError: process.env.VIBETUNNEL_TAILSCALE_ERROR,
      };
    }

    if (process.env.VIBETUNNEL_SKIP_TAILSCALE === '1') {
      return {
        isRunning: false,
        isPermanentlyDisabled: false,
        funnelEnabled: false,
        desiredMode: this.desiredFunnel ? 'public' : 'private',
        actualMode: this.funnelEnabled ? 'public' : 'private',
      };
    }

    if (this.currentPort === null) {
      try {
        await this.getExecutablePath();
      } catch (error) {
        logger.debug(`Tailscale executable unavailable while Serve is idle: ${error}`);
        return {
          isRunning: false,
          port: undefined,
          lastError: undefined,
          isPermanentlyDisabled: false,
          funnelEnabled: false,
          desiredMode: this.desiredFunnel ? 'public' : 'private',
          actualMode: 'private',
        };
      }
    }

    // IMPROVED CHECK: First verify if Tailscale Serve is actually configured and working
    // Only mark as permanently disabled if we can't detect any working configuration
    if (!this.isPermanentlyDisabled) {
      logger.debug('[TAILSCALE STATUS] Checking actual Tailscale Serve configuration');

      const portToCheck = this.currentPort || 4020;

      try {
        // First, check if Serve is actually configured for our port (even if started manually)
        const isConfigured = await this.verifyServeConfiguration(portToCheck);
        logger.debug(
          `[TAILSCALE STATUS] Serve configured for port ${portToCheck}: ${isConfigured}`
        );

        if (isConfigured) {
          // Serve is working! Don't mark as permanently disabled
          logger.info(
            `✅ [TAILSCALE STATUS] Tailscale Serve is configured for port ${portToCheck} - not permanently disabled`
          );
          // Continue with normal status logic below
        } else {
          // No configuration found, check availability to determine if it's a permanent issue
          const checkResult = await this.checkServeAvailability();
          logger.debug(`[TAILSCALE STATUS] Serve availability check result: ${checkResult}`);

          if (
            checkResult.includes('Serve is not enabled') ||
            checkResult.includes('not available') ||
            checkResult.includes('requires admin') ||
            checkResult.includes('unauthorized')
          ) {
            logger.debug(
              '[TAILSCALE STATUS] Tailscale Serve not available on tailnet - marking as permanently disabled'
            );
            this.isPermanentlyDisabled = true;
            this.lastError = 'Serve is not enabled on your tailnet';

            // Return success (fallback mode)
            return {
              isRunning: false,
              port: undefined,
              lastError: undefined, // No error in fallback mode
              startTime: this.startTime,
              isPermanentlyDisabled: true,
              funnelEnabled: false,
              funnelStartTime: undefined,
            };
          }
        }
      } catch (error) {
        logger.debug(`[TAILSCALE STATUS] Failed to check configuration: ${error}`);
      }
    }

    // If we're permanently disabled, return that status without error
    // This is the expected fallback mode when admin permissions aren't available
    if (this.isPermanentlyDisabled) {
      logger.info('[TAILSCALE STATUS] Returning permanently disabled status (no error)');
      return {
        isRunning: false,
        port: undefined,
        // Don't report an error - fallback mode is working fine
        lastError: undefined,
        startTime: this.startTime,
        isPermanentlyDisabled: true,
        funnelEnabled: false,
        funnelStartTime: undefined,
      };
    }

    // Check if the serve process is running
    const processRunning = this.isRunning();
    logger.info(`[TAILSCALE STATUS] Process running: ${processRunning}`);

    // If not running and we have a permanent error, we're in fallback mode
    if (!processRunning && this.lastError?.includes('Serve is not enabled on your tailnet')) {
      logger.info('[TAILSCALE STATUS] Detected permanent failure, switching to fallback mode');
      // Mark as permanently disabled and return without error
      this.isPermanentlyDisabled = true;
      return {
        isRunning: false,
        port: undefined,
        lastError: undefined, // Don't show error in fallback mode
        startTime: this.startTime,
        isPermanentlyDisabled: true,
        funnelEnabled: false,
        funnelStartTime: undefined,
      };
    }

    // Always verify if Tailscale Serve is available, even if process isn't running
    // This helps detect permanent failures when the process never starts
    let actuallyRunning = processRunning;
    let verificationError: string | undefined;
    const portToCheck = this.currentPort || 4020; // Use default port if not set

    if (!processRunning && !this.isPermanentlyDisabled) {
      // Process isn't running - check if Tailscale Serve is configured (manual start)
      logger.info(
        `[TAILSCALE STATUS] Process not running, checking for manually configured Tailscale Serve`
      );
      try {
        const isConfigured = await this.verifyServeConfiguration(portToCheck);
        logger.info(`[TAILSCALE STATUS] Manual configuration check: ${isConfigured}`);

        if (isConfigured) {
          // Great! Serve is configured manually, mark as running
          actuallyRunning = true;
          logger.info(
            `✅ [TAILSCALE STATUS] Found manually configured Tailscale Serve for port ${portToCheck}`
          );
        } else {
          // No configuration is expected while idle. Only report an error when a
          // previously configured proxy has disappeared.
          if (this.currentPort !== null) {
            verificationError = 'Tailscale Serve is starting up or needs reconfiguration';
          }
          logger.info(
            `[TAILSCALE STATUS] No Serve configuration found for port ${portToCheck} - may need restart`
          );
        }
      } catch (error) {
        logger.debug(`Failed to check Tailscale Serve configuration: ${error}`);
      }
    } else if (processRunning && this.currentPort) {
      logger.info(`[TAILSCALE STATUS] Verifying configuration for port ${this.currentPort}`);
      try {
        const isConfigured = await this.verifyServeConfiguration(this.currentPort);
        logger.info(`[TAILSCALE STATUS] Configuration verified: ${isConfigured}`);
        if (!isConfigured) {
          actuallyRunning = false;
          // Process is running but not configured properly - this is a normal configuration error, not permanent
          verificationError = 'Tailscale Serve proxy not configured for this port';
          logger.info(
            '[TAILSCALE STATUS] Process running but not configured - normal configuration issue'
          );
        }
      } catch (error) {
        logger.debug(`Failed to verify Tailscale Serve configuration: ${error}`);
        // Don't report verification errors as user-facing errors
        actuallyRunning = false;
      }
    }

    // Check if modes match - if they do, consider it running even if process check fails
    // This handles the case where --bg makes the process exit immediately
    const desiredMode = this.desiredFunnel ? 'public' : 'private';
    const actualMode = this.funnelEnabled ? 'public' : 'private';
    // The background command exiting successfully only records the port to verify.
    // Do not report Serve as running after its persistent proxy is removed externally.
    const effectivelyRunning = actuallyRunning;

    const result: TailscaleServeStatus = {
      isRunning: effectivelyRunning,
      port: effectivelyRunning ? (this.currentPort ?? undefined) : undefined,
      lastError: effectivelyRunning ? undefined : verificationError || this.lastError,
      startTime: this.startTime,
      isPermanentlyDisabled: this.isPermanentlyDisabled,
      funnelEnabled: this.funnelEnabled,
      funnelStartTime: this.funnelStartTime,
      desiredMode: desiredMode,
      actualMode: actualMode,
      funnelError: this.funnelError,
    };

    logger.info('[TAILSCALE STATUS] Returning status:');
    logger.info(`  - isRunning: ${result.isRunning}`);
    logger.info(`  - lastError: ${result.lastError}`);
    logger.info(`  - isPermanentlyDisabled: ${result.isPermanentlyDisabled}`);
    logger.info(`  - desiredMode: ${result.desiredMode}`);
    logger.info(`  - actualMode: ${result.actualMode}`);
    logger.info(`  - funnelError: ${result.funnelError}`);

    return result;
  }

  /**
   * Check if Tailscale Serve is available on this tailnet
   */
  private async checkServeAvailability(): Promise<string> {
    return new Promise<string>((resolve) => {
      // Try JSON first, fallback to regular status if needed
      const statusProcess = spawn(this.tailscaleExecutable, ['serve', 'status', '--json'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      if (statusProcess.stdout) {
        statusProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });
      }

      if (statusProcess.stderr) {
        statusProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });
      }

      statusProcess.on('exit', (code) => {
        // Return stderr if it contains error messages
        if (stderr) {
          resolve(stderr);
        } else if (code === 0) {
          // Success - check if we have valid JSON or just return stdout
          try {
            const _status = JSON.parse(stdout);
            // If we have valid JSON, we can serve
            resolve(stdout);
          } catch (_jsonError) {
            // Not valid JSON, return as-is
            resolve(stdout);
          }
        } else {
          resolve(stdout || 'Tailscale Serve status check failed');
        }
      });

      statusProcess.on('error', (error) => {
        resolve(error.message);
      });

      // Timeout after 3 seconds
      setTimeout(() => {
        if (!statusProcess.killed) {
          statusProcess.kill('SIGTERM');
          resolve('Timeout checking Tailscale Serve availability');
        }
      }, 3000);
    });
  }

  /**
   * Verify that Tailscale Serve is actually configured for the given port
   */
  private async verifyServeConfiguration(port: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      // Use --json flag for reliable parsing
      const statusProcess = spawn(this.tailscaleExecutable, ['serve', 'status', '--json'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      if (statusProcess.stdout) {
        statusProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });
      }

      if (statusProcess.stderr) {
        statusProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });
      }

      statusProcess.on('exit', (code) => {
        if (code === 0) {
          // First try JSON parsing, fallback to text parsing if needed
          try {
            const status = JSON.parse(stdout);
            const isConfigured = this.parseServeStatusJson(status, port);
            logger.debug(
              `Tailscale Serve JSON status check: port ${port} configured = ${isConfigured}`
            );
            resolve(isConfigured);
          } catch (_jsonError) {
            logger.debug('JSON parsing failed, trying text parsing as fallback');
            // Fallback to text parsing if JSON fails
            const isConfigured = this.parseServeStatus(stdout, port);
            logger.debug(
              `Tailscale Serve text status check: port ${port} configured = ${isConfigured}`
            );
            resolve(isConfigured);
          }
        } else {
          logger.debug(`Tailscale serve status failed with code ${code}: ${stderr}`);
          resolve(false);
        }
      });

      statusProcess.on('error', (error) => {
        logger.debug(`Failed to run tailscale serve status: ${error.message}`);
        resolve(false);
      });

      // Timeout after 3 seconds
      setTimeout(() => {
        if (!statusProcess.killed) {
          statusProcess.kill('SIGTERM');
          resolve(false);
        }
      }, 3000);
    });
  }

  private async waitForServeConfiguration(port: number): Promise<boolean> {
    const maxAttempts = 5;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (await this.verifyServeConfiguration(port)) {
        return true;
      }

      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    return false;
  }

  /**
   * Parse JSON output from 'tailscale serve status --json' to check if our port is configured
   */
  private parseServeStatusJson(status: unknown, port: number): boolean {
    const statusData = status as {
      Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
      Foreground?: Record<
        string,
        {
          Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
          AllowFunnel?: Record<string, boolean>;
        }
      >;
      AllowFunnel?: Record<string, boolean>;
    };

    try {
      logger.debug(`Parsing Tailscale serve JSON status for port ${port}:`);
      logger.debug(`JSON status: ${JSON.stringify(status, null, 2)}`);

      // Check both direct Web config and Foreground config
      const webConfigs = [];

      // Direct Web config (older format)
      if (statusData.Web) {
        webConfigs.push(statusData.Web);
      }

      // Foreground config (newer format)
      if (statusData.Foreground) {
        for (const nodeId in statusData.Foreground) {
          const nodeConfig = statusData.Foreground[nodeId];
          if (nodeConfig.Web) {
            webConfigs.push(nodeConfig.Web);
          }
        }
      }

      // Check all Web configurations found
      for (const webConfig of webConfigs) {
        for (const host in webConfig) {
          const handlers = webConfig[host]?.Handlers;
          if (handlers) {
            logger.debug(`Checking handlers for host: ${host}`);
            for (const path in handlers) {
              const proxy = handlers[path]?.Proxy;
              if (proxy) {
                logger.debug(`Found proxy config: ${path} -> ${proxy}`);

                // Check if this proxy points to our port
                if (
                  proxy.includes(`:${port}`) ||
                  proxy.includes(`127.0.0.1:${port}`) ||
                  proxy.includes(`localhost:${port}`)
                ) {
                  logger.info(`✅ Found Tailscale Serve config for port ${port}: ${proxy}`);

                  // Check for Funnel status in multiple possible locations
                  let funnelEnabled = false;
                  if (statusData.AllowFunnel?.[host]) {
                    funnelEnabled = true;
                    logger.info(`🌍 Funnel is enabled for ${host}`);
                  } else if (statusData.Foreground) {
                    // Check if any foreground config allows Funnel
                    for (const nodeId in statusData.Foreground) {
                      const nodeConfig = statusData.Foreground[nodeId];
                      if (nodeConfig.AllowFunnel?.[host]) {
                        funnelEnabled = true;
                        logger.info(`🌍 Funnel is enabled for ${host} (node ${nodeId})`);
                        break;
                      }
                    }
                  }

                  // Update our internal Funnel status based on what we found
                  this.funnelEnabled = funnelEnabled;
                  if (funnelEnabled && !this.funnelStartTime) {
                    this.funnelStartTime = new Date();
                  }

                  return true;
                }
              }
            }
          }
        }
      }

      logger.warn(`❌ No proxy configuration found for port ${port} in JSON status`);
      logger.debug(`Available proxy configurations:`);
      for (const webConfig of webConfigs) {
        for (const host in webConfig) {
          const handlers = webConfig[host]?.Handlers;
          if (handlers) {
            for (const path in handlers) {
              const proxy = handlers[path]?.Proxy;
              if (proxy) {
                logger.debug(`  - ${host}${path} -> ${proxy}`);
              }
            }
          }
        }
      }

      return false;
    } catch (error) {
      logger.info('Failed to parse JSON status:', error);
      return false;
    }
  }

  /**
   * Parse the output of 'tailscale serve status' to check if our port is configured
   */
  private parseServeStatus(output: string, port: number): boolean {
    logger.debug(`Parsing Tailscale serve status output for port ${port}:`);
    logger.debug(`Raw output: ${JSON.stringify(output)}`);

    // Look for lines containing our port number
    const lines = output.split('\n');
    logger.debug(`Split into ${lines.length} lines`);

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine) {
        logger.debug(`Checking line: "${trimmedLine}"`);
      }

      // Common patterns in Tailscale serve output:
      // "https://hostname:443 proxy http://127.0.0.1:4020"
      // "http://hostname:80 proxy http://127.0.0.1:4020"
      if (line.includes(`127.0.0.1:${port}`) || line.includes(`localhost:${port}`)) {
        logger.info(`Found proxy configuration for port ${port} in line: "${line.trim()}"`);
        return true;
      }
    }

    logger.warn(`No proxy configuration found for port ${port} in Tailscale serve status`);
    return false;
  }

  private handleServeProcessExit(code: number | null, signal: NodeJS.Signals | null): void {
    logger.info(`Tailscale Serve process exited with code ${code}, signal ${signal}`);

    // `tailscale serve --bg` exits after successfully installing the persistent proxy.
    // Keep the configured port so status checks verify the proxy instead of falling back to 4020.
    if (code === 0) {
      this.serveProcess = null;
      return;
    }

    // Check if this is the common "Serve not enabled" error.
    if (this.lastError?.includes('Serve is not enabled on your tailnet')) {
      // Keep the more user-friendly error message we set in stderr handler.
      logger.info('Tailscale Serve failed due to tailnet permissions');
    } else {
      this.lastError = `Process exited with code ${code}`;
    }
    this.cleanup();
  }

  private cleanup(): void {
    // Kill the process if it's still running
    if (this.serveProcess && !this.serveProcess.killed) {
      logger.debug('Terminating orphaned Tailscale Serve process');
      try {
        this.serveProcess.kill('SIGTERM');
        // Give it a moment to terminate gracefully
        setTimeout(() => {
          if (this.serveProcess && !this.serveProcess.killed) {
            logger.warn('Force killing Tailscale Serve process');
            this.serveProcess.kill('SIGKILL');
          }
        }, 1000);
      } catch (error) {
        logger.info('Failed to kill Tailscale Serve process:', error);
      }
    }

    this.serveProcess = null;
    this.currentPort = null;
    this.isStarting = false;
    this.startTime = undefined;
    this.funnelEnabled = false;
    this.funnelStartTime = undefined;
    // Keep lastError for debugging
  }

  private async checkTailscaleAvailable(): Promise<void> {
    await this.getExecutablePath();
  }

  async getExecutablePath(): Promise<string> {
    const executablePath = await findTailscaleExecutable();
    if (!executablePath) {
      throw new Error('Tailscale command not found. Please install Tailscale first.');
    }

    this.tailscaleExecutable = executablePath;
    logger.debug(`Found Tailscale at: ${executablePath}`);
    return executablePath;
  }
}

// Singleton instance
export const tailscaleServeService = new TailscaleServeServiceImpl();
