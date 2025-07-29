import { EventEmitter } from 'events';
import type { Request, Response } from 'express';
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

describe('Claude Turn Events', () => {
  let mockSessionMonitor: SessionMonitor & EventEmitter;
  let mockRequest: Partial<Request> & {
    headers: Record<string, string>;
    on: ReturnType<typeof vi.fn>;
  };
  let mockResponse: Response;
  let eventsRouter: ReturnType<typeof createEventsRouter>;
  let eventHandler: (req: Request, res: Response) => void;

  beforeEach(() => {
    // Create a mock SessionMonitor that extends EventEmitter
    mockSessionMonitor = new EventEmitter() as SessionMonitor & EventEmitter;

    // Create mock request
    mockRequest = {
      headers: {},
      on: vi.fn(),
    };

    // Create mock response with SSE methods
    mockResponse = {
      setHeader: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    } as unknown as Response;

    // Create router
    eventsRouter = createEventsRouter(mockSessionMonitor);

    // Get the /events handler
    interface RouteLayer {
      route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: (req: Request, res: Response) => void }>;
      };
    }
    const routes = (eventsRouter as unknown as { stack: RouteLayer[] }).stack;
    const eventsRoute = routes.find(
      (r: RouteLayer) => r.route && r.route.path === '/events' && r.route.methods.get
    );
    eventHandler = eventsRoute?.route.stack[0].handle;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Claude Turn Event Handling', () => {
    it('should emit claude-turn event through SSE', async () => {
      // Connect client
      await eventHandler(mockRequest, mockResponse);

      // Clear initial connection event
      vi.clearAllMocks();

      // Emit claude-turn event
      const sessionId = 'claude-session-123';
      const sessionName = 'Claude Code Session';
      mockSessionMonitor.emit('notification', {
        type: 'claude-turn',
        sessionId,
        sessionName,
        message: 'Claude has finished responding',
      });

      // Verify SSE was sent
      expect(mockResponse.write).toHaveBeenCalledWith(
        expect.stringContaining('"type":"claude-turn"')
      );
      expect(mockResponse.write).toHaveBeenCalledWith(
        expect.stringContaining(`"sessionId":"${sessionId}"`)
      );
      expect(mockResponse.write).toHaveBeenCalledWith(
        expect.stringContaining(`"sessionName":"${sessionName}"`)
      );
      expect(mockResponse.write).toHaveBeenCalledWith(
        expect.stringContaining('"message":"Claude has finished responding"')
      );
    });

    it('should handle multiple claude-turn events', async () => {
      await eventHandler(mockRequest, mockResponse);
      vi.clearAllMocks();

      // Emit multiple claude-turn events
      mockSessionMonitor.emit('notification', { type: 'claude-turn', sessionId: 'session-1' });
      mockSessionMonitor.emit('notification', { type: 'claude-turn', sessionId: 'session-2' });
      mockSessionMonitor.emit('notification', { type: 'claude-turn', sessionId: 'session-3' });

      // Should have written 3 events
      const writeCalls = (mockResponse.write as ReturnType<typeof vi.fn>).mock.calls;
      const claudeTurnEvents = writeCalls.filter((call) => call[0].includes('claude-turn'));
      expect(claudeTurnEvents).toHaveLength(3);
    });

    it('should include timestamp in claude-turn event', async () => {
      await eventHandler(mockRequest, mockResponse);
      vi.clearAllMocks();

      const beforeTime = new Date();
      mockSessionMonitor.emit('notification', {
        type: 'claude-turn',
        sessionId: 'test-session',
        timestamp: new Date().toISOString(),
      });
      const afterTime = new Date();

      // Get the event data
      const writeCall = (mockResponse.write as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const eventData = JSON.parse(writeCall.split('data: ')[1]);

      expect(eventData.timestamp).toBeDefined();
      expect(new Date(eventData.timestamp).toISOString()).toEqual(eventData.timestamp);
      expect(new Date(eventData.timestamp).getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(new Date(eventData.timestamp).getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });

    it('should unsubscribe from claude-turn events on disconnect', async () => {
      await eventHandler(mockRequest, mockResponse);

      // Get the close handler
      const closeHandler = mockRequest.on.mock.calls.find(
        (call: [string, () => void]) => call[0] === 'close'
      )?.[1];
      expect(closeHandler).toBeTruthy();

      // Verify claude-turn listener is attached
      expect(mockSessionMonitor.listenerCount('notification')).toBe(1);

      // Simulate client disconnect
      closeHandler();

      // Verify listener is removed
      expect(mockSessionMonitor.listenerCount('notification')).toBe(0);
    });

    it('should handle claude-turn alongside other events', async () => {
      await eventHandler(mockRequest, mockResponse);
      vi.clearAllMocks();

      // Emit various events including claude-turn
      mockSessionMonitor.emit('notification', { type: 'session-start', sessionId: 'session-1' });
      mockSessionMonitor.emit('notification', { type: 'claude-turn', sessionId: 'session-1' });
      mockSessionMonitor.emit('notification', {
        type: 'command-finished',
        sessionId: 'session-1',
      });
      mockSessionMonitor.emit('notification', { type: 'session-exit', sessionId: 'session-1' });

      // Verify all events were sent
      const writeCalls = (mockResponse.write as ReturnType<typeof vi.fn>).mock.calls;
      const eventTypes = writeCalls
        .map((call) => {
          const match = call[0].match(/"type":"([^"]+)"/);
          return match ? match[1] : null;
        })
        .filter(Boolean);

      expect(eventTypes).toEqual([
        'session-start',
        'claude-turn',
        'command-finished',
        'session-exit',
      ]);
    });

    it('should properly format SSE message for claude-turn', async () => {
      await eventHandler(mockRequest, mockResponse);
      vi.clearAllMocks();

      mockSessionMonitor.emit('notification', {
        type: 'claude-turn',
        sessionId: 'session-123',
        sessionName: 'My Claude Session',
        message: 'Claude has finished responding',
        timestamp: new Date().toISOString(),
      });

      const writeCall = (mockResponse.write as ReturnType<typeof vi.fn>).mock.calls[0][0];

      // Verify proper SSE format with id, event, and data fields
      expect(writeCall).toMatch(/^id: \d+\nevent: claude-turn\ndata: .+\n\n$/);

      // Extract and verify JSON from the SSE message
      const matches = writeCall.match(/data: (.+)\n\n$/);
      expect(matches).toBeTruthy();
      const jsonStr = matches[1];
      const eventData = JSON.parse(jsonStr);

      expect(eventData).toMatchObject({
        type: 'claude-turn',
        sessionId: 'session-123',
        sessionName: 'My Claude Session',
        message: 'Claude has finished responding',
        timestamp: expect.any(String),
      });
    });
  });
});
