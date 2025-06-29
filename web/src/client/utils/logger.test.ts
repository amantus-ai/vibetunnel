import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAuthConfigCache, createLogger, setDebugMode } from './logger.js';

// Mock the auth client module
vi.mock('../services/auth-client.js', () => ({
  authClient: {
    getAuthHeader: vi.fn(),
  },
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe.sequential('Frontend Logger', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    mockFetch.mockReset();

    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    // Reset debug mode
    setDebugMode(false);

    // Clear auth config cache
    clearAuthConfigCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Console Logging', () => {
    it('should log to console with module prefix', () => {
      const logger = createLogger('test-module');

      logger.log('test message');
      expect(consoleLogSpy).toHaveBeenCalledWith('[test-module]', 'test message');

      logger.warn('warning message');
      expect(consoleWarnSpy).toHaveBeenCalledWith('[test-module]', 'warning message');

      logger.error('error message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[test-module]', 'error message');
    });

    it('should not log debug messages when debug mode is disabled', () => {
      const logger = createLogger('test-module');

      logger.debug('debug message');
      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });

    it('should log debug messages when debug mode is enabled', () => {
      setDebugMode(true);
      const logger = createLogger('test-module');

      logger.debug('debug message');
      expect(consoleDebugSpy).toHaveBeenCalledWith('[test-module]', 'debug message');
    });

    it('should handle multiple arguments', () => {
      const logger = createLogger('test-module');

      logger.log('message', { data: 'test' }, 123);
      expect(consoleLogSpy).toHaveBeenCalledWith('[test-module]', 'message', { data: 'test' }, 123);
    });
  });

  describe('Server Logging - Authenticated Mode', () => {
    beforeEach(async () => {
      const { authClient } = await import('../services/auth-client.js');
      vi.mocked(authClient.getAuthHeader).mockReturnValue({
        Authorization: 'Bearer test-token',
      });
    });

    it('should send logs to server when authenticated', async () => {
      mockFetch.mockResolvedValueOnce(new Response());

      const logger = createLogger('test-module');
      logger.log('test message');

      // Wait for async operations
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());

      expect(mockFetch).toHaveBeenCalledWith('/api/logs/client', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({
          level: 'log',
          module: 'test-module',
          args: ['test message'],
        }),
      });
    });

    it('should format objects as JSON strings', async () => {
      mockFetch.mockResolvedValueOnce(new Response());

      const logger = createLogger('test-module');
      const testObj = { key: 'value', nested: { data: 123 } };
      logger.log('message', testObj);

      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());

      // Find the specific log call we're looking for
      const logCall = mockFetch.mock.calls.find(
        (call) => call[0] === '/api/logs/client' && call[1].body.includes('"message"')
      );

      expect(logCall).toBeDefined();
      if (!logCall) throw new Error('Expected logCall to be defined');
      const body = JSON.parse(logCall[1].body);
      expect(body.args).toEqual(['message', JSON.stringify(testObj, null, 2)]);
    });

    it('should handle all log levels', async () => {
      mockFetch.mockResolvedValue(new Response());

      const logger = createLogger('test-module');

      // Clear any existing calls to ensure clean state
      mockFetch.mockClear();

      // Record the initial number of log calls
      const initialLogCalls = mockFetch.mock.calls.filter(
        (call) => call[0] === '/api/logs/client'
      ).length;

      logger.log('log message');
      await new Promise((resolve) => setTimeout(resolve, 50));

      logger.warn('warn message');
      await new Promise((resolve) => setTimeout(resolve, 50));

      logger.error('error message');
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Get all log calls after our test
      const allLogCalls = mockFetch.mock.calls.filter((call) => call[0] === '/api/logs/client');
      // Get only the calls made by this test
      const testLogCalls = allLogCalls.slice(initialLogCalls);

      expect(testLogCalls).toHaveLength(3);
      expect(JSON.parse(testLogCalls[0][1].body).level).toBe('log');
      expect(JSON.parse(testLogCalls[1][1].body).level).toBe('warn');
      expect(JSON.parse(testLogCalls[2][1].body).level).toBe('error');
    });
  });

  describe('Server Logging - No-Auth Mode', () => {
    beforeEach(async () => {
      const { authClient } = await import('../services/auth-client.js');
      vi.mocked(authClient.getAuthHeader).mockReturnValue({});

      // Mock auth config endpoint to return no-auth mode
      mockFetch.mockImplementation((url) => {
        if (url === '/api/auth/config') {
          return Promise.resolve(
            new Response(JSON.stringify({ noAuth: true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }
        return Promise.resolve(new Response());
      });
    });

    it('should send logs to server in no-auth mode without auth header', async () => {
      const logger = createLogger('test-module');
      logger.log('test message in no-auth');

      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2)); // auth config + log

      // Check auth config was fetched
      expect(mockFetch).toHaveBeenCalledWith('/api/auth/config');

      // Check log was sent without auth header
      const logCall = mockFetch.mock.calls.find((call) => call[0] === '/api/logs/client');
      expect(logCall).toBeDefined();
      expect(logCall?.[1].headers).toEqual({
        'Content-Type': 'application/json',
      });
      expect(JSON.parse(logCall?.[1].body)).toEqual({
        level: 'log',
        module: 'test-module',
        args: ['test message in no-auth'],
      });
    });

    it('should cache auth config to reduce redundant requests', async () => {
      const logger = createLogger('test-module');

      logger.log('message 1');
      await new Promise((resolve) => setTimeout(resolve, 50));

      logger.log('message 2');
      await new Promise((resolve) => setTimeout(resolve, 50));

      logger.log('message 3');
      await new Promise((resolve) => setTimeout(resolve, 50));

      // The logger should only check auth config once due to caching
      const authConfigCalls = mockFetch.mock.calls.filter((call) => call[0] === '/api/auth/config');
      expect(authConfigCalls).toHaveLength(1);

      // Should have sent all 3 log messages
      const logCalls = mockFetch.mock.calls.filter((call) => call[0] === '/api/logs/client');
      expect(logCalls).toHaveLength(3);
    });

    it('should refetch auth config after cache expires', async () => {
      const logger = createLogger('test-module');

      // First log - should fetch auth config
      logger.log('message 1');
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Clear cache to simulate expiration
      clearAuthConfigCache();

      // Second log - should fetch auth config again
      logger.log('message 2');
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have fetched auth config twice
      const authConfigCalls = mockFetch.mock.calls.filter((call) => call[0] === '/api/auth/config');
      expect(authConfigCalls).toHaveLength(2);
    });
  });

  describe('Server Logging - Not Authenticated', () => {
    beforeEach(async () => {
      const { authClient } = await import('../services/auth-client.js');
      vi.mocked(authClient.getAuthHeader).mockReturnValue({});

      // Mock auth config endpoint to return auth required
      mockFetch.mockImplementation((url) => {
        if (url === '/api/auth/config') {
          return Promise.resolve(
            new Response(JSON.stringify({ noAuth: false }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }
        return Promise.resolve(new Response());
      });
    });

    it('should not send logs when not authenticated and auth is required', async () => {
      const logger = createLogger('test-module');
      logger.log('test message');

      // Wait a bit to ensure async operations complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should only call auth config, not the log endpoint
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith('/api/auth/config');

      const logCalls = mockFetch.mock.calls.filter((call) => call[0] === '/api/logs/client');
      expect(logCalls).toHaveLength(0);
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      const { authClient } = await import('../services/auth-client.js');
      vi.mocked(authClient.getAuthHeader).mockReturnValue({
        Authorization: 'Bearer test-token',
      });
    });

    it('should silently ignore network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const logger = createLogger('test-module');

      // Should not throw
      expect(() => logger.log('test message')).not.toThrow();

      // Console log should still work
      expect(consoleLogSpy).toHaveBeenCalledWith('[test-module]', 'test message');
    });

    it('should handle auth config fetch errors gracefully', async () => {
      const { authClient } = await import('../services/auth-client.js');
      vi.mocked(authClient.getAuthHeader).mockReturnValue({});

      // Make auth config fetch fail
      mockFetch.mockRejectedValueOnce(new Error('Config fetch failed'));

      const logger = createLogger('test-module');

      // Should not throw
      expect(() => logger.log('test message')).not.toThrow();

      // Console log should still work
      expect(consoleLogSpy).toHaveBeenCalledWith('[test-module]', 'test message');
    });

    it('should handle circular objects gracefully', async () => {
      mockFetch.mockResolvedValueOnce(new Response());

      const logger = createLogger('test-module');

      // Create circular reference
      const circular: Record<string, unknown> = { a: 1 };
      circular.self = circular;

      logger.log('circular', circular);

      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const body = JSON.parse(lastCall[1].body);
      // Should convert to string when JSON.stringify fails
      expect(body.args[1]).toBe('[object Object]');
    });

    it('should handle non-200 responses from auth config', async () => {
      const { authClient } = await import('../services/auth-client.js');
      vi.mocked(authClient.getAuthHeader).mockReturnValue({});

      // Mock auth config endpoint to return error
      mockFetch.mockResolvedValueOnce(
        new Response('Unauthorized', {
          status: 401,
          headers: { 'Content-Type': 'text/plain' },
        })
      );

      const logger = createLogger('test-module');
      logger.log('test message');

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should not send log when auth config fails
      const logCalls = mockFetch.mock.calls.filter((call) => call[0] === '/api/logs/client');
      expect(logCalls).toHaveLength(0);
    });
  });

  describe('Debug Mode', () => {
    beforeEach(async () => {
      const { authClient } = await import('../services/auth-client.js');
      vi.mocked(authClient.getAuthHeader).mockReturnValue({
        Authorization: 'Bearer test-token',
      });
      mockFetch.mockResolvedValue(new Response());
    });

    it('should not send debug logs to server when debug mode is disabled', async () => {
      setDebugMode(false);
      const logger = createLogger('test-module');

      logger.debug('debug message');

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should not call fetch
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should send debug logs to server when debug mode is enabled', async () => {
      setDebugMode(true);
      const logger = createLogger('test-module');

      logger.debug('debug message');

      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const body = JSON.parse(lastCall[1].body);
      expect(body.level).toBe('debug');
      expect(body.args).toEqual(['debug message']);
    });
  });
});
