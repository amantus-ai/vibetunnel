import type { Request, Response, Router } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScreencapRoutes, initializeScreencap } from './screencap';

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
  })),
}));

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

// Mock http-proxy-middleware
vi.mock('http-proxy-middleware', () => ({
  createProxyMiddleware: vi.fn(() => vi.fn()),
}));

describe('screencap routes', () => {
  let originalPlatform: PropertyDescriptor | undefined;
  let mockFs: ReturnType<typeof vi.mocked<typeof import('fs')>>;
  let mockChildProcess: ReturnType<typeof vi.mocked<typeof import('child_process')>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Save original platform descriptor
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    // Initialize mocks
    mockFs = vi.mocked(await import('fs'));
    mockChildProcess = vi.mocked(await import('child_process'));
  });

  afterEach(() => {
    // Restore original platform
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  const setPlatform = (platform: string) => {
    Object.defineProperty(process, 'platform', {
      value: platform,
      configurable: true,
      enumerable: true,
      writable: false,
    });
  };

  describe('initializeScreencap', () => {
    it('should skip initialization on non-macOS platforms', async () => {
      setPlatform('linux');

      await initializeScreencap();

      expect(mockFs.existsSync).not.toHaveBeenCalled();
      expect(mockChildProcess.execSync).not.toHaveBeenCalled();
    });

    it('should initialize on macOS when binary exists', async () => {
      setPlatform('darwin');
      mockFs.existsSync.mockReturnValue(true);

      await initializeScreencap();

      expect(mockFs.existsSync).toHaveBeenCalled();
      expect(mockChildProcess.execSync).not.toHaveBeenCalled();
    });

    it('should build binary on macOS when not exists', async () => {
      setPlatform('darwin');
      mockFs.existsSync.mockReturnValue(false);

      await initializeScreencap();

      expect(mockFs.existsSync).toHaveBeenCalled();
      expect(mockChildProcess.execSync).toHaveBeenCalledWith(
        'make build',
        expect.objectContaining({
          cwd: expect.stringContaining('screencap'),
          stdio: 'inherit',
        })
      );
    });

    it('should throw error if build fails on macOS', async () => {
      setPlatform('darwin');
      mockFs.existsSync.mockReturnValue(false);
      mockChildProcess.execSync.mockImplementation(() => {
        throw new Error('Build failed');
      });

      await expect(initializeScreencap()).rejects.toThrow('Build failed');
    });
  });

  describe('createScreencapRoutes', () => {
    let router: Router;
    let routes: Array<{ path: string; method: string; handler: unknown }>;

    beforeEach(() => {
      setPlatform('darwin');
      router = createScreencapRoutes();

      // Extract routes from router
      routes = [];
      const stack = (
        router as unknown as {
          stack: Array<{
            route?: {
              path: string;
              methods: Record<string, boolean>;
              stack: Array<{ handle: unknown }>;
            };
          }>;
        }
      ).stack;
      for (const layer of stack) {
        if (layer.route) {
          const path = layer.route.path;
          const methods = Object.keys(layer.route.methods);
          for (const method of methods) {
            routes.push({
              path,
              method,
              handler: layer.route.stack[layer.route.stack.length - 1].handle,
            });
          }
        }
      }
    });

    it('should create routes with platform check middleware', () => {
      // Check that routes exist
      expect(routes).toContainEqual(
        expect.objectContaining({
          path: '/screencap',
          method: 'get',
        })
      );

      expect(routes).toContainEqual(
        expect.objectContaining({
          path: '/screencap/windows',
          method: 'get',
        })
      );

      expect(routes).toContainEqual(
        expect.objectContaining({
          path: '/screencap/capture',
          method: 'post',
        })
      );
    });

    it('should return error on non-macOS platforms', async () => {
      setPlatform('linux');
      const newRouter = createScreencapRoutes();

      // Mock request/response
      const mockReq = {} as Request;
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const mockNext = vi.fn();

      // Get the first middleware (requireMacOS) from the route
      const screencapRoute = (
        newRouter as unknown as {
          stack: Array<{ route?: { path: string; stack: Array<{ handle: unknown }> } }>;
        }
      ).stack.find((layer) => layer.route?.path === '/screencap');
      const middlewares = screencapRoute?.route?.stack || [];
      const requireMacOS = middlewares[0].handle;

      // Call the middleware
      requireMacOS(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(503);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Screencap is only available on macOS',
        platform: 'linux',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should pass through on macOS platform', async () => {
      setPlatform('darwin');
      const newRouter = createScreencapRoutes();

      // Mock request/response
      const mockReq = {} as Request;
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const mockNext = vi.fn();

      // Get the requireMacOS middleware
      const screencapRoute = (
        newRouter as unknown as {
          stack: Array<{ route?: { path: string; stack: Array<{ handle: unknown }> } }>;
        }
      ).stack.find((layer) => layer.route?.path === '/screencap');
      const middlewares = screencapRoute?.route?.stack || [];
      const requireMacOS = middlewares[0].handle;

      // Call the middleware
      requireMacOS(mockReq, mockRes, mockNext);

      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockRes.json).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should have all expected routes', () => {
      const expectedRoutes = [
        { path: '/screencap', method: 'get' },
        { path: '/screencap/windows', method: 'get' },
        { path: '/screencap/display', method: 'get' },
        { path: '/screencap/frame', method: 'get' },
        { path: '/screencap/capture', method: 'post' },
        { path: '/screencap/capture-window', method: 'post' },
        { path: '/screencap/stop', method: 'post' },
        { path: '/screencap/click', method: 'post' },
        { path: '/screencap/key', method: 'post' },
        { path: '/screencap/key-window', method: 'post' },
        { path: '/screencap-control/start', method: 'post' },
        { path: '/screencap-control/stop', method: 'post' },
        { path: '/screencap-control/status', method: 'get' },
      ];

      for (const expected of expectedRoutes) {
        expect(routes).toContainEqual(expect.objectContaining(expected));
      }
    });

    it('should serve HTML page for /screencap route', () => {
      setPlatform('darwin');
      const mockReq = {} as Request;
      const mockRes = {
        send: vi.fn(),
      } as unknown as Response;
      const mockNext = vi.fn();

      // Find the /screencap GET handler
      const route = routes.find((r) => r.path === '/screencap' && r.method === 'get');
      expect(route).toBeDefined();

      // Get the actual handler (after middleware)
      const screencapRoute = (
        router as unknown as {
          stack: Array<{ route?: { path: string; stack: Array<{ handle: unknown }> } }>;
        }
      ).stack.find((layer) => layer.route?.path === '/screencap');
      const handlers = screencapRoute.route.stack;
      const pageHandler = handlers[handlers.length - 1].handle;

      // Call the handler
      pageHandler(mockReq, mockRes, mockNext);

      expect(mockRes.send).toHaveBeenCalledWith(expect.stringContaining('<!DOCTYPE html>'));
      expect(mockRes.send).toHaveBeenCalledWith(expect.stringContaining('<screencap-view>'));
    });
  });

  describe('screencap process management', () => {
    it('should create proxy middleware for screencap routes', async () => {
      setPlatform('darwin');
      mockFs.existsSync.mockReturnValue(true);

      // Import the mocked createProxyMiddleware
      const httpProxyMiddleware = await import('http-proxy-middleware');
      const createProxyMiddleware = vi.mocked(httpProxyMiddleware.createProxyMiddleware);

      // Create routes
      const _router = createScreencapRoutes();

      // Verify proxy middleware was created
      expect(createProxyMiddleware).toHaveBeenCalled();

      // Check it was called with correct configuration
      expect(createProxyMiddleware).toHaveBeenCalledWith(
        expect.objectContaining({
          target: 'http://localhost:3030',
          changeOrigin: true,
        })
      );
    });
  });

  describe('control endpoints', () => {
    it('should handle start control endpoint', async () => {
      setPlatform('darwin');
      mockFs.existsSync.mockReturnValue(true);

      const router = createScreencapRoutes();
      const mockReq = {} as Request;
      const mockRes = {
        json: vi.fn(),
        status: vi.fn().mockReturnThis(),
      } as unknown as Response;

      // Get the handler
      const controlRoute = (
        router as unknown as {
          stack: Array<{ route?: { path: string; stack: Array<{ handle: unknown }> } }>;
        }
      ).stack.find((layer) => layer.route?.path === '/screencap-control/start');

      expect(controlRoute).toBeDefined();

      const handler = controlRoute?.route?.stack[0].handle;

      await handler(mockReq, mockRes);

      // Should try to start the process
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        message: 'Screencap service started',
      });
    });

    it('should handle status control endpoint', () => {
      setPlatform('darwin');
      const router = createScreencapRoutes();
      const mockReq = {} as Request;
      const mockRes = {
        json: vi.fn(),
      } as unknown as Response;

      // Find the status route
      const statusRoute = (
        router as unknown as {
          stack: Array<{ route?: { path: string; stack: Array<{ handle: unknown }> } }>;
        }
      ).stack.find((layer) => layer.route?.path === '/screencap-control/status');
      const handler = statusRoute?.route?.stack[0].handle;

      handler(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          port: 3030,
        })
      );
    });
  });
});
