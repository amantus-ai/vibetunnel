// Global test setup for Vitest
import { webcrypto } from 'crypto';
import { vi } from 'vitest';

// Disable SEA loader for tests
process.env.VIBETUNNEL_SEA = '';

// Polyfill crypto for Node.js environments
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
}

// Mock the native pty module before any imports
vi.mock('node-pty', () => {
  // Create a more complete mock that simulates PTY behavior
  const createMockPty = (command: string, args: string[]) => {
    let dataCallback: ((data: string) => void) | null = null;
    let exitCallback: ((exitInfo: { exitCode: number; signal?: number }) => void) | null = null;
    let isKilled = false;
    let cols = 80;
    let rows = 24;

    const mockPty = {
      pid: Math.floor(Math.random() * 10000) + 1000,
      cols,
      rows,
      process: command,
      handleFlowControl: false,
      on: vi.fn(),
      resize: vi.fn((newCols: number, newRows: number) => {
        cols = newCols;
        rows = newRows;
      }),
      write: vi.fn((data: string) => {
        // Simulate echo behavior for 'cat' command
        if (command === 'sh' && args[0] === '-c' && args[1] === 'cat' && dataCallback) {
          // Echo back the input
          setTimeout(() => {
            if (!isKilled && dataCallback) {
              dataCallback(data);
            }
          }, 10);
        }
      }),
      kill: vi.fn((signal?: string) => {
        isKilled = true;
        // Simulate process exit
        if (exitCallback) {
          setTimeout(() => {
            exitCallback({ exitCode: signal === 'SIGTERM' ? 143 : 137, signal: 15 });
          }, 50);
        }
      }),
      onData: vi.fn((callback: (data: string) => void) => {
        dataCallback = callback;
        // For 'echo' command, immediately output but don't exit yet
        if (command === 'echo' && args[0] === 'test') {
          setTimeout(() => {
            if (dataCallback) dataCallback('test\n');
            // Don't exit immediately - let the test control when to exit
          }, 10);
        }
      }),
      onExit: vi.fn((callback: (exitInfo: { exitCode: number; signal?: number }) => void) => {
        exitCallback = callback;
        // For 'exit' command, exit immediately
        if (command === 'exit') {
          setTimeout(() => {
            if (exitCallback) exitCallback({ exitCode: 0 });
          }, 10);
        }
        // For 'echo' command, exit after a longer delay
        if (command === 'echo') {
          setTimeout(() => {
            if (!isKilled && exitCallback) exitCallback({ exitCode: 0 });
          }, 2000); // Wait 2 seconds before exiting
        }
      }),
    };

    return mockPty;
  };

  return {
    spawn: vi.fn((command: string, args: string[], _options: unknown) => {
      return createMockPty(command, args);
    }),
  };
});

// Mock global objects that might not exist in test environments
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  root = null;
  rootMargin = '';
  thresholds = [];
};

// Mock matchMedia (only if window exists - for browser tests)
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
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

// Mock WebSocket for tests that need it
global.WebSocket = class WebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState: number = WebSocket.CONNECTING;
  binaryType: 'blob' | 'arraybuffer' = 'blob';

  constructor(url: string) {
    super();
    this.url = url;
  }

  send() {}
  close() {
    this.readyState = WebSocket.CLOSED;
  }
} as unknown as typeof WebSocket;

// Mock EventSource for SSE tests
global.EventSource = class EventSource extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  url: string;
  readyState: number = EventSource.CONNECTING;
  withCredentials: boolean = false;

  constructor(url: string, eventSourceInitDict?: EventSourceInit) {
    super();
    this.url = url;
    if (eventSourceInitDict?.withCredentials) {
      this.withCredentials = eventSourceInitDict.withCredentials;
    }
  }

  close() {
    this.readyState = EventSource.CLOSED;
  }
} as unknown as typeof EventSource;

// Set up fetch mock (only for non-e2e tests)
if (typeof window !== 'undefined') {
  global.fetch = vi.fn();
}

// Configure console to reduce noise in tests
const originalError = console.error;
const originalWarn = console.warn;

beforeAll(() => {
  // Suppress specific console errors/warnings during tests
  console.error = (...args: unknown[]) => {
    if (
      typeof args[0] === 'string' &&
      (args[0].includes('Not implemented') || args[0].includes('Failed to fetch'))
    ) {
      return;
    }
    originalError.call(console, ...args);
  };

  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('LitElement')) {
      return;
    }
    originalWarn.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
  console.warn = originalWarn;
});
