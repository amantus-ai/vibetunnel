import type { Request, Response, Router } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScreencapRoutes, initializeScreencap } from './screencap';

// Note: The current implementation doesn't use child_process, fs, or http-proxy-middleware
// It simply proxies requests to the Mac app service on port 4010

describe('screencap routes', () => {
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    // Save original platform descriptor
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
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

      // Should complete without error
      await expect(initializeScreencap()).resolves.toBeUndefined();
    });

    it('should initialize successfully on macOS', async () => {
      setPlatform('darwin');

      // Should complete without error
      await expect(initializeScreencap()).resolves.toBeUndefined();
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
      const expectedRoutes = [{ path: '/screencap', method: 'get' }];

      for (const expected of expectedRoutes) {
        expect(routes).toContainEqual(expect.objectContaining(expected));
      }
    });

    it('should serve HTML page for /screencap route', () => {
      setPlatform('darwin');
      const mockReq = {} as Request;
      const mockRes = {
        send: vi.fn(),
        sendFile: vi.fn(),
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

      expect(mockRes.sendFile).toHaveBeenCalledWith(
        expect.stringContaining('public/screencap.html')
      );
    });
  });

  // Note: Control endpoints have been removed from the implementation
});
