/**
 * Shared module to suppress xterm.js parsing errors in both client and server environments
 *
 * This module provides a unified way to suppress noisy xterm.js parsing errors that occur
 * when the terminal encounters unsupported or proprietary escape sequences. These errors
 * are harmless but create significant console noise.
 *
 * Usage: Import and call suppressXtermErrors() at the very beginning of your entry point
 */

// Type declaration for our global flag
// Type declarations for the suppression flag
// We use 'any' type for globalObj to avoid TypeScript errors in different environments
declare global {
  namespace NodeJS {
    interface Global {
      __xtermErrorsSuppressed?: boolean;
    }
  }
}

// Browser Window interface is extended conditionally at runtime

/**
 * Suppresses xterm.js parsing errors by overriding console methods
 * Works in both Node.js and browser environments
 */
export function suppressXtermErrors(): void {
  // Detect environment
  const isNode = typeof process !== 'undefined' && process.versions?.node;
  const globalObj = (isNode ? global : typeof globalThis !== 'undefined' ? globalThis : global) as {
    __xtermErrorsSuppressed?: boolean;
  };

  // Check if already suppressed to avoid multiple overrides
  if (globalObj.__xtermErrorsSuppressed) {
    return;
  }

  // Mark as suppressed
  globalObj.__xtermErrorsSuppressed = true;

  // Store original console methods
  const originalError = console.error;
  const originalWarn = console.warn;

  // Override console.error
  console.error = (...args: unknown[]) => {
    if (shouldSuppressError(args)) {
      return; // Suppress xterm.js parsing errors
    }
    originalError.apply(console, args);
  };

  // Override console.warn
  console.warn = (...args: unknown[]) => {
    if (shouldSuppressError(args)) {
      return; // Suppress xterm.js parsing warnings
    }
    originalWarn.apply(console, args);
  };

  // Log suppression activation in debug mode
  if (isNode && process.env.VIBETUNNEL_DEBUG === '1') {
    originalWarn.call(console, '[suppress-xterm-errors] xterm.js error suppression activated');
  }
}

/**
 * Checks if the given console arguments represent an xterm.js parsing error
 */
function shouldSuppressError(args: unknown[]): boolean {
  if (!args[0] || typeof args[0] !== 'string') {
    return false;
  }

  const message = args[0];

  // Check for xterm.js parsing errors
  if (message.includes('xterm.js: Parsing error:')) {
    return true;
  }

  // Also suppress related parsing errors that might come from xterm
  if (message.includes('Unable to process character') && message.includes('xterm')) {
    return true;
  }

  return false;
}

/**
 * Restore original console methods (useful for testing)
 */
export function restoreConsole(): void {
  // This would need to store the originals somewhere accessible
  // For now, this is a placeholder for potential future use
  const isNode = typeof process !== 'undefined' && process.versions?.node;
  const globalObj = (isNode ? global : typeof globalThis !== 'undefined' ? globalThis : global) as {
    __xtermErrorsSuppressed?: boolean;
  };

  if (globalObj.__xtermErrorsSuppressed) {
    delete globalObj.__xtermErrorsSuppressed;
    // Note: We can't actually restore without storing the originals globally
    // This function is mainly here for API completeness
  }
}
