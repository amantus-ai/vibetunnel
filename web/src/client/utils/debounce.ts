/**
 * Creates a debounced version of a function that delays its execution
 * until after the specified delay has passed since the last invocation.
 *
 * @param fn The function to debounce
 * @param delay The delay in milliseconds
 * @returns A debounced version of the function with a cancel method
 */
export interface DebouncedFunction<T extends (...args: unknown[]) => unknown> {
  (...args: Parameters<T>): void;
  cancel: () => void;
}

export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): DebouncedFunction<T> {
  let timeoutId: NodeJS.Timeout | null = null;

  const debounced = (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, delay);
  };

  // Add a method to cancel pending invocations
  debounced.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  return debounced as DebouncedFunction<T>;
}
