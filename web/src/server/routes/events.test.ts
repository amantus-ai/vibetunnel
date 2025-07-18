import type { Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import type { PtyManager } from '../pty/index.js';
import { createEventsRouter } from './events.js';

// Mock dependencies
vi.mock('../utils/logger', () => ({
  createLogger: vi.fn(() => ({
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('Events Router', () => {
  let mockPtyManager: PtyManager & EventEmitter;
  let mockRequest: any;
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
      const routes = (eventsRouter as any).stack;
      const notificationRoute = routes.find(
        (r: any) => r.route && r.route.path === '/events/notifications' && r.route.methods.get
      );
      expect(notificationRoute).toBeTruthy();

      // Call the handler
      const handler = notificationRoute.route.stack[0].handle;
      await handler(mockRequest, mockResponse);

      // Verify SSE headers
      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
    });

    it('should send initial connection message', async () => {
      const routes = (eventsRouter as any).stack;
      const notificationRoute = routes.find(
        (r: any) => r.route && r.route.path === '/events/notifications' && r.route.methods.get
      );

      const handler = notificationRoute.route.stack[0].handle;
      await handler(mockRequest, mockResponse);

      // Verify initial message
      expect(mockResponse.write).toHaveBeenCalledWith(':ok\n\n');
    });

    it('should forward sessionExit events as SSE', async () => {
      const routes = (eventsRouter as any).stack;
      const notificationRoute = routes.find(
        (r: any) => r.route && r.route.path === '/events/notifications' && r.route.methods.get
      );

      const handler = notificationRoute.route.stack[0].handle;
      await handler(mockRequest, mockResponse);

      // Emit a sessionExit event
      const eventData = {
        sessionId: 'test-123',
        sessionName: 'Test Session',
        exitCode: 0,
      };
      mockPtyManager.emit('sessionExited', eventData.sessionId);

      // Verify SSE was sent
      expect(mockResponse.write).toHaveBeenCalledWith(
        expect.stringContaining('event: sessionExit\n')
      );
      expect(mockResponse.write).toHaveBeenCalledWith(
        expect.stringContaining(`data: ${JSON.stringify(eventData)}\n\n`)
      );
    });

    it('should forward commandFinished events as SSE', async () => {
      const routes = (eventsRouter as any).stack;
      const notificationRoute = routes.find(
        (r: any) => r.route && r.route.path === '/events/notifications' && r.route.methods.get
      );

      const handler = notificationRoute.route.stack[0].handle;
      await handler(mockRequest, mockResponse);

      // Emit a commandFinished event
      const eventData = {
        sessionId: 'test-123',
        sessionName: 'Test Session',
        command: 'npm test',
        exitCode: 0,
        duration: 5432,
        timestamp: new Date().toISOString(),
      };
      mockPtyManager.emit('commandFinished', eventData);

      // Verify SSE was sent
      expect(mockResponse.write).toHaveBeenCalledWith(
        expect.stringContaining('event: commandFinished\n')
      );
      expect(mockResponse.write).toHaveBeenCalledWith(
        expect.stringContaining(`data: ${JSON.stringify(eventData)}\n\n`)
      );
    });

    it('should forward bell events as SSE', async () => {
      const routes = (eventsRouter as any).stack;
      const notificationRoute = routes.find(
        (r: any) => r.route && r.route.path === '/events/notifications' && r.route.methods.get
      );

      const handler = notificationRoute.route.stack[0].handle;
      await handler(mockRequest, mockResponse);

      // Emit a bell event
      const eventData = {
        sessionId: 'test-123',
        sessionName: 'Test Session',
        timestamp: new Date().toISOString(),
      };
      mockPtyManager.emit('bell', eventData);

      // Verify SSE was sent
      expect(mockResponse.write).toHaveBeenCalledWith(
        expect.stringContaining('event: bell\n')
      );
      expect(mockResponse.write).toHaveBeenCalledWith(
        expect.stringContaining(`data: ${JSON.stringify(eventData)}\n\n`)
      );
    });

    it('should handle multiple events', async () => {
      const routes = (eventsRouter as any).stack;
      const notificationRoute = routes.find(
        (r: any) => r.route && r.route.path === '/events/notifications' && r.route.methods.get
      );

      const handler = notificationRoute.route.stack[0].handle;
      await handler(mockRequest, mockResponse);

      // Clear initial write
      vi.clearAllMocks();

      // Emit multiple events
      mockPtyManager.emit('sessionExited', 'session-1');
      mockPtyManager.emit('commandFinished', { sessionId: 'session-2', command: 'ls' });
      mockPtyManager.emit('bell', { sessionId: 'session-3' });

      // Should have written 3 events
      const writeCalls = (mockResponse.write as ReturnType<typeof vi.fn>).mock.calls;
      const eventCalls = writeCalls.filter(call => 
        call[0].includes('event:')
      );
      expect(eventCalls).toHaveLength(3);
    });

    it('should send heartbeat to keep connection alive', async () => {
      vi.useFakeTimers();

      const routes = (eventsRouter as any).stack;
      const notificationRoute = routes.find(
        (r: any) => r.route && r.route.path === '/events/notifications' && r.route.methods.get
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
      const routes = (eventsRouter as any).stack;
      const notificationRoute = routes.find(
        (r: any) => r.route && r.route.path === '/events/notifications' && r.route.methods.get
      );

      const handler = notificationRoute.route.stack[0].handle;
      await handler(mockRequest, mockResponse);

      // Get the close handler
      const closeHandler = mockRequest.on.mock.calls.find(
        (call: any) => call[0] === 'close'
      )?.[1];
      expect(closeHandler).toBeTruthy();

      // Verify listeners are attached
      expect(mockPtyManager.listenerCount('sessionExited')).toBeGreaterThan(0);
      expect(mockPtyManager.listenerCount('commandFinished')).toBeGreaterThan(0);
      expect(mockPtyManager.listenerCount('bell')).toBeGreaterThan(0);

      // Simulate client disconnect
      closeHandler();

      // Verify listeners are removed
      expect(mockPtyManager.listenerCount('sessionExited')).toBe(0);
      expect(mockPtyManager.listenerCount('commandFinished')).toBe(0);
      expect(mockPtyManager.listenerCount('bell')).toBe(0);
    });

    it('should handle response errors gracefully', async () => {
      // Mock a response that throws on write
      mockResponse.write = vi.fn().mockImplementation(() => {
        throw new Error('Connection lost');
      });

      const routes = (eventsRouter as any).stack;
      const notificationRoute = routes.find(
        (r: any) => r.route && r.route.path === '/events/notifications' && r.route.methods.get
      );

      const handler = notificationRoute.route.stack[0].handle;
      await handler(mockRequest, mockResponse);

      // Should not throw even if write fails
      expect(() => {
        mockPtyManager.emit('bell', { sessionId: 'test' });
      }).not.toThrow();
    });

    it('should include event ID for proper SSE format', async () => {
      const routes = (eventsRouter as any).stack;
      const notificationRoute = routes.find(
        (r: any) => r.route && r.route.path === '/events/notifications' && r.route.methods.get
      );

      const handler = notificationRoute.route.stack[0].handle;
      await handler(mockRequest, mockResponse);

      // Clear initial write
      vi.clearAllMocks();

      // Emit an event
      mockPtyManager.emit('bell', { sessionId: 'test-123' });

      // Verify SSE format includes id
      const writeCalls = (mockResponse.write as ReturnType<typeof vi.fn>).mock.calls;
      const sseData = writeCalls.map(call => call[0]).join('');
      
      expect(sseData).toMatch(/id: \d+\n/);
      expect(sseData).toMatch(/event: bell\n/);
      expect(sseData).toMatch(/data: {.*}\n\n/);
    });

    it('should handle malformed event data', async () => {
      const routes = (eventsRouter as any).stack;
      const notificationRoute = routes.find(
        (r: any) => r.route && r.route.path === '/events/notifications' && r.route.methods.get
      );

      const handler = notificationRoute.route.stack[0].handle;
      await handler(mockRequest, mockResponse);

      // Clear initial write
      vi.clearAllMocks();

      // Emit event with circular reference (would fail JSON.stringify)
      const circularData: any = { sessionId: 'test' };
      circularData.self = circularData;

      // Should not throw
      expect(() => {
        mockPtyManager.emit('bell', circularData);
      }).not.toThrow();

      // Should have attempted to write something
      expect(mockResponse.write).toHaveBeenCalled();
    });
  });

  describe('Multiple clients', () => {
    it('should handle multiple concurrent SSE connections', async () => {
      const routes = (eventsRouter as any).stack;
      const notificationRoute = routes.find(
        (r: any) => r.route && r.route.path === '/events/notifications' && r.route.methods.get
      );
      const handler = notificationRoute.route.stack[0].handle;

      // Create multiple mock clients
      const client1Response = {
        writeHead: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      } as unknown as Response;

      const client2Response = {
        writeHead: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      } as unknown as Response;

      // Connect both clients
      await handler(mockRequest, client1Response);
      await handler(mockRequest, client2Response);

      // Clear initial writes
      vi.clearAllMocks();

      // Emit an event
      mockPtyManager.emit('bell', { sessionId: 'test-123' });

      // Both clients should receive the event
      expect(client1Response.write).toHaveBeenCalledWith(
        expect.stringContaining('event: bell')
      );
      expect(client2Response.write).toHaveBeenCalledWith(
        expect.stringContaining('event: bell')
      );
    });
  });
});