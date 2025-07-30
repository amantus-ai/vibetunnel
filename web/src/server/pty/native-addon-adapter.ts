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
  checkExitStatus(): number | null;
  setOnData(callback: (data: Buffer) => void): void;
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
    logger.log('loadNativeAddon() called, NativePty not loaded yet');
    try {
      let addon: any;

      // When running as SEA (Single Executable Application)
      if (process.env.VIBETUNNEL_SEA === 'true') {
        logger.log('Running in SEA mode, attempting to load native addon');
        const path = require('path');
        const execDir = path.dirname(process.execPath);
        const ptyPath = path.join(execDir, 'pty.node');
        logger.log(`Loading PTY addon from SEA path: ${ptyPath}`);
        logger.log(`Process execPath: ${process.execPath}`);
        logger.log(`Exec directory: ${execDir}`);
        
        // Check if file exists
        const fs = require('fs');
        if (fs.existsSync(ptyPath)) {
          logger.log(`PTY addon file exists at ${ptyPath}`);
        } else {
          logger.error(`PTY addon file NOT FOUND at ${ptyPath}`);
          throw new Error(`PTY addon not found at ${ptyPath}`);
        }
        
        logger.log('Using process.dlopen to load native addon...');
        // SEA binaries need to use process.dlopen for native modules
        const module = { exports: {} };
        try {
          process.dlopen(module, ptyPath);
          addon = module.exports;
          logger.log('Native addon loaded successfully via process.dlopen');
        } catch (dlopenError) {
          logger.error('Failed to load with process.dlopen:', dlopenError);
          throw new Error(`Failed to dlopen native addon: ${dlopenError instanceof Error ? dlopenError.message : String(dlopenError)}`);
        }
      } else {
        // Development mode - try to load from vibetunnel-pty
        try {
          addon = require('../../../vibetunnel-pty');
        } catch (_err) {
          // Fallback to relative path for tests
          const path = require('path');
          const ptyPath = path.join(__dirname, '../../../native/pty.node');
          logger.log(`Loading PTY addon from fallback path: ${ptyPath}`);
          addon = require(ptyPath);
        }
      }

      logger.log('Extracting exports from addon...');
      NativePty = addon.NativePty;
      logger.log('NativePty extracted');
      ActivityDetector = addon.ActivityDetector;
      logger.log('ActivityDetector extracted');
      initPtySystem = addon.initPtySystem;
      logger.log('initPtySystem extracted');

      // Initialize once
      logger.log('About to call initPtySystem()...');
      initPtySystem();
      logger.log('initPtySystem() completed');
      logger.log('Native PTY addon loaded successfully');
    } catch (err) {
      throw new Error(
        `Failed to load native PTY addon: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

class NativeAddonPty extends EventEmitter implements IPty {
  private pty: NativePtyInstance;
  private activityDetector: ActivityDetectorInstance;
  private _pid: number;
  private _process: string;
  private closed = false;
  private exitCheckInterval: NodeJS.Timeout | null = null;
  private exitCode: number | null = null;

  constructor(file?: string, args?: string[], opt?: IPtyOptions) {
    super();
    
    logger.log(`NativeAddonPty constructor called with file=${file}, args=${args?.join(' ')}`);

    // Load native addon
    loadNativeAddon();

    logger.log('About to create native PTY instance...');
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

    // Set up event-driven data callback
    this.setupDataCallback();
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

    this.closed = true;

    // Clear exit check interval
    if (this.exitCheckInterval) {
      clearInterval(this.exitCheckInterval);
      this.exitCheckInterval = null;
    }

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

  private setupDataCallback(): void {
    // Event-driven architecture - Rust calls this callback when data arrives
    // This eliminates polling and prevents event loop blocking
    this.pty.setOnData((data: Buffer) => {
      if (this.closed) return;

      // Check for activity
      const activity = this.activityDetector.detect(data);
      if (activity) {
        this.emit('activity', activity);
      }

      // Emit data as string for compatibility
      this.emit('data', data.toString('utf8'));
    });

    // Still need to check for process exit periodically
    // This is much less frequent and doesn't block for I/O
    this.exitCheckInterval = setInterval(() => {
      if (this.closed) {
        if (this.exitCheckInterval) {
          clearInterval(this.exitCheckInterval);
          this.exitCheckInterval = null;
        }
        return;
      }

      try {
        const exitStatus = this.pty.checkExitStatus();
        if (exitStatus !== null && exitStatus !== undefined) {
          // Process has exited
          this.exitCode = exitStatus;
          this.closed = true;
          this.emit('exit', exitStatus, 0);
          if (this.exitCheckInterval) {
            clearInterval(this.exitCheckInterval);
            this.exitCheckInterval = null;
          }
        }
      } catch (err) {
        logger.error('Error checking exit status:', err);
      }
    }, 100); // Check every 100ms for exit status only
  }
}

// Export spawn function to match IPty interface
export function spawn(file: string, args?: string[], options?: IPtyOptions): IPty {
  return new NativeAddonPty(file, args, options);
}

// Re-export for compatibility
export { NativeAddonPty };
export type { IPty, IPtyOptions };
