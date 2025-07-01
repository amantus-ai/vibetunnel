/**
 * Validation utilities for test inputs
 */

/**
 * Validates session name for security and correctness
 */
export function validateSessionName(name: string): void {
  if (!name || typeof name !== 'string') {
    throw new Error('Session name must be a non-empty string');
  }

  if (name.length > 100) {
    throw new Error('Session name must not exceed 100 characters');
  }

  // Allow alphanumeric, dash, underscore, dot, and space
  if (!/^[\w\-. ]+$/.test(name)) {
    throw new Error(
      'Session name contains invalid characters. Only letters, numbers, dash, underscore, dot, and space are allowed'
    );
  }
}

/**
 * Validates command for security
 */
export function validateCommand(command: string): void {
  if (!command || typeof command !== 'string') {
    throw new Error('Command must be a non-empty string');
  }

  if (command.length > 1000) {
    throw new Error('Command must not exceed 1000 characters');
  }

  // Detect potentially dangerous patterns
  const dangerousPatterns = [
    /[;&|`$]/, // Command separators and substitution
    /\.\.\//, // Directory traversal
    />+\s*\/dev\/null/, // Redirections that could hide errors
    /rm\s+-rf/, // Dangerous commands
    /:(){ :|:& };:/, // Fork bomb
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(command)) {
      throw new Error(`Command contains potentially dangerous pattern: ${pattern}`);
    }
  }
}

/**
 * Sanitizes a string for safe use in HTML contexts
 */
export function sanitizeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Validates URL format
 */
export function validateUrl(url: string): void {
  try {
    const parsed = new URL(url);
    // Only allow http and https protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Invalid protocol');
    }
  } catch {
    throw new Error('Invalid URL format');
  }
}
