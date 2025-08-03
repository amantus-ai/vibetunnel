/**
 * Terminal component constants and selectors
 *
 * Centralized definitions to prevent breaking changes when IDs or classes are modified
 */

/**
 * HTML element IDs used across terminal components
 */
export const TERMINAL_IDS = {
  /** Main session container element */
  SESSION_TERMINAL: 'session-terminal',
  /** Buffer container for vibe-terminal-buffer component */
  BUFFER_CONTAINER: 'buffer-container',
  /** Terminal container for terminal.ts component */
  TERMINAL_CONTAINER: 'terminal-container',
} as const;

/**
 * Standard terminal font family used across the application
 */
export const TERMINAL_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace';

/**
 * IME input vertical offset in pixels for better alignment
 */
export const IME_VERTICAL_OFFSET_PX = 3;

/**
 * CJK (Chinese, Japanese, Korean) language codes for IME detection
 */
export const CJK_LANGUAGE_CODES = [
  'zh',
  'zh-CN',
  'zh-TW',
  'zh-HK',
  'zh-SG', // Chinese variants
  'ja',
  'ja-JP', // Japanese
  'ko',
  'ko-KR', // Korean
] as const;
