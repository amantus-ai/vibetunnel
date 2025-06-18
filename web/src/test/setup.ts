import { vi } from 'vitest';

// Set test environment
process.env.NODE_ENV = 'test';

// Only mock node-pty for unit tests, not integration tests
if (!process.env.VITEST_INTEGRATION) {
  // Mock node-pty for tests since it requires native bindings
  vi.mock('node-pty', () => ({
    spawn: vi.fn(() => ({
      pid: 12345,
      process: 'mock-process',
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      on: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn(),
    })),
  }));
}

// Set up global test utilities
global.fetch = vi.fn();

// Mock WebSocket for tests
global.WebSocket = vi.fn(() => ({
  send: vi.fn(),
  close: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  readyState: 1,
})) as unknown as typeof WebSocket;

// Add custom matchers if needed
expect.extend({
  toBeValidSession(received) {
    const pass =
      received &&
      typeof received.id === 'string' &&
      typeof received.command === 'string' &&
      typeof received.workingDir === 'string' &&
      ['running', 'exited'].includes(received.status);

    return {
      pass,
      message: () =>
        pass
          ? `expected ${received} not to be a valid session`
          : `expected ${received} to be a valid session`,
    };
  },
});
