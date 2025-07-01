/**
 * Enhanced logger utility for Playwright tests
 * Provides structured logging with better formatting and filtering
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerConfig {
  prefix?: string;
  enabled?: boolean;
  minLevel?: LogLevel;
  colorize?: boolean;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  prefix?: string;
  message: string;
  data?: unknown;
}

class TestLogger {
  private prefix: string;
  private enabled: boolean;
  private minLevel: LogLevel;
  private colorize: boolean;
  private levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  private colors: Record<LogLevel, string> = {
    debug: '\x1b[36m', // Cyan
    info: '\x1b[32m', // Green
    warn: '\x1b[33m', // Yellow
    error: '\x1b[31m', // Red
  };

  private resetColor = '\x1b[0m';

  constructor(config: LoggerConfig = {}) {
    this.prefix = config.prefix || '';
    this.enabled = config.enabled ?? !process.env.CI;
    this.minLevel = config.minLevel || (process.env.CI ? 'warn' : 'info');
    this.colorize = config.colorize ?? !process.env.CI;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.enabled && this.levels[level] >= this.levels[this.minLevel];
  }

  private formatMessage(entry: LogEntry): string {
    const { timestamp, level, prefix, message } = entry;
    const levelStr = `[${level.toUpperCase().padEnd(5)}]`;
    const prefixStr = prefix ? `[${prefix}] ` : '';

    if (this.colorize) {
      const color = this.colors[level];
      return `${timestamp} ${color}${levelStr}${this.resetColor} ${prefixStr}${message}`;
    }

    return `${timestamp} ${levelStr} ${prefixStr}${message}`;
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      prefix: this.prefix,
      message,
      data,
    };

    const formattedMessage = this.formatMessage(entry);
    const logMethod =
      level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

    if (data !== undefined) {
      logMethod(formattedMessage, data);
    } else {
      logMethod(formattedMessage);
    }
  }

  debug(message: string, data?: unknown): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: unknown): void {
    this.log('error', message, data);
  }

  time(label: string): void {
    if (this.enabled) {
      const prefixedLabel = `${this.prefix ? `[${this.prefix}] ` : ''}${label}`;
      console.time(prefixedLabel);
      this.info(`Timer started: ${label}`);
    }
  }

  timeEnd(label: string): void {
    if (this.enabled) {
      const prefixedLabel = `${this.prefix ? `[${this.prefix}] ` : ''}${label}`;
      console.timeEnd(prefixedLabel);
      this.info(`Timer ended: ${label}`);
    }
  }

  group(label: string): void {
    if (this.enabled) {
      console.group(`${this.prefix ? `[${this.prefix}] ` : ''}${label}`);
    }
  }

  groupEnd(): void {
    if (this.enabled) {
      console.groupEnd();
    }
  }
}

// Default logger instance
export const logger = new TestLogger();

// Factory function for creating scoped loggers
export function createLogger(prefix: string, config?: Omit<LoggerConfig, 'prefix'>): TestLogger {
  return new TestLogger({ ...config, prefix });
}

// Re-export the logger type for use in other files
export type { TestLogger };
