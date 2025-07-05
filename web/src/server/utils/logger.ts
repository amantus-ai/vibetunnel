import chalk from 'chalk';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Log file path
const LOG_DIR = path.join(os.homedir(), '.vibetunnel');
const LOG_FILE = path.join(LOG_DIR, 'log.txt');

// Debug mode flag
let debugMode = false;

// File handle for log file
let logFileHandle: fs.WriteStream | null = null;

// ANSI color codes for stripping from file output
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences require control characters
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/**
 * Initialize the logger - creates log directory and file
 */
export function initLogger(debug: boolean = false): void {
  debugMode = debug;

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
    } catch (unlinkError) {
      // Ignore unlink errors - file might not exist or be locked
      console.debug('Could not delete old log file:', unlinkError);
    }

    // Create new log file write stream
    logFileHandle = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  } catch (error) {
    // Don't throw, just log to console
    console.error('Failed to initialize log file:', error);
  }
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
  debugMode = enabled;
}

/**
 * Log from a specific module (used by client-side API)
 */
export function logFromModule(level: string, module: string, args: unknown[]): void {
  if (level === 'DEBUG' && !debugMode) return;

  const { console: consoleMsg, file: fileMsg } = formatMessage(level, module, args);

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

  // Log to file
  writeToFile(fileMsg);
}

/**
 * Create a logger for a specific module
 * This is the main factory function that should be used
 */
export function createLogger(moduleName: string) {
  // Add [SRV] prefix to server-originated logs unless it already has a prefix
  const prefixedModuleName = moduleName.startsWith('[') ? moduleName : `[SRV] ${moduleName}`;

  return {
    log: (...args: unknown[]) => {
      const { console: consoleMsg, file: fileMsg } = formatMessage('LOG', prefixedModuleName, args);
      console.log(consoleMsg);
      writeToFile(fileMsg);
    },
    warn: (...args: unknown[]) => {
      const { console: consoleMsg, file: fileMsg } = formatMessage(
        'WARN',
        prefixedModuleName,
        args
      );
      console.warn(consoleMsg);
      writeToFile(fileMsg);
    },
    error: (...args: unknown[]) => {
      const { console: consoleMsg, file: fileMsg } = formatMessage(
        'ERROR',
        prefixedModuleName,
        args
      );
      console.error(consoleMsg);
      writeToFile(fileMsg);
    },
    debug: (...args: unknown[]) => {
      if (debugMode) {
        const { console: consoleMsg, file: fileMsg } = formatMessage(
          'DEBUG',
          prefixedModuleName,
          args
        );
        console.log(consoleMsg);
        writeToFile(fileMsg);
      }
    },
    setDebugMode: (enabled: boolean) => setDebugMode(enabled),
  };
}
