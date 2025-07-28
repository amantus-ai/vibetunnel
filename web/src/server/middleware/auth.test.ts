import type { NextFunction, Response } from 'express';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthService } from '../services/auth-service.js';
import { type AuthenticatedRequest, createAuthMiddleware } from './auth.js';

// Mock the logger
vi.mock('../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('Auth Middleware', () => {
  let app: express.Express;
  let mockAuthService: AuthService;
  let mockNext: NextFunction;
  let mockRes: Response;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    // Mock auth service
    mockAuthService = {
      verifyPassword: vi.fn(),
      generateAuthToken: vi.fn(),
      verifyAuthToken: vi.fn(),
      verifyToken: vi.fn(), // Add the correct method name
      revokeAuthToken: vi.fn(),
      isSSHKeyAuthenticated: vi.fn(),
      authenticateWithSSHKey: vi.fn(),
      markSSHKeyAuthenticated: vi.fn(),
      clearSSHKeyAuthentication: vi.fn(),
    } as unknown as AuthService;

    mockNext = vi.fn();
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('No Auth Mode', () => {
    it('should bypass authentication when noAuth is true', async () => {
      const middleware = createAuthMiddleware({ noAuth: true });

      app.use('/api', middleware);
      app.get('/api/test', (_req, res) => res.json({ success: true }));

      const response = await request(app).get('/api/test');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
    });
  });

  describe('Tailscale Authentication', () => {
    it('should authenticate user with valid Tailscale headers from localhost', async () => {
      const middleware = createAuthMiddleware({
        allowTailscaleAuth: true,
        authService: mockAuthService,
      });

      app.use('/api', middleware);
      app.get('/api/test', (req: AuthenticatedRequest, res) => {
        res.json({
          success: true,
          userId: req.userId,
          authMethod: req.authMethod,
          tailscaleUser: req.tailscaleUser,
        });
      });

      const response = await request(app)
        .get('/api/test')
        .set('tailscale-user-login', 'user@example.com')
        .set('tailscale-user-name', 'Test User')
        .set('tailscale-user-profile-pic', 'https://example.com/pic.jpg')
        .set('x-forwarded-proto', 'https')
        .set('x-forwarded-for', '100.64.0.1')
        .set('x-forwarded-host', 'myhost.tailnet.ts.net');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        userId: 'user@example.com',
        authMethod: 'tailscale',
        tailscaleUser: {
          login: 'user@example.com',
          name: 'Test User',
          profilePic: 'https://example.com/pic.jpg',
        },
      });
    });

    it('should reject Tailscale headers without proxy headers', async () => {
      const middleware = createAuthMiddleware({
        allowTailscaleAuth: true,
        authService: mockAuthService,
      });

      app.use('/api', middleware);
      app.get('/api/test', (_req, res) => res.json({ success: true }));

      const response = await request(app)
        .get('/api/test')
        .set('tailscale-user-login', 'user@example.com')
        .set('tailscale-user-name', 'Test User');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Invalid proxy configuration' });
    });

    it('should reject Tailscale headers from non-localhost', async () => {
      const middleware = createAuthMiddleware({
        allowTailscaleAuth: true,
        authService: mockAuthService,
      });

      // Create a custom request to control remoteAddress
      const req = {
        headers: {
          'tailscale-user-login': 'user@example.com',
          'tailscale-user-name': 'Test User',
          'x-forwarded-proto': 'https',
          'x-forwarded-for': '100.64.0.1',
          'x-forwarded-host': 'myhost.tailnet.ts.net',
        },
        socket: {
          remoteAddress: '192.168.1.100', // Non-localhost IP
        },
        path: '/test',
      } as unknown as AuthenticatedRequest;

      middleware(req, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid request origin' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle missing Tailscale login header', async () => {
      const middleware = createAuthMiddleware({
        allowTailscaleAuth: true,
        authService: mockAuthService,
      });

      app.use('/api', middleware);
      app.get('/api/test', (_req, res) => res.json({ success: true }));

      const response = await request(app)
        .get('/api/test')
        .set('tailscale-user-name', 'Test User')
        .set('x-forwarded-proto', 'https')
        .set('x-forwarded-for', '100.64.0.1')
        .set('x-forwarded-host', 'myhost.tailnet.ts.net');

      expect(response.status).toBe(401);
    });

    it('should set tailscale auth info on /api/auth endpoints', async () => {
      const middleware = createAuthMiddleware({
        allowTailscaleAuth: true,
        authService: mockAuthService,
      });

      app.use('/api', middleware);
      app.get('/api/auth/config', (req: AuthenticatedRequest, res) => {
        res.json({
          authMethod: req.authMethod,
          userId: req.userId,
          tailscaleUser: req.tailscaleUser,
        });
      });

      const response = await request(app)
        .get('/api/auth/config')
        .set('tailscale-user-login', 'user@example.com')
        .set('tailscale-user-name', 'Test User')
        .set('x-forwarded-proto', 'https')
        .set('x-forwarded-for', '100.64.0.1')
        .set('x-forwarded-host', 'myhost.tailnet.ts.net');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        authMethod: 'tailscale',
        userId: 'user@example.com',
      });
    });
  });

  describe('Local Bypass Authentication', () => {
    it('should allow local requests when allowLocalBypass is true', async () => {
      const middleware = createAuthMiddleware({
        allowLocalBypass: true,
        authService: mockAuthService,
      });

      app.use('/api', middleware);
      app.get('/api/test', (req: AuthenticatedRequest, res) => {
        res.json({
          success: true,
          authMethod: req.authMethod,
          userId: req.userId,
        });
      });

      // Supertest automatically sets host to 127.0.0.1 for local requests
      const response = await request(app).get('/api/test');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        authMethod: 'local-bypass',
        userId: 'local-user',
      });
    });

    it('should require token for local bypass when localAuthToken is set', async () => {
      const middleware = createAuthMiddleware({
        allowLocalBypass: true,
        localAuthToken: 'secret-token',
        authService: mockAuthService,
      });

      app.use('/api', middleware);
      app.get('/api/test', (_req, res) => res.json({ success: true }));

      // Without token
      const response1 = await request(app).get('/api/test');
      expect(response1.status).toBe(401);

      // With wrong token
      const response2 = await request(app)
        .get('/api/test')
        .set('x-vibetunnel-local', 'wrong-token');
      expect(response2.status).toBe(401);

      // With correct token
      const response3 = await request(app)
        .get('/api/test')
        .set('x-vibetunnel-local', 'secret-token');
      expect(response3.status).toBe(200);
    });

    it('should reject requests with forwarded headers even from localhost', async () => {
      const middleware = createAuthMiddleware({
        allowLocalBypass: true,
        authService: mockAuthService,
      });

      app.use('/api', middleware);
      app.get('/api/test', (_req, res) => res.json({ success: true }));

      const response = await request(app).get('/api/test').set('X-Forwarded-For', '192.168.1.100');

      expect(response.status).toBe(401);
    });
  });

  describe('Bearer Token Authentication', () => {
    it('should authenticate with valid bearer token', async () => {
      mockAuthService.verifyToken = vi.fn().mockReturnValue({ valid: true, userId: 'test-user' });

      const middleware = createAuthMiddleware({
        authService: mockAuthService,
        enableSSHKeys: true,
      });

      app.use('/api', middleware);
      app.get('/api/test', (req: AuthenticatedRequest, res) => {
        res.json({
          success: true,
          userId: req.userId,
          authMethod: req.authMethod,
        });
      });

      const response = await request(app)
        .get('/api/test')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        userId: 'test-user',
        authMethod: 'ssh-key',
      });
      expect(mockAuthService.verifyToken).toHaveBeenCalledWith('valid-token');
    });

    it('should reject invalid bearer token', async () => {
      mockAuthService.verifyToken = vi.fn().mockReturnValue({ valid: false });

      const middleware = createAuthMiddleware({
        authService: mockAuthService,
      });

      app.use('/api', middleware);
      app.get('/api/test', (_req, res) => res.json({ success: true }));

      const response = await request(app)
        .get('/api/test')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
    });
  });

  describe('Security Validations', () => {
    it('should skip auth for auth endpoints', async () => {
      const middleware = createAuthMiddleware({
        authService: mockAuthService,
      });

      app.use(middleware);
      app.post('/api/auth/login', (_req, res) => res.json({ success: true }));
      app.post('/auth/login', (_req, res) => res.json({ success: true }));

      const response1 = await request(app).post('/api/auth/login');
      expect(response1.status).toBe(200);

      const response2 = await request(app).post('/auth/login');
      expect(response2.status).toBe(200);
    });

    it('should skip auth for logs endpoint', async () => {
      const middleware = createAuthMiddleware({
        authService: mockAuthService,
      });

      app.use(middleware);
      app.post('/logs', (_req, res) => res.json({ success: true }));

      const response = await request(app).post('/logs');
      expect(response.status).toBe(200);
    });

    it('should skip auth for push endpoint', async () => {
      const middleware = createAuthMiddleware({
        authService: mockAuthService,
      });

      app.use(middleware);
      app.post('/push/subscribe', (_req, res) => res.json({ success: true }));

      const response = await request(app).post('/push/subscribe');
      expect(response.status).toBe(200);
    });

    it('should require auth for other endpoints when no auth method succeeds', async () => {
      const middleware = createAuthMiddleware({
        authService: mockAuthService,
      });

      app.use('/api', middleware);
      app.get('/api/sessions', (_req, res) => res.json({ success: true }));

      const response = await request(app).get('/api/sessions');
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Authentication required' });
    });
  });

  describe('IPv6 localhost handling', () => {
    it('should accept ::1 as localhost for Tailscale auth', async () => {
      const middleware = createAuthMiddleware({
        allowTailscaleAuth: true,
        authService: mockAuthService,
      });

      const req = {
        headers: {
          'tailscale-user-login': 'user@example.com',
          'tailscale-user-name': 'Test User',
          'x-forwarded-proto': 'https',
          'x-forwarded-for': '100.64.0.1',
          'x-forwarded-host': 'myhost.tailnet.ts.net',
        },
        socket: {
          remoteAddress: '::1', // IPv6 localhost
        },
        path: '/test',
      } as unknown as AuthenticatedRequest;

      middleware(req, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should accept ::ffff:127.0.0.1 as localhost for Tailscale auth', async () => {
      const middleware = createAuthMiddleware({
        allowTailscaleAuth: true,
        authService: mockAuthService,
      });

      const req = {
        headers: {
          'tailscale-user-login': 'user@example.com',
          'tailscale-user-name': 'Test User',
          'x-forwarded-proto': 'https',
          'x-forwarded-for': '100.64.0.1',
          'x-forwarded-host': 'myhost.tailnet.ts.net',
        },
        socket: {
          remoteAddress: '::ffff:127.0.0.1', // IPv4-mapped IPv6
        },
        path: '/test',
      } as unknown as AuthenticatedRequest;

      middleware(req, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });
});
