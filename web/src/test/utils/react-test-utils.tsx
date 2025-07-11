import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  type RenderOptions,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { type ReactElement, type ReactNode } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { vi } from 'vitest';
import type { Session } from '../../shared/types';
import type { ActivityStatus } from '../types/test-types';
import { createTestSession } from './test-factories';

/**
 * Custom render function that wraps components with providers
 */
export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const AllTheProviders = ({ children }: { children: ReactNode }) => {
    return (
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>{children}</BrowserRouter>
      </QueryClientProvider>
    );
  };

  return render(ui, { wrapper: AllTheProviders, ...options });
}

/**
 * Waits for an element to finish updating (React version)
 */
export async function waitForElement(testId: string): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });
}

/**
 * Triggers an event on an element and waits for updates
 */
export async function triggerEvent(
  element: HTMLElement,
  eventName: string,
  detail?: unknown
): Promise<void> {
  await act(async () => {
    const event = new CustomEvent(eventName, {
      detail,
      bubbles: true,
      composed: true,
    });
    element.dispatchEvent(event);
  });
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
  }

  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
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
export async function waitForCondition(
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

/**
 * Setup user event for testing
 */
export function setupUserEvent() {
  return userEvent.setup();
}

/**
 * Click an element by test id
 */
export async function clickByTestId(testId: string) {
  const user = setupUserEvent();
  const element = screen.getByTestId(testId);
  await user.click(element);
}

/**
 * Type text into an input by test id
 */
export async function typeByTestId(testId: string, text: string) {
  const user = setupUserEvent();
  const element = screen.getByTestId(testId);
  await user.type(element, text);
}

/**
 * Clear and type text into an input by test id
 */
export async function clearAndTypeByTestId(testId: string, text: string) {
  const user = setupUserEvent();
  const element = screen.getByTestId(testId);
  await user.clear(element);
  await user.type(element, text);
}

/**
 * Wait for loading to finish
 */
export async function waitForLoadingToFinish() {
  await waitFor(() => {
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });
}

/**
 * Mock local storage
 */
export function mockLocalStorage(data: Record<string, string> = {}) {
  const localStorageMock = {
    getItem: vi.fn((key: string) => data[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      data[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete data[key];
    }),
    clear: vi.fn(() => {
      Object.keys(data).forEach((key) => delete data[key]);
    }),
    length: Object.keys(data).length,
    key: vi.fn((index: number) => Object.keys(data)[index] || null),
  };

  Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
    writable: true,
  });

  return localStorageMock;
}

/**
 * Wait for React Query to finish
 */
export async function waitForQuery(queryKey: unknown[]) {
  await waitFor(() => {
    const queryClient = new QueryClient();
    const query = queryClient.getQueryState(queryKey);
    expect(query?.status).toBe('success');
  });
}

/**
 * Mock window.matchMedia
 */
export function mockMatchMedia(matches: boolean = false) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}
