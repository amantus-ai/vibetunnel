import { parseVerbosityLevel, VerbosityLevel } from './logger.js';

/**
 * Parse verbosity level from environment variables
 * Checks VIBETUNNEL_LOG_LEVEL first, then falls back to VIBETUNNEL_DEBUG for backward compatibility
 * @returns The parsed verbosity level or undefined if not set
 */
export function parseVerbosityFromEnv(): VerbosityLevel | undefined {
  // Check VIBETUNNEL_LOG_LEVEL first
  if (process.env.VIBETUNNEL_LOG_LEVEL) {
    const parsed = parseVerbosityLevel(process.env.VIBETUNNEL_LOG_LEVEL);
    if (parsed !== undefined) {
      return parsed;
    }
    // Warn about invalid value
    console.warn(`Invalid VIBETUNNEL_LOG_LEVEL: ${process.env.VIBETUNNEL_LOG_LEVEL}`);
    console.warn('Valid levels: silent, error, warn, info, verbose, debug');
  }

  // Check legacy VIBETUNNEL_DEBUG for backward compatibility
  if (process.env.VIBETUNNEL_DEBUG === '1' || process.env.VIBETUNNEL_DEBUG === 'true') {
    return VerbosityLevel.DEBUG;
  }

  return undefined;
}
