import { fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

export { waitForElement } from '@/test/utils/react-test-utils';

/**
 * Wait for a condition to be met with configurable polling
 */
export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  options: {
    timeout?: number;
    interval?: number;
    message?: string;
  } = {}
): Promise<void> {
  const { timeout = 5000, interval = 50, message = 'Condition not met' } = options;
  const startTime = Date.now();

  while (!(await condition())) {
    if (Date.now() - startTime > timeout) {
      throw new Error(`Timeout: ${message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * Wait for the next animation frame
 */
export async function waitForAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Wait for all pending promises to resolve
 */
export async function waitForMicrotasks(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

/**
 * Wait for a specific event to be fired on an element with timeout
 */
export async function waitForEventWithTimeout(
  element: EventTarget,
  eventName: string,
  options: {
    timeout?: number;
    predicate?: (event: Event) => boolean;
  } = {}
): Promise<Event> {
  const { timeout = 5000, predicate } = options;

  return new Promise((resolve, reject) => {
    // biome-ignore lint/style/useConst: timeoutId is used in closure before assignment
    let timeoutId: ReturnType<typeof setTimeout>;

    const handler = (event: Event) => {
      if (!predicate || predicate(event)) {
        clearTimeout(timeoutId);
        element.removeEventListener(eventName, handler);
        resolve(event);
      }
    };

    timeoutId = setTimeout(() => {
      element.removeEventListener(eventName, handler);
      reject(new Error(`Timeout waiting for event: ${eventName}`));
    }, timeout);

    element.addEventListener(eventName, handler);
  });
}

/**
 * Wait for async operations to complete (replaces hardcoded delays)
 */
export async function waitForAsync(delay: number = 0): Promise<void> {
  // First wait for microtasks
  await waitForMicrotasks();

  // Then wait for any pending updates in React components
  await new Promise((resolve) => setTimeout(resolve, delay));

  // Finally wait for another round of microtasks
  await waitForMicrotasks();
}

/**
 * Types an input field with a given value and triggers input event
 */
export async function typeInInput(
  element: HTMLElement,
  selector: string,
  text: string
): Promise<void> {
  const input = element.querySelector(selector) as HTMLInputElement;
  if (!input) throw new Error(`Input with selector ${selector} not found`);

  fireEvent.change(input, { target: { value: text } });
  fireEvent.input(input, { target: { value: text } });

  await waitFor(() => {
    expect(input.value).toBe(text);
  });
}

/**
 * Clicks an element and waits for updates
 */
export async function clickElement(element: HTMLElement, selector: string): Promise<void> {
  const target = element.querySelector(selector) as HTMLElement;
  if (!target) throw new Error(`Element with selector ${selector} not found`);

  fireEvent.click(target);
}

/**
 * Gets text content from an element
 */
export function getTextContent(element: HTMLElement, selector: string): string | null {
  const target = element.querySelector(selector);
  return target?.textContent?.trim() || null;
}

/**
 * Checks if an element exists
 */
export function elementExists(element: HTMLElement, selector: string): boolean {
  return !!element.querySelector(selector);
}

/**
 * Waits for an event and returns its detail
 */
export async function waitForEvent<T = unknown>(
  element: HTMLElement,
  eventName: string,
  action: () => void | Promise<void>
): Promise<T> {
  return new Promise<T>(async (resolve) => {
    const handler = (event: Event) => {
      element.removeEventListener(eventName, handler);
      resolve((event as CustomEvent<T>).detail);
    };
    element.addEventListener(eventName, handler);
    await action();
  });
}

/**
 * Creates a mock authentication header
 */
export function mockAuthHeader(): string {
  return 'Bearer test-token-123';
}

/**
 * Mock localStorage with isolation between tests
 */
export class LocalStorageMock implements Storage {
  private store: Record<string, string> = {};

  get length(): number {
    return Object.keys(this.store).length;
  }

  key(index: number): string | null {
    const keys = Object.keys(this.store);
    return keys[index] || null;
  }

  getItem(key: string): string | null {
    return this.store[key] || null;
  }

  setItem(key: string, value: string): void {
    this.store[key] = value;
  }

  removeItem(key: string): void {
    delete this.store[key];
  }

  clear(): void {
    this.store = {};
  }
}

/**
 * Setup isolated localStorage mock for tests
 */
export function setupLocalStorageMock(): LocalStorageMock {
  const mock = new LocalStorageMock();
  Object.defineProperty(global, 'localStorage', {
    value: mock,
    writable: true,
    configurable: true,
  });
  return mock;
}

/**
 * Restore original localStorage
 */
export function restoreLocalStorage(): void {
  // In Node.js test environment, localStorage doesn't exist by default
  // So we just need to delete our mock
  if ('localStorage' in global) {
    delete (global as { localStorage?: Storage }).localStorage;
  }
}

/**
 * Mocks fetch with common response patterns
 */
export function setupFetchMock() {
  const responses = new Map<
    string,
    { data: unknown; status?: number; headers?: Record<string, string> }
  >();

  const fetchMock = vi.fn(async (url: string, _options?: RequestInit) => {
    const response = responses.get(url);
    if (!response) {
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: 'Not found' }),
        text: async () => 'Not found',
      };
    }

    const { data, status = 200, headers = {} } = response;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(headers),
      json: async () => data,
      text: async () => JSON.stringify(data),
    };
  });

  global.fetch = fetchMock as typeof global.fetch;

  return {
    mockResponse(
      url: string,
      data: unknown,
      options?: { status?: number; headers?: Record<string, string> }
    ) {
      responses.set(url, { data, ...options });
    },
    clear() {
      responses.clear();
    },
    getCalls() {
      return fetchMock.mock.calls;
    },
  };
}

/**
 * Simulates keyboard event
 */
export async function pressKey(
  element: HTMLElement,
  key: string,
  options: Partial<KeyboardEventInit> = {}
): Promise<void> {
  fireEvent.keyDown(element, {
    key,
    ...options,
  });
}

/**
 * Gets all elements matching a selector
 */
export function getAllElements<T extends Element = Element>(
  element: HTMLElement,
  selector: string
): T[] {
  return Array.from(element.querySelectorAll<T>(selector));
}

/**
 * Waits for a specific element to appear
 */
export async function waitForElementToAppear(
  element: HTMLElement,
  selector: string,
  timeout: number = 5000
): Promise<Element> {
  const result = await waitFor(
    () => {
      const target = element.querySelector(selector);
      if (!target) throw new Error(`Element ${selector} not found`);
      return target;
    },
    { timeout }
  );
  return result;
}

/**
 * Gets computed styles for an element
 */
export function getComputedStyles(
  element: HTMLElement,
  selector: string
): CSSStyleDeclaration | null {
  const target = element.querySelector(selector) as HTMLElement;
  if (!target) return null;

  return window.getComputedStyle(target);
}

/**
 * Checks if element has a specific class
 */
export function hasClass(element: HTMLElement, selector: string, className: string): boolean {
  const target = element.querySelector(selector);
  return target?.classList.contains(className) || false;
}

/**
 * Gets attribute value from element
 */
export function getAttribute(
  element: HTMLElement,
  selector: string,
  attribute: string
): string | null {
  const target = element.querySelector(selector);
  return target?.getAttribute(attribute) || null;
}

/**
 * Simulates form submission
 */
export async function submitForm(element: HTMLElement, formSelector: string): Promise<void> {
  const form = element.querySelector(formSelector) as HTMLFormElement;
  if (!form) throw new Error(`Form ${formSelector} not found`);

  fireEvent.submit(form);
}

/**
 * Creates a viewport with specific dimensions for testing responsive behavior
 */
export function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, 'innerHeight', {
    writable: true,
    configurable: true,
    value: height,
  });

  window.dispatchEvent(new Event('resize'));
}

/**
 * Resets viewport to default
 */
export function resetViewport() {
  setViewport(1024, 768);
}
