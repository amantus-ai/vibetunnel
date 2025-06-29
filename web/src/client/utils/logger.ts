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

// Auth config cache to reduce redundant requests
let authConfigCache: { noAuth: boolean; timestamp: number } | null = null;
const AUTH_CONFIG_TTL = 60000; // 1 minute

/**
 * Enable or disable debug mode for all loggers
 * @param enabled - Whether to enable debug logging
 */
export function setDebugMode(enabled: boolean): void {
  debugMode = enabled;
}

/**
 * Clear the auth config cache (mainly for testing)
 */
export function clearAuthConfigCache(): void {
  authConfigCache = null;
}

/**
 * Get cached auth configuration or fetch it
 * @returns Whether no-auth mode is enabled
 */
async function getAuthConfig(): Promise<boolean> {
  const now = Date.now();

  // Return cached value if still valid
  if (authConfigCache && now - authConfigCache.timestamp < AUTH_CONFIG_TTL) {
    return authConfigCache.noAuth;
  }

  // Fetch and cache new value
  try {
    const configResponse = await fetch('/api/auth/config');
    if (configResponse.ok) {
      const authConfig = await configResponse.json();
      authConfigCache = {
        noAuth: authConfig.noAuth === true,
        timestamp: now,
      };
      return authConfigCache.noAuth;
    }
  } catch {
    // Ignore auth config fetch errors
  }

  // Default to false if fetch fails
  return false;
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

    // Check if we have authentication before sending logs
    const authHeader = authClient.getAuthHeader();

    // Check if no-auth mode is enabled (cached)
    const isNoAuthMode = await getAuthConfig();

    // Skip sending logs if not authenticated AND not in no-auth mode
    if (!authHeader.Authorization && !isNoAuthMode) {
      return;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Only add auth header if we have one
    if (authHeader.Authorization) {
      headers.Authorization = authHeader.Authorization;
    }

    await fetch('/api/logs/client', {
      method: 'POST',
      headers,
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
 * Creates a logger instance for a specific module
 * @param moduleName - The name of the module for log context
 * @returns Logger instance with log, warn, error, and debug methods
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
