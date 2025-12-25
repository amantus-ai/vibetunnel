import { oneEvent } from '@open-wc/testing';
import { LitElement } from 'lit';
import { vi } from 'vitest';

export { waitForElement } from '@/test/utils/lit-test-utils';

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
    const handler = (event: Event) => {
      if (!predicate || predicate(event)) {
        clearTimeout(timeoutId);
        element.removeEventListener(eventName, handler);
        resolve(event);
      }
    };

    const timeoutId = setTimeout(() => {
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

  // Then wait for any pending updates in LitElement components
  await new Promise((resolve) => setTimeout(resolve, delay));

  // Finally wait for another round of microtasks
  await waitForMicrotasks();
}

/**
 * Types an input field with a given value and triggers input event (supports both shadow and light DOM)
 */
export async function typeInInput(
  element: HTMLElement,
  selector: string,
  text: string
): Promise<void> {
  const input = (
    element.shadowRoot
      ? element.shadowRoot.querySelector(selector)
      : element.querySelector(selector)
  ) as HTMLInputElement;
  if (!input) throw new Error(`Input with selector ${selector} not found`);

  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));

  if (element instanceof LitElement) {
    await element.updateComplete;
  }
}

/**
 * Clicks an element and waits for updates (supports both shadow and light DOM)
 */
export async function clickElement(element: HTMLElement, selector: string): Promise<void> {
  const target = (
    element.shadowRoot
      ? element.shadowRoot.querySelector(selector)
      : element.querySelector(selector)
  ) as HTMLElement;
  if (!target) throw new Error(`Element with selector ${selector} not found`);

  target.click();

  if (element instanceof LitElement) {
    await element.updateComplete;
  }
}

/**
 * Gets text content from an element (supports both shadow and light DOM)
 */
export function getTextContent(element: HTMLElement, selector: string): string | null {
  const target = element.shadowRoot
    ? element.shadowRoot.querySelector(selector)
    : element.querySelector(selector);
  return target?.textContent?.trim() || null;
}

/**
 * Checks if an element exists (supports both shadow and light DOM)
 */
export function elementExists(element: HTMLElement, selector: string): boolean {
  return element.shadowRoot
    ? !!element.shadowRoot.querySelector(selector)
    : !!element.querySelector(selector);
}

/**
 * Waits for an event and returns its detail
 */
export async function waitForEvent<T = unknown>(
  element: HTMLElement,
  eventName: string,
  action: () => void | Promise<void>
): Promise<T> {
  const eventPromise = oneEvent(element, eventName);
  await action();
  const event = await eventPromise;
  return (event as CustomEvent<T>).detail;
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
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    composed: true,
    ...options,
  });
  element.dispatchEvent(event);

  if (element instanceof LitElement) {
    await element.updateComplete;
  }
}

/**
 * Gets all elements matching a selector (supports both shadow and light DOM)
 */
export function getAllElements<T extends Element = Element>(
  element: HTMLElement,
  selector: string
): T[] {
  return element.shadowRoot
    ? Array.from(element.shadowRoot.querySelectorAll<T>(selector))
    : Array.from(element.querySelectorAll<T>(selector));
}

/**
 * Waits for a specific element to appear
 */
export async function waitForElementToAppear(
  element: HTMLElement,
  selector: string,
  timeout: number = 5000
): Promise<Element> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const target = element.shadowRoot?.querySelector(selector);
    if (target) return target;

    await new Promise((resolve) => setTimeout(resolve, 50));
    if (element instanceof LitElement) {
      await element.updateComplete;
    }
  }

  throw new Error(`Element ${selector} did not appear within ${timeout}ms`);
}

/**
 * Gets computed styles for an element
 */
export function getComputedStyles(
  element: HTMLElement,
  selector: string
): CSSStyleDeclaration | null {
  const target = element.shadowRoot?.querySelector(selector) as HTMLElement;
  if (!target) return null;

  return window.getComputedStyle(target);
}

/**
 * Checks if element has a specific class
 */
export function hasClass(element: HTMLElement, selector: string, className: string): boolean {
  const target = element.shadowRoot?.querySelector(selector);
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
  const target = element.shadowRoot?.querySelector(selector);
  return target?.getAttribute(attribute) || null;
}

/**
 * Simulates form submission (supports both shadow and light DOM)
 */
export async function submitForm(element: HTMLElement, formSelector: string): Promise<void> {
  const form = (
    element.shadowRoot
      ? element.shadowRoot.querySelector(formSelector)
      : element.querySelector(formSelector)
  ) as HTMLFormElement;
  if (!form) throw new Error(`Form ${formSelector} not found`);

  const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
  form.dispatchEvent(submitEvent);

  if (element instanceof LitElement) {
    await element.updateComplete;
  }
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
