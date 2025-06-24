import { LitElement, type TemplateResult } from 'lit';
import { fixture, html, oneEvent } from '@open-wc/testing';
import { vi } from 'vitest';

export { waitForElement } from '@/test/utils/lit-test-utils';

/**
 * Types an input field with a given value and triggers input event (supports both shadow and light DOM)
 */
export async function typeInInput(
  element: HTMLElement,
  selector: string,
  text: string
): Promise<void> {
  const input = (element.shadowRoot 
    ? element.shadowRoot.querySelector(selector)
    : element.querySelector(selector)) as HTMLInputElement;
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
export async function clickElement(
  element: HTMLElement,
  selector: string
): Promise<void> {
  const target = (element.shadowRoot 
    ? element.shadowRoot.querySelector(selector) 
    : element.querySelector(selector)) as HTMLElement;
  if (!target) throw new Error(`Element with selector ${selector} not found`);
  
  target.click();
  
  if (element instanceof LitElement) {
    await element.updateComplete;
  }
}

/**
 * Gets text content from an element (supports both shadow and light DOM)
 */
export function getTextContent(
  element: HTMLElement,
  selector: string
): string | null {
  const target = element.shadowRoot 
    ? element.shadowRoot.querySelector(selector)
    : element.querySelector(selector);
  return target?.textContent?.trim() || null;
}

/**
 * Checks if an element exists (supports both shadow and light DOM)
 */
export function elementExists(
  element: HTMLElement,
  selector: string
): boolean {
  return element.shadowRoot 
    ? !!element.shadowRoot.querySelector(selector)
    : !!element.querySelector(selector);
}

/**
 * Waits for an event and returns its detail
 */
export async function waitForEvent<T = any>(
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
 * Mocks fetch with common response patterns
 */
export function setupFetchMock() {
  const responses = new Map<string, { data: any; status?: number; headers?: Record<string, string> }>();
  
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
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
  
  global.fetch = fetchMock as any;
  
  return {
    mockResponse(url: string, data: any, options?: { status?: number; headers?: Record<string, string> }) {
      responses.set(url, { data, ...options });
    },
    clear() {
      responses.clear();
    },
    getCalls() {
      return fetchMock.mock.calls;
    }
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
    ...options
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
    const target = element.shadowRoot!.querySelector(selector);
    if (target) return target;
    
    await new Promise(resolve => setTimeout(resolve, 50));
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
  const target = element.shadowRoot!.querySelector(selector) as HTMLElement;
  if (!target) return null;
  
  return window.getComputedStyle(target);
}

/**
 * Checks if element has a specific class
 */
export function hasClass(
  element: HTMLElement,
  selector: string,
  className: string
): boolean {
  const target = element.shadowRoot!.querySelector(selector);
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
  const target = element.shadowRoot!.querySelector(selector);
  return target?.getAttribute(attribute) || null;
}

/**
 * Simulates form submission (supports both shadow and light DOM)
 */
export async function submitForm(
  element: HTMLElement,
  formSelector: string
): Promise<void> {
  const form = (element.shadowRoot 
    ? element.shadowRoot.querySelector(formSelector)
    : element.querySelector(formSelector)) as HTMLFormElement;
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
    value: width
  });
  Object.defineProperty(window, 'innerHeight', {
    writable: true,
    configurable: true,
    value: height
  });
  
  window.dispatchEvent(new Event('resize'));
}

/**
 * Resets viewport to default
 */
export function resetViewport() {
  setViewport(1024, 768);
}