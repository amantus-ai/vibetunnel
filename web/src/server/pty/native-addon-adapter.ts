import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger.js';
import type { IPty, IPtyOptions } from './types.js';

const logger = createLogger('native-addon-pty');

// Type definitions for the native addon
interface NativePtyConstructor {
  new (
    shell?: string | null,
    args?: string[] | null,
    env?: Record<string, string> | null,
    cwd?: string | null,
    cols?: number | null,
    rows?: number | null
  ): NativePtyInstance;
}

interface NativePtyInstance {
  write(data: Buffer): void;
  resize(cols: number, rows: number): void;
  getPid(): number;
  kill(signal?: string | null): void;
  readOutput(timeoutMs?: number | null): Buffer | null;
  readAllOutput(): Buffer | null;
  checkExitStatus(): number | null;
  destroy(): void;
}

interface ActivityDetectorConstructor {
  new (): ActivityDetectorInstance;
}

interface ActivityDetectorInstance {
  detect(data: Buffer): Activity | null;
}

interface Activity {
  timestamp: number;
  status: string;
  details?: string;
}

// Lazy load the native addon
let NativePty: NativePtyConstructor;
let ActivityDetector: ActivityDetectorConstructor;
let initPtySystem: () => void;

function loadNativeAddon() {
  if (!NativePty) {
    try {
      // Try native-pty first (our updated implementation)
      const addon = require('../../../native-pty');
      NativePty = addon.NativePty;
      ActivityDetector = addon.ActivityDetector;
      initPtySystem = addon.initPtySystem;

      // Initialize once
      initPtySystem();
      logger.log('Native PTY addon loaded successfully from native-pty');
    } catch (err) {
      // Fall back to vibetunnel-pty if native-pty fails
      try {
        const addon = require('../../../vibetunnel-pty');
        NativePty = addon.NativePty;
        ActivityDetector = addon.ActivityDetector;
        initPtySystem = addon.initPtySystem;

        // Initialize once
        initPtySystem();
        logger.log('Native PTY addon loaded successfully from vibetunnel-pty (fallback)');
      } catch (fallbackErr) {
        throw new Error(
          `Failed to load native addon: ${err instanceof Error ? err.message : String(err)} (fallback: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)})`
        );
      }
    }
  }
}

class NativeAddonPty extends EventEmitter implements IPty {
  private pty: NativePtyInstance;
  private activityDetector: ActivityDetectorInstance;
  private _pid: number;
  private _process: string;
  private closed = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private exitCode: number | null = null;

  constructor(file?: string, args?: string[], opt?: IPtyOptions) {
    super();

    // Load native addon
    loadNativeAddon();

    // Create native PTY
    this.pty = new NativePty(
      file,
      args,
      opt?.env as Record<string, string> | undefined,
      opt?.cwd,
      opt?.cols,
      opt?.rows
    );

    this._pid = this.pty.getPid();
    this._process = file || '/bin/bash';

    // Activity detection
    this.activityDetector = new ActivityDetector();

    // Start polling for output
    this.startPolling();
  }

  get pid(): number {
    return this._pid;
  }

  get process(): string {
    return this._process;
  }

  write(data: string | Buffer): void {
    if (this.closed) return;

    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    this.pty.write(buffer);
  }

  resize(cols: number, rows: number): void {
    if (this.closed) return;

    this.pty.resize(cols, rows);
  }

  kill(signal?: string): void {
    if (this.closed) return;

    this.pty.kill(signal);
  }

  destroy(): void {
    if (this.closed) return;

    this.stopPolling();
    this.closed = true;

    try {
      this.pty.destroy();
    } catch (err) {
      logger.error('Error destroying PTY:', err);
    }
  }

  async waitForExit(): Promise<number> {
    // If already exited, return the exit code
    if (this.closed && this.exitCode !== null) {
      return this.exitCode;
    }

    // Wait for exit
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const exitStatus = this.pty.checkExitStatus();
        if (exitStatus !== null && exitStatus !== undefined) {
          clearInterval(checkInterval);
          this.exitCode = exitStatus;
          this.closed = true;
          resolve(exitStatus);
        }
      }, 100);
    });
  }

  // Compatibility methods
  pause(): void {
    // No-op for compatibility
  }

  resume(): void {
    // No-op for compatibility
  }

  private startPolling(): void {
    // Poll for output with much lower frequency since we have a dedicated reader thread
    // and can get all buffered data at once
    this.pollInterval = setInterval(() => {
      if (this.closed) {
        this.stopPolling();
        return;
      }

      try {
        // Check if process has exited
        const exitStatus = this.pty.checkExitStatus();
        if (exitStatus !== null && exitStatus !== undefined) {
          // Process has exited
          this.exitCode = exitStatus;
          this.closed = true;
          this.emit('exit', exitStatus, 0);
          this.stopPolling();
          return;
        }

        // Read all available output at once
        const output = this.pty.readAllOutput();
        if (output) {
          // Check for activity
          const activity = this.activityDetector.detect(output);
          if (activity) {
            this.emit('activity', activity);
          }

          // Emit data as string for compatibility
          this.emit('data', output.toString('utf8'));
        }
      } catch (err) {
        logger.error('Error in PTY polling:', err);
        this.closed = true;
        this.emit('exit', 1, 0);
        this.stopPolling();
      }
    }, 5); // Reduced to 5ms since we get all buffered data at once
  }

  private stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}

// Export spawn function to match IPty interface
export function spawn(file: string, args?: string[], options?: IPtyOptions): IPty {
  return new NativeAddonPty(file, args, options);
}

// Re-export for compatibility
export { NativeAddonPty };
export type { IPty, IPtyOptions };
