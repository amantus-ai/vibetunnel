import chalk from 'chalk';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Log file path
const LOG_DIR = path.join(os.homedir(), '.vibetunnel');
let LOG_FILE = path.join(LOG_DIR, 'log.txt');

/**
 * Set custom log file path
 */
export function setLogFilePath(filePath: string): void {
  // Close existing file handle if open
  if (logFileHandle) {
    logFileHandle.end();
    logFileHandle = null;
  }

  LOG_FILE = filePath;

  // Ensure directory exists
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Re-open log file at new location
  try {
    logFileHandle = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  } catch (error) {
    console.error('Failed to open log file at new location:', error);
  }
}

// Verbosity levels
export enum VerbosityLevel {
  SILENT = 0, // No console output (logs to file only)
  ERROR = 1, // Errors only (default)
  WARN = 2, // Errors and warnings
  INFO = 3, // Errors, warnings, and info
  VERBOSE = 4, // All except debug
  DEBUG = 5, // Everything
}

/**
 * Type-safe mapping of string names to verbosity levels
 */
export const VERBOSITY_MAP: Record<string, VerbosityLevel> = {
  silent: VerbosityLevel.SILENT,
  error: VerbosityLevel.ERROR,
  warn: VerbosityLevel.WARN,
  info: VerbosityLevel.INFO,
  verbose: VerbosityLevel.VERBOSE,
  debug: VerbosityLevel.DEBUG,
} as const;

// Current verbosity level
// Default to ERROR for production
let verbosityLevel: VerbosityLevel = VerbosityLevel.ERROR;

// Debug mode flag (kept for backward compatibility)
let _debugMode = false;

/**
 * Type guard to check if a string is a valid VerbosityLevel key
 */
export function isVerbosityLevel(value: string): value is keyof typeof VERBOSITY_MAP {
  return value.toLowerCase() in VERBOSITY_MAP;
}

/**
 * Parse a string to VerbosityLevel, returns undefined if invalid
 */
export function parseVerbosityLevel(value: string): VerbosityLevel | undefined {
  const normalized = value.toLowerCase();
  return VERBOSITY_MAP[normalized];
}

// File handle for log file
let logFileHandle: fs.WriteStream | null = null;

// ANSI color codes for stripping from file output
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences require control characters
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/**
 * Initialize the logger - creates log directory and file
 */
export function initLogger(debug: boolean = false, verbosity?: VerbosityLevel): void {
  _debugMode = debug;

  // Set verbosity level
  if (verbosity !== undefined) {
    verbosityLevel = verbosity;
  } else if (debug) {
    // If debug mode is enabled, set verbosity to DEBUG
    verbosityLevel = VerbosityLevel.DEBUG;
  }

  // If already initialized, just update debug mode and return
  if (logFileHandle) {
    return;
  }

  try {
    // Ensure log directory exists
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }

    // Delete old log file if it exists
    try {
      if (fs.existsSync(LOG_FILE)) {
        fs.unlinkSync(LOG_FILE);
      }
    } catch {
      // Ignore unlink errors - file might not exist or be locked
      // Don't log here as logger isn't fully initialized yet
    }

    // Create new log file write stream
    logFileHandle = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  } catch (error) {
    // Don't throw, just log to console
    console.error('Failed to initialize log file:', error);
  }
}

/**
 * Flush the log file buffer
 */
export function flushLogger(): Promise<void> {
  return new Promise((resolve) => {
    if (logFileHandle && !logFileHandle.destroyed) {
      // Force a write of any buffered data
      logFileHandle.write('', () => {
        resolve();
      });
    } else {
      resolve();
    }
  });
}

/**
 * Close the logger
 */
export function closeLogger(): void {
  if (logFileHandle) {
    logFileHandle.end();
    logFileHandle = null;
  }
}

/**
 * Format log message with timestamp
 */
function formatMessage(
  level: string,
  module: string,
  args: unknown[]
): { console: string; file: string } {
  const timestamp = new Date().toISOString();

  // Format arguments
  const message = args
    .map((arg) => {
      if (typeof arg === 'object') {
        try {
          // Use JSON.stringify with 2-space indent for objects
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    })
    .join(' ');

  // Console format with colors
  let consoleFormat: string;
  const moduleColor = chalk.cyan(`[${module}]`);
  const timestampColor = chalk.gray(timestamp);

  switch (level) {
    case 'ERROR':
      consoleFormat = `${timestampColor} ${chalk.red(level)} ${moduleColor} ${chalk.red(message)}`;
      break;
    case 'WARN':
      consoleFormat = `${timestampColor} ${chalk.yellow(level)}  ${moduleColor} ${chalk.yellow(message)}`;
      break;
    case 'DEBUG':
      consoleFormat = `${timestampColor} ${chalk.magenta(level)} ${moduleColor} ${chalk.gray(message)}`;
      break;
    default: // LOG
      consoleFormat = `${timestampColor} ${chalk.green(level)}   ${moduleColor} ${message}`;
  }

  // File format (no colors)
  const fileFormat = `${timestamp} ${level.padEnd(5)} [${module}] ${message}`;

  return { console: consoleFormat, file: fileFormat };
}

/**
 * Write to log file
 */
function writeToFile(message: string): void {
  if (logFileHandle) {
    try {
      // Strip ANSI color codes from message
      const cleanMessage = message.replace(ANSI_PATTERN, '');
      logFileHandle.write(`${cleanMessage}\n`);
    } catch {
      // Silently ignore file write errors
    }
  }
}

/**
 * Enable or disable debug mode
 */
export function setDebugMode(enabled: boolean): void {
  _debugMode = enabled;
  // If enabling debug mode, also set verbosity to DEBUG
  if (enabled) {
    verbosityLevel = VerbosityLevel.DEBUG;
  }
}

/**
 * Set verbosity level
 */
export function setVerbosityLevel(level: VerbosityLevel): void {
  verbosityLevel = level;
  // Update debug mode flag for backward compatibility
  _debugMode = level >= VerbosityLevel.DEBUG;
}

/**
 * Get current verbosity level
 */
export function getVerbosityLevel(): VerbosityLevel {
  return verbosityLevel;
}

/**
 * Check if debug logging is enabled
 */
export function isDebugEnabled(): boolean {
  return verbosityLevel >= VerbosityLevel.DEBUG;
}

/**
 * Check if verbose logging is enabled
 */
export function isVerbose(): boolean {
  return verbosityLevel >= VerbosityLevel.VERBOSE;
}

/**
 * Check if a log level should be output based on current verbosity
 */
function shouldLog(level: string): boolean {
  switch (level) {
    case 'ERROR':
      return verbosityLevel >= VerbosityLevel.ERROR;
    case 'WARN':
      return verbosityLevel >= VerbosityLevel.WARN;
    case 'LOG':
      return verbosityLevel >= VerbosityLevel.INFO;
    case 'DEBUG':
      return verbosityLevel >= VerbosityLevel.DEBUG;
    default:
      return true;
  }
}

/**
 * Log from a specific module (used by client-side API)
 */
export function logFromModule(level: string, module: string, args: unknown[]): void {
  const { console: consoleMsg, file: fileMsg } = formatMessage(level, module, args);

  // Always write to file
  writeToFile(fileMsg);

  // Check if we should output to console based on verbosity
  if (!shouldLog(level)) return;

  // Log to console
  switch (level) {
    case 'ERROR':
      console.error(consoleMsg);
      break;
    case 'WARN':
      console.warn(consoleMsg);
      break;
    default:
      console.log(consoleMsg);
  }
}

/**
 * Create a logger for a specific module
 * This is the main factory function that should be used
 */
export function createLogger(moduleName: string) {
  // Add [SRV] prefix to server-originated logs unless it already has a prefix
  const prefixedModuleName = moduleName.startsWith('[') ? moduleName : `[SRV] ${moduleName}`;

  return {
    /**
     * @deprecated Use info() instead for clarity
     */
    log: (...args: unknown[]) => {
      const { console: consoleMsg, file: fileMsg } = formatMessage('LOG', prefixedModuleName, args);
      writeToFile(fileMsg); // Always write to file
      if (shouldLog('LOG')) {
        console.log(consoleMsg);
      }
    },
    info: (...args: unknown[]) => {
      const { console: consoleMsg, file: fileMsg } = formatMessage('LOG', prefixedModuleName, args);
      writeToFile(fileMsg); // Always write to file
      if (shouldLog('LOG')) {
        console.log(consoleMsg);
      }
    },
    warn: (...args: unknown[]) => {
      const { console: consoleMsg, file: fileMsg } = formatMessage(
        'WARN',
        prefixedModuleName,
        args
      );
      writeToFile(fileMsg); // Always write to file
      if (shouldLog('WARN')) {
        console.warn(consoleMsg);
      }
    },
    error: (...args: unknown[]) => {
      const { console: consoleMsg, file: fileMsg } = formatMessage(
        'ERROR',
        prefixedModuleName,
        args
      );
      writeToFile(fileMsg); // Always write to file
      if (shouldLog('ERROR')) {
        console.error(consoleMsg);
      }
    },
    debug: (...args: unknown[]) => {
      const { console: consoleMsg, file: fileMsg } = formatMessage(
        'DEBUG',
        prefixedModuleName,
        args
      );
      writeToFile(fileMsg); // Always write to file
      if (shouldLog('DEBUG')) {
        console.log(consoleMsg);
      }
    },
    setDebugMode: (enabled: boolean) => setDebugMode(enabled),
    setVerbosity: (level: VerbosityLevel) => setVerbosityLevel(level),
  };
}
