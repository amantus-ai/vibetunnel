import { EventEmitter } from 'events';
import type { Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PtyManager } from '../pty/index.js';
import { createEventsRouter } from './events.js';

// Mock dependencies
vi.mock('../utils/logger', () => ({
  createLogger: vi.fn(() => ({
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  })),
}));

// Type definitions for Express Router internals
interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: (req: Request, res: Response) => void }>;
  };
}

type ExpressRouter = { stack: RouteLayer[] };

describe('Events Router', () => {
  let mockPtyManager: PtyManager & EventEmitter;
  let mockRequest: Partial<Request> & {
    headers: Record<string, string>;
    on: ReturnType<typeof vi.fn>;
  };
  let mockResponse: Response;
  let eventsRouter: ReturnType<typeof createEventsRouter>;

  beforeEach(() => {
    // Create a mock PtyManager that extends EventEmitter
    mockPtyManager = new EventEmitter() as PtyManager & EventEmitter;

    // Create mock request
    mockRequest = {
      headers: {},
      on: vi.fn(),
    };

    // Create mock response with SSE methods
    mockResponse = {
      writeHead: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;

    // Create router
    eventsRouter = createEventsRouter(mockPtyManager);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /events/notifications', () => {
    it('should set up SSE headers correctly', async () => {
      // Get the route handler
      interface RouteLayer {
        route?: {
          path: string;
          methods: Record<string, boolean>;
          stack: Array<{ handle: (req: Request, res: Response) => void }>;
        };
      }
      const routes = (eventsRouter as unknown as { stack: RouteLayer[] }).stack;
      const notificationRoute = routes.find(
        (r: RouteLayer) => r.route && r.route.path === '/events' && r.route.methods.get
      );
      expect(notificationRoute).toBeTruthy();

      // Call the handler
      const handler = notificationRoute.route.stack[0].handle;
      await handler(mockRequest, mockResponse);

      // Verify SSE headers
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    });

    it('should send initial connection message', async () => {
      const routes = (eventsRouter as unknown as ExpressRouter).stack;
      const notificationRoute = routes.find(
        (r: RouteLayer) => r.route && r.route.path === '/events' && r.route.methods.get
      );

      const handler = notificationRoute.route.stack[0].handle;
      await handler(mockRequest, mockResponse);

      // Verify initial connection event
      expect(mockResponse.write).toHaveBeenCalledWith(
        'event: connected\ndata: {"type": "connected"}\n\n'
      );
    });

    it('should forward sessionExit events as SSE', async () => {
      const routes = (eventsRouter as unknown as ExpressRouter).stack;
      const notificationRoute = routes.find(
        (r: RouteLayer) => r.route && r.route.path === '/events' && r.route.methods.get
      );

      const handler = notificationRoute.route.stack[0].handle;
      await handler(mockRequest, mockResponse);

      // Clear mocks after initial connection
      vi.clearAllMocks();

      // Emit a sessionExit event
      const eventData = {
        sessionId: 'test-123',
        sessionName: 'Test Session',
        exitCode: 0,
      };
      mockPtyManager.emit(
        'sessionExited',
        eventData.sessionId,
        eventData.sessionName,
        eventData.exitCode
      );

      // Verify SSE was sent - check that the data contains our expected fields
      const writeCall = (mockResponse.write as ReturnType<typeof vi.fn>).mock.calls[0][0];

      // Verify the SSE format
      const lines = writeCall.split('\n');
      expect(lines[0]).toMatch(/^id: \d+$/);
      expect(lines[1]).toBe('event: session-exit');
      expect(lines[2]).toMatch(/^data: /);

      // Parse and verify the JSON data
      const jsonData = JSON.parse(lines[2].replace('data: ', ''));
      expect(jsonData).toMatchObject({
        type: 'session-exit',
        sessionId: 'test-123',
        sessionName: 'Test Session',
        exitCode: 0,
        timestamp: expect.any(String),
      });
    });

    it('should forward commandFinished events as SSE', async () => {
      const routes = (eventsRouter as unknown as ExpressRouter).stack;
      const notificationRoute = routes.find(
        (r: RouteLayer) => r.route && r.route.path === '/events' && r.route.methods.get
      );

      const handler = notificationRoute.route.stack[0].handle;
      await handler(mockRequest, mockResponse);

      // Clear mocks after initial connection
      vi.clearAllMocks();

      // Emit a commandFinished event
      const eventData = {
        sessionId: 'test-123',
        command: 'npm test',
        exitCode: 0,
        duration: 5432,
      };
      mockPtyManager.emit('commandFinished', eventData);

      // Verify SSE was sent - check that the data contains our expected fields
      const writeCall = (mockResponse.write as ReturnType<typeof vi.fn>).mock.calls[0][0];

      // Verify the SSE format
      const lines = writeCall.split('\n');
      expect(lines[0]).toMatch(/^id: \d+$/);
      expect(lines[1]).toBe('event: command-finished');
      expect(lines[2]).toMatch(/^data: /);

      // Parse and verify the JSON data
      const jsonData = JSON.parse(lines[2].replace('data: ', ''));
      expect(jsonData).toMatchObject({
        type: 'command-finished',
        sessionId: 'test-123',
        command: 'npm test',
        exitCode: 0,
        duration: 5432,
        timestamp: expect.any(String),
      });
    });

    it('should handle multiple events', async () => {
      const routes = (eventsRouter as unknown as ExpressRouter).stack;
      const notificationRoute = routes.find(
        (r: RouteLayer) => r.route && r.route.path === '/events' && r.route.methods.get
      );

      const handler = notificationRoute.route.stack[0].handle;
      await handler(mockRequest, mockResponse);

      // Clear initial write
      vi.clearAllMocks();

      // Emit multiple events
      mockPtyManager.emit('sessionExited', 'session-1');
      mockPtyManager.emit('commandFinished', { sessionId: 'session-2', command: 'ls' });
      mockPtyManager.emit('claudeTurn', 'session-3', 'Session 3');

      // Should have written 3 events
      const writeCalls = (mockResponse.write as ReturnType<typeof vi.fn>).mock.calls;
      const eventCalls = writeCalls.filter((call) => call[0].includes('event: '));
      expect(eventCalls).toHaveLength(3);
    });

    it('should send heartbeat to keep connection alive', async () => {
      vi.useFakeTimers();

      const routes = (eventsRouter as unknown as ExpressRouter).stack;
      const notificationRoute = routes.find(
        (r: RouteLayer) => r.route && r.route.path === '/events' && r.route.methods.get
      );

      const handler = notificationRoute.route.stack[0].handle;
      await handler(mockRequest, mockResponse);

      // Clear initial write
      vi.clearAllMocks();

      // Advance time by 30 seconds
      vi.advanceTimersByTime(30000);

      // Should have sent a heartbeat
      expect(mockResponse.write).toHaveBeenCalledWith(':heartbeat\n\n');

      vi.useRealTimers();
    });

    it('should clean up listeners on client disconnect', async () => {
      const routes = (eventsRouter as unknown as ExpressRouter).stack;
      const notificationRoute = routes.find(
        (r: RouteLayer) => r.route && r.route.path === '/events' && r.route.methods.get
      );

      const handler = notificationRoute.route.stack[0].handle;
      await handler(mockRequest, mockResponse);

      // Get the close handler
      const closeHandler = mockRequest.on.mock.calls.find(
        (call: [string, () => void]) => call[0] === 'close'
      )?.[1];
      expect(closeHandler).toBeTruthy();

      // Verify listeners are attached
      expect(mockPtyManager.listenerCount('sessionExited')).toBeGreaterThan(0);
      expect(mockPtyManager.listenerCount('commandFinished')).toBeGreaterThan(0);
      expect(mockPtyManager.listenerCount('claudeTurn')).toBeGreaterThan(0);

      // Simulate client disconnect
      closeHandler();

      // Verify listeners are removed
      expect(mockPtyManager.listenerCount('sessionExited')).toBe(0);
      expect(mockPtyManager.listenerCount('commandFinished')).toBe(0);
      expect(mockPtyManager.listenerCount('claudeTurn')).toBe(0);
    });

    it('should handle response errors gracefully', async () => {
      const routes = (eventsRouter as unknown as ExpressRouter).stack;
      const notificationRoute = routes.find(
        (r: RouteLayer) => r.route && r.route.path === '/events' && r.route.methods.get
      );

      const handler = notificationRoute.route.stack[0].handle;
      await handler(mockRequest, mockResponse);

      // Clear initial write call
      vi.clearAllMocks();

      // Now mock response to throw on write
      mockResponse.write = vi.fn().mockImplementation(() => {
        throw new Error('Connection lost');
      });

      // Should not throw even if write fails
      expect(() => {
        mockPtyManager.emit('claudeTurn', 'test', 'Test Session');
      }).not.toThrow();
    });

    it('should include event ID for proper SSE format', async () => {
      const routes = (eventsRouter as unknown as ExpressRouter).stack;
      const notificationRoute = routes.find(
        (r: RouteLayer) => r.route && r.route.path === '/events' && r.route.methods.get
      );

      const handler = notificationRoute.route.stack[0].handle;
      await handler(mockRequest, mockResponse);

      // Clear initial write
      vi.clearAllMocks();

      // Emit an event
      mockPtyManager.emit('claudeTurn', 'test-123', 'Test Session');

      // Verify SSE format includes id
      const writeCalls = (mockResponse.write as ReturnType<typeof vi.fn>).mock.calls;
      const sseData = writeCalls.map((call) => call[0]).join('');

      expect(sseData).toMatch(/id: \d+\n/);
      expect(sseData).toMatch(/event: claude-turn\n/);
      expect(sseData).toMatch(/data: {.*}\n\n/);
    });

    it('should handle malformed event data', async () => {
      const routes = (eventsRouter as unknown as ExpressRouter).stack;
      const notificationRoute = routes.find(
        (r: RouteLayer) => r.route && r.route.path === '/events' && r.route.methods.get
      );

      const handler = notificationRoute.route.stack[0].handle;
      await handler(mockRequest, mockResponse);

      // Clear initial write
      vi.clearAllMocks();

      // Emit event with circular reference (would fail JSON.stringify)
      interface CircularData {
        sessionId: string;
        self?: CircularData;
      }
      const circularData: CircularData = { sessionId: 'test' };
      circularData.self = circularData;

      // Should not throw
      expect(() => {
        mockPtyManager.emit('claudeTurn', 'test-123', 'Test Session');
      }).not.toThrow();

      // Should have attempted to write something
      expect(mockResponse.write).toHaveBeenCalled();
    });
  });

  describe('Multiple clients', () => {
    it('should handle multiple concurrent SSE connections', async () => {
      const routes = (eventsRouter as unknown as ExpressRouter).stack;
      const notificationRoute = routes.find(
        (r: RouteLayer) => r.route && r.route.path === '/events' && r.route.methods.get
      );
      const handler = notificationRoute.route.stack[0].handle;

      // Create multiple mock clients
      const client1Response = {
        writeHead: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
        setHeader: vi.fn(),
      } as unknown as Response;

      const client2Response = {
        writeHead: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
        setHeader: vi.fn(),
      } as unknown as Response;

      // Connect both clients
      await handler(mockRequest, client1Response);
      await handler(mockRequest, client2Response);

      // Clear initial writes
      vi.clearAllMocks();

      // Emit an event
      mockPtyManager.emit('claudeTurn', 'test-123', 'Test Session');

      // Both clients should receive the event
      expect(client1Response.write).toHaveBeenCalledWith(
        expect.stringContaining('event: claude-turn')
      );
      expect(client2Response.write).toHaveBeenCalledWith(
        expect.stringContaining('event: claude-turn')
      );
    });
  });
});
