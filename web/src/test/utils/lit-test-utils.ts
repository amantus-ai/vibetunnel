import { fixture } from '@open-wc/testing';
import { LitElement, type TemplateResult } from 'lit';
import { vi } from 'vitest';
import type { Session } from '../../shared/types';
import type { ActivityStatus } from '../types/test-types';
import { createTestSession } from './test-factories';

/**
 * Creates a test fixture for a LitElement component
 */
export async function createFixture<T extends LitElement>(template: TemplateResult): Promise<T> {
  const element = await fixture<T>(template);
  await element.updateComplete;
  return element;
}

/**
 * Waits for an element to finish updating
 */
export async function waitForElement(element: LitElement): Promise<void> {
  await element.updateComplete;
  // Wait for any pending microtasks
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Triggers an event on an element and waits for updates
 */
export async function triggerEvent(
  element: HTMLElement,
  eventName: string,
  detail?: unknown
): Promise<void> {
  const event = new CustomEvent(eventName, {
    detail,
    bubbles: true,
    composed: true,
  });
  element.dispatchEvent(event);

  if (element instanceof LitElement) {
    await element.updateComplete;
  }
}

/**
 * Mocks a fetch response
 */
export function mockFetch(
  response: unknown,
  options: {
    status?: number;
    headers?: Record<string, string>;
    ok?: boolean;
  } = {}
): void {
  const { status = 200, headers = { 'Content-Type': 'application/json' }, ok = true } = options;

  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok,
    status,
    headers: new Headers(headers),
    json: async () => response,
    text: async () => JSON.stringify(response),
  });
}

/**
 * Creates a mock WebSocket instance
 */
export class MockWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = new Set<MockWebSocket>();

  url: string;
  readyState: number = MockWebSocket.CONNECTING;
  binaryType: 'blob' | 'arraybuffer' = 'arraybuffer';

  onopen?: (event: Event) => void;
  onclose?: (event: CloseEvent) => void;
  onerror?: (event: Event) => void;
  onmessage?: (event: MessageEvent) => void;

  constructor(url: string) {
    super();
    this.url = url;
    MockWebSocket.instances.add(this);
  }

  static reset(): void {
    MockWebSocket.instances.clear();
  }

  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    MockWebSocket.instances.delete(this);
    const event = new CloseEvent('close');
    this.dispatchEvent(event);
    this.onclose?.(event);
  });

  mockOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    const event = new Event('open');
    this.dispatchEvent(event);
    this.onopen?.(event);
  }

  mockMessage(data: unknown): void {
    const event = new MessageEvent('message', { data });
    this.dispatchEvent(event);
    this.onmessage?.(event);
  }

  mockError(): void {
    const event = new Event('error');
    this.dispatchEvent(event);
    this.onerror?.(event);
  }

  mockClose(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSED;
    const event = new CloseEvent('close', { code, reason });
    this.dispatchEvent(event);
    this.onclose?.(event);
  }
}

/**
 * Creates a mock EventSource instance
 */
export class MockEventSource extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances = new Set<MockEventSource>();

  url: string;
  readyState: number = MockEventSource.CONNECTING;
  withCredentials: boolean = false;

  onopen?: (event: Event) => void;
  onerror?: (event: Event) => void;
  onmessage?: (event: MessageEvent) => void;

  constructor(url: string, eventSourceInitDict?: EventSourceInit) {
    super();
    this.url = url;
    if (eventSourceInitDict?.withCredentials) {
      this.withCredentials = eventSourceInitDict.withCredentials;
    }
    MockEventSource.instances.add(this);
  }

  close = vi.fn(() => {
    this.readyState = MockEventSource.CLOSED;
    MockEventSource.instances.delete(this);
  });

  mockOpen(): void {
    this.readyState = MockEventSource.OPEN;
    const event = new Event('open');
    this.dispatchEvent(event);
    this.onopen?.(event);
  }

  mockMessage(data: string, eventType?: string): void {
    const event = new MessageEvent(eventType || 'message', { data });
    this.dispatchEvent(event);
    if (!eventType || eventType === 'message') {
      this.onmessage?.(event);
    }
  }

  mockError(): void {
    const event = new Event('error');
    this.dispatchEvent(event);
    this.onerror?.(event);
  }
}

/**
 * Wait for a specific condition to be true
 */
export async function waitFor(
  condition: () => boolean,
  timeout: number = 5000,
  interval: number = 50
): Promise<void> {
  const startTime = Date.now();

  while (!condition()) {
    if (Date.now() - startTime > timeout) {
      throw new Error('Timeout waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * Creates mock session data for testing
 * Returns a proper Session object that matches the component expectations
 */
export function createMockSession(overrides: Partial<Session> = {}): Session {
  // Convert SessionData properties to Session properties if needed
  const overridesWithLegacy = overrides as Partial<Session> & {
    cmdline?: string[];
    cwd?: string;
    started_at?: string;
  };

  const command = overridesWithLegacy.command || overridesWithLegacy.cmdline || ['/bin/bash', '-l'];
  const workingDir = overridesWithLegacy.workingDir || overridesWithLegacy.cwd || '/home/test';
  const startedAt =
    overridesWithLegacy.startedAt || overridesWithLegacy.started_at || new Date().toISOString();

  return createTestSession({
    ...overrides,
    command: Array.isArray(command) ? command : [command],
    workingDir,
    startedAt,
  });
}

/**
 * Creates mock activity status for testing
 */
export function createMockActivityStatus(overrides: Partial<ActivityStatus> = {}): ActivityStatus {
  return {
    isActive: false,
    timestamp: new Date().toISOString(),
    session: createMockSession(),
    ...overrides,
  };
}
