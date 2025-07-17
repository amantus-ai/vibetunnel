import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { controlUnixHandler } from '../websocket/control-unix-handler';
import { createSessionRoutes } from './sessions';

// Mock dependencies
vi.mock('../websocket/control-unix-handler', () => ({
  controlUnixHandler: {
    isMacAppConnected: vi.fn(),
  },
}));

vi.mock('../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe('sessions routes', () => {
  let mockPtyManager: {
    getSessions: ReturnType<typeof vi.fn>;
  };
  let mockTerminalManager: {
    getTerminal: ReturnType<typeof vi.fn>;
  };
  let mockStreamWatcher: {
    addListener: ReturnType<typeof vi.fn>;
    removeListener: ReturnType<typeof vi.fn>;
  };
  let mockActivityMonitor: {
    getSessionActivity: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Create minimal mocks for required services
    mockPtyManager = {
      getSessions: vi.fn(() => []),
    };

    mockTerminalManager = {
      getTerminal: vi.fn(),
    };

    mockStreamWatcher = {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    };

    mockActivityMonitor = {
      getSessionActivity: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /server/status', () => {
    it('should return server status with Mac app connection state', async () => {
      // Mock Mac app as connected
      vi.mocked(controlUnixHandler.isMacAppConnected).mockReturnValue(true);

      const router = createSessionRoutes({
        ptyManager: mockPtyManager,
        terminalManager: mockTerminalManager,
        streamWatcher: mockStreamWatcher,
        remoteRegistry: null,
        isHQMode: false,
        activityMonitor: mockActivityMonitor,
      });

      // Find the /server/status route handler
      const routes = (
        router as unknown as {
          stack: Array<{
            route?: {
              path: string;
              methods: { get?: boolean };
              stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }>;
            };
          }>;
        }
      ).stack;
      const statusRoute = routes.find(
        (r) => r.route && r.route.path === '/server/status' && r.route.methods.get
      );

      expect(statusRoute).toBeTruthy();

      // Create mock request and response
      const mockReq = {} as Request;
      const mockRes = {
        json: vi.fn(),
        status: vi.fn().mockReturnThis(),
      } as unknown as Response;

      // Call the route handler
      await statusRoute.route.stack[0].handle(mockReq, mockRes);

      // Verify response
      expect(mockRes.json).toHaveBeenCalledWith({
        macAppConnected: true,
        isHQMode: false,
        version: 'unknown', // Since VERSION env var is not set in tests
      });
    });

    it('should return Mac app disconnected when not connected', async () => {
      // Mock Mac app as disconnected
      vi.mocked(controlUnixHandler.isMacAppConnected).mockReturnValue(false);

      const router = createSessionRoutes({
        ptyManager: mockPtyManager,
        terminalManager: mockTerminalManager,
        streamWatcher: mockStreamWatcher,
        remoteRegistry: null,
        isHQMode: true,
        activityMonitor: mockActivityMonitor,
      });

      // Find the /server/status route handler
      const routes = (
        router as unknown as {
          stack: Array<{
            route?: {
              path: string;
              methods: { get?: boolean };
              stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }>;
            };
          }>;
        }
      ).stack;
      const statusRoute = routes.find(
        (r) => r.route && r.route.path === '/server/status' && r.route.methods.get
      );

      const mockReq = {} as Request;
      const mockRes = {
        json: vi.fn(),
        status: vi.fn().mockReturnThis(),
      } as unknown as Response;

      await statusRoute.route.stack[0].handle(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        macAppConnected: false,
        isHQMode: true,
        version: 'unknown',
      });
    });

    it('should handle errors gracefully', async () => {
      // Mock an error in isMacAppConnected
      vi.mocked(controlUnixHandler.isMacAppConnected).mockImplementation(() => {
        throw new Error('Connection check failed');
      });

      const router = createSessionRoutes({
        ptyManager: mockPtyManager,
        terminalManager: mockTerminalManager,
        streamWatcher: mockStreamWatcher,
        remoteRegistry: null,
        isHQMode: false,
        activityMonitor: mockActivityMonitor,
      });

      const routes = (
        router as unknown as {
          stack: Array<{
            route?: {
              path: string;
              methods: { get?: boolean };
              stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }>;
            };
          }>;
        }
      ).stack;
      const statusRoute = routes.find(
        (r) => r.route && r.route.path === '/server/status' && r.route.methods.get
      );

      const mockReq = {} as Request;
      const mockRes = {
        json: vi.fn(),
        status: vi.fn().mockReturnThis(),
      } as unknown as Response;

      await statusRoute.route.stack[0].handle(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to get server status',
      });
    });
  });
});
