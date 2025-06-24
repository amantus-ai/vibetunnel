interface LogLevel {
  log: 'log';
  warn: 'warn';
  error: 'error';
  debug: 'debug';
}

type LogMethod = (...args: unknown[]) => void;

interface Logger {
  log: LogMethod;
  warn: LogMethod;
  error: LogMethod;
  debug: LogMethod;
}

let debugMode = false;

/**
 * Enable or disable debug mode
 */
export function setDebugMode(enabled: boolean): void {
  debugMode = enabled;
}

/**
 * Format arguments for consistent logging
 */
function formatArgs(args: unknown[]): unknown[] {
  return args.map((arg) => {
    if (typeof arg === 'object' && arg !== null) {
      try {
        // Convert objects to formatted strings to match server logger behavior
        return JSON.stringify(arg, null, 2);
      } catch {
        return String(arg);
      }
    }
    return arg;
  });
}

/**
 * Send log to server endpoint
 */
async function sendToServer(level: keyof LogLevel, module: string, args: unknown[]): Promise<void> {
  try {
    // Import authClient singleton dynamically to avoid circular dependencies
    const { authClient } = await import('../services/auth-client.js');

    await fetch('/api/logs/client', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authClient.getAuthHeader(),
      },
      body: JSON.stringify({
        level,
        module,
        args: formatArgs(args),
      }),
    });
  } catch {
    // Silently ignore network errors to avoid infinite loops
  }
}

/**
 * Create a logger for a specific module
 * This mirrors the server's createLogger interface
 */
export function createLogger(moduleName: string): Logger {
  const createLogMethod = (level: keyof LogLevel): LogMethod => {
    return (...args: unknown[]) => {
      // Skip debug logs if debug mode is disabled
      if (level === 'debug' && !debugMode) return;

      // Log to browser console
      console[level](`[${moduleName}]`, ...args);

      // Send to server (fire and forget)
      sendToServer(level, moduleName, args);
    };
  };

  return {
    log: createLogMethod('log'),
    warn: createLogMethod('warn'),
    error: createLogMethod('error'),
    debug: createLogMethod('debug'),
  };
}
