import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger.js';
import type { IPty, IPtyOptions } from './types.js';

const logger = createLogger('native-addon-pty');

// Lazy load the native addon
let NativePty: any;
let ActivityDetector: any;
let initPtySystem: any;

function loadNativeAddon() {
  if (!NativePty) {
    try {
      const addon = require('../../../native-pty');
      NativePty = addon.NativePty;
      ActivityDetector = addon.ActivityDetector;
      initPtySystem = addon.initPtySystem;

      // Initialize once
      initPtySystem();
      logger.log('Native PTY addon loaded successfully');
    } catch (err: any) {
      throw new Error(`Failed to load native addon: ${err.message}`);
    }
  }
}

class NativeAddonPty extends EventEmitter implements IPty {
  private pty: any;
  private activityDetector: any;
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
    // Poll for output every 10ms
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

        // Read output
        const output = this.pty.readOutput(0); // Non-blocking read
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
    }, 10);
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
