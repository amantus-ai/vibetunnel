/**
 * Event utility functions for consistent event handling across the application
 */

/**
 * Prevents default action and stops event propagation.
 * Use this when you need to completely consume an event, preventing both
 * default browser behavior and event bubbling.
 *
 * Common use cases:
 * - Modal dialogs (prevent backdrop clicks from closing)
 * - Drag and drop operations
 * - Custom keyboard shortcuts
 * - Nested interactive elements
 *
 * @param e The event to consume
 */
export function consumeEvent<T extends Event>(e: T): void {
  e.preventDefault();
  e.stopPropagation();
}

/**
 * Type guard to check if an event has preventDefault method.
 * Useful for handling events that might not support preventDefault.
 *
 * @param e The event to check
 * @returns True if the event has preventDefault method
 */
export function isPreventableEvent(e: Event): e is Event & { preventDefault: () => void } {
  return 'preventDefault' in e && typeof e.preventDefault === 'function';
}

/**
 * Type guard to check if an event has stopPropagation method.
 * Useful for handling events that might not support stopPropagation.
 *
 * @param e The event to check
 * @returns True if the event has stopPropagation method
 */
export function isStoppableEvent(e: Event): e is Event & { stopPropagation: () => void } {
  return 'stopPropagation' in e && typeof e.stopPropagation === 'function';
}
