/**
 * Constants and utilities for IME input handling
 */

/**
 * Keys that are allowed to be processed even when IME input is focused
 */
export const IME_ALLOWED_KEYS = ['Home', 'End', 'Escape'] as const;

/**
 * Check if a keyboard event is allowed during IME input focus
 * @param event The keyboard event to check
 * @returns true if the event should be allowed, false otherwise
 */
export function isIMEAllowedKey(event: KeyboardEvent): boolean {
  // Allow all Cmd/Ctrl combinations (including Cmd+V)
  if (event.metaKey || event.ctrlKey) {
    return true;
  }

  // Allow Alt/Option combinations (like Option+Backspace for word deletion)
  if (event.altKey) {
    return true;
  }

  // Allow specific navigation and editing keys
  return IME_ALLOWED_KEYS.includes(event.key as (typeof IME_ALLOWED_KEYS)[number]);
}
