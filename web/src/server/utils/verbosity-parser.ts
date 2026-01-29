import { parseVerbosityLevel, VerbosityLevel } from './logger.js';

/**
 * Parse verbosity level from environment variables
 * Checks SHELLOPS_LOG_LEVEL first, then falls back to SHELLOPS_DEBUG for backward compatibility
 * @returns The parsed verbosity level or undefined if not set
 */
export function parseVerbosityFromEnv(): VerbosityLevel | undefined {
  // Check SHELLOPS_LOG_LEVEL first
  if (process.env.SHELLOPS_LOG_LEVEL) {
    const parsed = parseVerbosityLevel(process.env.SHELLOPS_LOG_LEVEL);
    if (parsed !== undefined) {
      return parsed;
    }
    // Warn about invalid value
    console.warn(`Invalid SHELLOPS_LOG_LEVEL: ${process.env.SHELLOPS_LOG_LEVEL}`);
    console.warn('Valid levels: silent, error, warn, info, verbose, debug');
  }

  // Check legacy SHELLOPS_DEBUG for backward compatibility
  if (process.env.SHELLOPS_DEBUG === '1' || process.env.SHELLOPS_DEBUG === 'true') {
    return VerbosityLevel.DEBUG;
  }

  return undefined;
}
