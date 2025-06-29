import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from './logger';

const logger = createLogger('LogRotation');

export interface LogRotationOptions {
  maxSize?: number; // Max file size in bytes (default: 10MB)
  maxFiles?: number; // Number of rotated files to keep (default: 5)
  compress?: boolean; // Whether to compress rotated files (default: false)
}

const DEFAULT_OPTIONS: Required<LogRotationOptions> = {
  maxSize: 10 * 1024 * 1024, // 10MB
  maxFiles: 5,
  compress: false,
};

/**
 * Check if log file needs rotation
 */
export function shouldRotate(logPath: string, maxSize: number): boolean {
  try {
    const stats = fs.statSync(logPath);
    return stats.size >= maxSize;
  } catch {
    return false;
  }
}

/**
 * Rotate log files
 * log.txt -> log.1.txt
 * log.1.txt -> log.2.txt
 * etc.
 */
export function rotateLogFile(logPath: string, options: LogRotationOptions = {}): void {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  try {
    // Check if rotation is needed
    if (!shouldRotate(logPath, opts.maxSize)) {
      return;
    }

    logger.log(`Rotating log file (size exceeded ${opts.maxSize} bytes)`);

    const dir = path.dirname(logPath);
    const basename = path.basename(logPath, '.txt');

    // Delete oldest file if it exists
    const oldestFile = path.join(dir, `${basename}.${opts.maxFiles}.txt`);
    if (fs.existsSync(oldestFile)) {
      fs.unlinkSync(oldestFile);
    }

    // Rotate existing numbered files
    for (let i = opts.maxFiles - 1; i > 0; i--) {
      const currentFile = path.join(dir, `${basename}.${i}.txt`);
      const nextFile = path.join(dir, `${basename}.${i + 1}.txt`);

      if (fs.existsSync(currentFile)) {
        fs.renameSync(currentFile, nextFile);
      }
    }

    // Rotate current log file to .1
    const firstRotated = path.join(dir, `${basename}.1.txt`);
    fs.renameSync(logPath, firstRotated);

    // Create new empty log file
    fs.writeFileSync(logPath, '');

    logger.log(
      `Log rotation complete. Old logs saved as ${basename}.1.txt through ${basename}.${opts.maxFiles}.txt`
    );
  } catch (error) {
    logger.error('Failed to rotate log file:', error);
  }
}

/**
 * Set up automatic log rotation based on file size
 * Checks every minute
 */
export function setupAutoRotation(
  logPath: string,
  options: LogRotationOptions = {}
): ReturnType<typeof setInterval> {
  const checkInterval = 60 * 1000; // Check every minute

  const intervalId = setInterval(() => {
    rotateLogFile(logPath, options);
  }, checkInterval);

  // Also check immediately
  rotateLogFile(logPath, options);

  return intervalId;
}
