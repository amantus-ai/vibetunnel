/**
 * Unified prompt pattern detection for terminal output
 * Pre-compiled regexes for optimal performance
 */

import { createLogger } from './logger.js';

const logger = createLogger('prompt-patterns');

// ANSI escape code pattern for stripping
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes require control characters
const ANSI_ESCAPE_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g;

// Single pre-compiled regex combining all prompt patterns
// (?<![.>])         - Negative lookbehind: not preceded by . or > (excludes Python)
// (?:\[[^\]]*\])?   - Optional brackets for user@host, paths, etc
// [$>#%❯➜]         - Common prompt characters
// \s*               - Optional trailing whitespace
// (?:\x1b\[...)?    - Optional ANSI escape sequence
// $                 - End of string anchor
// biome-ignore lint/suspicious/noControlCharactersInRegex: Terminal prompts may contain escape sequences
const UNIFIED_PROMPT_END_REGEX = /(?<![.>])(?:\[[^\]]*\])?[$>#%❯➜]\s*(?:\x1b\[[0-9;]*[a-zA-Z])?$/;

// Regex for detecting if entire output is just a prompt (no other content)
// ^                 - Start of string anchor
// (?:\[[^\]]*\])?   - Optional brackets for user@host, paths, etc
// (?<!^[.>]{2})     - Negative lookbehind: not preceded by .. or >> at start
// [$>#%❯➜]         - Common prompt characters
// \s*               - Optional trailing whitespace
// $                 - End of string anchor
const PROMPT_ONLY_REGEX = /^(?:\[[^\]]*\])?(?<!^[.>]{2})[$>#%❯➜]\s*$/;

// More specific patterns for different shells (for future shell-specific optimizations)
// Order matters - more specific patterns should come first
const SHELL_SPECIFIC_PATTERNS = {
  // Multi-line prompts (like in Python REPL) - check FIRST before PowerShell
  python: /^>>>\s*$/,
  pythonContinuation: /^\.\.\.\s*$/,

  // Bracketed prompts (user@host, git branch, etc.) - check early as they're specific
  bracketed: /\][#$]\s*$/,

  // Root prompt
  root: /#\s*$/,

  // PowerShell - now after Python to avoid false matches
  powershell: /^PS.*>\s*$|^>\s*$/,

  // Modern shells
  zsh: /[%❯]\s*$/,
  fish: /[❯➜]\s*$/,

  // Basic shells - check last as $ is common
  bash: /\$\s*$/,
  sh: /\$\s*$/,

  // With escape sequences (for color prompts)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Terminal escape sequences
  withEscape: /[$>#%❯➜]\s*\x1b\[/,
};

export namespace PromptDetector {
  // Cache for regex test results to avoid repeated tests
  const endPromptCache = new Map<string, boolean>();
  const onlyPromptCache = new Map<string, boolean>();
  let cacheSize = 0;
  const MAX_CACHE_SIZE = 1000;

  /**
   * Check if the entire output is just a prompt (no other content)
   * Used by activity detector to determine if output is meaningful
   */
  export function isPromptOnly(data: string): boolean {
    // Input validation
    if (data.length > 10000) {
      logger.warn('Unusually long prompt input detected', { length: data.length });
      return false;
    }

    const trimmed = data.trim();

    // Check cache first
    if (onlyPromptCache.has(trimmed)) {
      const cachedResult = onlyPromptCache.get(trimmed);
      return cachedResult ?? false;
    }

    const result = PROMPT_ONLY_REGEX.test(trimmed);

    // Cache result
    cacheResult(onlyPromptCache, trimmed, result);

    return result;
  }

  /**
   * Check if output ends with a prompt (for title injection)
   * This is used to determine when to inject terminal title sequences
   */
  export function endsWithPrompt(data: string): boolean {
    // For title injection, we need to check the last part of the output
    // Use last 100 chars as cache key to balance cache efficiency and accuracy
    const cacheKey = data.slice(-100);

    // Check cache first
    if (endPromptCache.has(cacheKey)) {
      const cachedResult = endPromptCache.get(cacheKey);
      return cachedResult ?? false;
    }

    // Strip ANSI codes for more reliable detection
    const cleanData = data.replace(ANSI_ESCAPE_REGEX, '');
    const result = UNIFIED_PROMPT_END_REGEX.test(cleanData);

    // Cache result
    cacheResult(endPromptCache, cacheKey, result);

    if (result) {
      logger.debug('Detected prompt at end of output');
    }

    return result;
  }

  /**
   * Get specific shell type based on prompt pattern
   * This can be used for shell-specific optimizations in the future
   */
  export function getShellType(data: string): keyof typeof SHELL_SPECIFIC_PATTERNS | null {
    const trimmed = data.trim();

    // Check each shell pattern
    for (const [shell, pattern] of Object.entries(SHELL_SPECIFIC_PATTERNS)) {
      if (pattern.test(trimmed)) {
        return shell as keyof typeof SHELL_SPECIFIC_PATTERNS;
      }
    }

    return null;
  }

  /**
   * Helper to cache results with size limit
   */
  function cacheResult(cache: Map<string, boolean>, key: string, value: boolean): void {
    if (cacheSize >= MAX_CACHE_SIZE) {
      // Clear oldest entries when cache is full
      const entriesToDelete = Math.floor(MAX_CACHE_SIZE * 0.2); // Clear 20%
      const iterator = cache.keys();
      for (let i = 0; i < entriesToDelete; i++) {
        const keyToDelete = iterator.next().value;
        if (keyToDelete) {
          cache.delete(keyToDelete);
          cacheSize--;
        }
      }
    }

    cache.set(key, value);
    cacheSize++;
  }

  /**
   * Clear all caches (useful for tests or memory management)
   */
  export function clearCache(): void {
    endPromptCache.clear();
    onlyPromptCache.clear();
    cacheSize = 0;
    logger.debug('Prompt pattern caches cleared');
  }

  /**
   * Get cache statistics for monitoring
   */
  export function getCacheStats(): {
    size: number;
    maxSize: number;
    hitRate: { end: number; only: number };
  } {
    return {
      size: cacheSize,
      maxSize: MAX_CACHE_SIZE,
      hitRate: {
        end: endPromptCache.size,
        only: onlyPromptCache.size,
      },
    };
  }
}

// Export for backward compatibility
export const isPromptOnly = PromptDetector.isPromptOnly;
export const endsWithPrompt = PromptDetector.endsWithPrompt;
