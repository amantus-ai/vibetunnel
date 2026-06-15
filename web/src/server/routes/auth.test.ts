import type { NextFunction, Response } from 'express';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import type { AuthService } from '../services/auth-service.js';
import { createAuthRoutes } from './auth.js';

// Mock the logger
vi.mock('../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('Auth Routes', () => {
  let app: express.Express;
  let mockAuthService: AuthService;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    // Mock auth service
    mockAuthService = {
      verifyToken: vi.fn(),
      generateTokenForUser: vi.fn(),
      createChallenge: vi.fn(),
      authenticateWithSSHKey: vi.fn(),
      authenticateWithPassword: vi.fn(),
      getCurrentUser: vi.fn(),
      userExists: vi.fn(),
    } as unknown as AuthService;

    // Mock middleware to set auth info on request
    const mockAuthMiddleware = (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
      // Default to no auth
      req.authMethod = undefined;
      req.userId = undefined;
      req.tailscaleUser = undefined;
      next();
    };

    app.use(mockAuthMiddleware);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  describe('GET /api/auth/config', () => {
    it('should report system password authentication by default', async () => {
      vi.stubEnv('VIBETUNNEL_USERNAME', '');
      vi.stubEnv('VIBETUNNEL_PASSWORD', '');
      app.use('/api/auth', createAuthRoutes({ authService: mockAuthService }));

      const response = await request(app).get('/api/auth/config');

      expect(response.status).toBe(200);
      expect(response.body.passwordAuthMode).toBe('system');
      expect(response.body).not.toHaveProperty('passwordUserId');
    });

    it('should report configured password authentication when both credentials are set', async () => {
      vi.stubEnv('VIBETUNNEL_USERNAME', 'configured-user');
      vi.stubEnv('VIBETUNNEL_PASSWORD', 'configured-password');
      app.use('/api/auth', createAuthRoutes({ authService: mockAuthService }));

      const response = await request(app).get('/api/auth/config');

      expect(response.status).toBe(200);
      expect(response.body.passwordAuthMode).toBe('configured');
      expect(response.body).not.toHaveProperty('passwordUserId');
    });
  });

  describe('POST /api/auth/password', () => {
    it('should keep the configured username server-side', async () => {
      vi.stubEnv('VIBETUNNEL_USERNAME', 'configured-user');
      vi.stubEnv('VIBETUNNEL_PASSWORD', 'configured-password');
      mockAuthService.authenticateWithPassword = vi.fn().mockResolvedValue({
        success: true,
        userId: 'configured-user',
        token: 'test-token',
      });
      app.use('/api/auth', createAuthRoutes({ authService: mockAuthService }));

      const response = await request(app).post('/api/auth/password').send({
        userId: 'system-user',
        password: 'configured-password',
      });

      expect(response.status).toBe(200);
      expect(mockAuthService.authenticateWithPassword).toHaveBeenCalledWith(
        'configured-user',
        'configured-password'
      );
    });
  });

  describe('POST /api/auth/tailscale-token', () => {
    it('should generate token for Tailscale authenticated users', async () => {
      const mockToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test';
      mockAuthService.generateTokenForUser = vi.fn().mockReturnValue(mockToken);

      const forceLocalhost = (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
        Object.defineProperty(req.socket, 'remoteAddress', {
          value: '127.0.0.1',
          configurable: true,
        });
        next();
      };

      // Mock middleware to simulate Tailscale auth
      const tailscaleAuthMiddleware = (
        req: AuthenticatedRequest,
        _res: Response,
        next: NextFunction
      ) => {
        req.authMethod = 'tailscale';
        req.userId = 'user@example.com';
        req.tailscaleUser = {
          login: 'user@example.com',
          name: 'Test User',
          profilePic: 'https://example.com/pic.jpg',
        };
        next();
      };

      app.use('/api/auth', forceLocalhost, tailscaleAuthMiddleware);
      app.use('/api/auth', createAuthRoutes({ authService: mockAuthService }));

      const response = await request(app)
        .post('/api/auth/tailscale-token')
        .set('x-forwarded-for', '100.64.0.1')
        .set('x-forwarded-proto', 'https')
        .set('x-forwarded-host', 'example.ts.net')
        .set('tailscale-user-login', 'user@example.com');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        token: mockToken,
        userId: 'user@example.com',
        authMethod: 'tailscale',
        expiresIn: '24h',
      });
      expect(mockAuthService.generateTokenForUser).toHaveBeenCalledWith('user@example.com');
    });

    it('should reject requests missing proxy headers', async () => {
      const forceLocalhost = (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
        Object.defineProperty(req.socket, 'remoteAddress', {
          value: '127.0.0.1',
          configurable: true,
        });
        next();
      };

      const tailscaleAuthMiddleware = (
        req: AuthenticatedRequest,
        _res: Response,
        next: NextFunction
      ) => {
        req.authMethod = 'tailscale';
        req.userId = 'user@example.com';
        req.tailscaleUser = {
          login: 'user@example.com',
          name: 'Test User',
        };
        next();
      };

      app.use('/api/auth', forceLocalhost, tailscaleAuthMiddleware);
      app.use('/api/auth', createAuthRoutes({ authService: mockAuthService }));

      const response = await request(app)
        .post('/api/auth/tailscale-token')
        .set('tailscale-user-login', 'user@example.com');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: 'Invalid proxy configuration',
      });
      expect(mockAuthService.generateTokenForUser).not.toHaveBeenCalled();
    });

    it('should reject requests not from localhost', async () => {
      const forceRemote = (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
        Object.defineProperty(req.socket, 'remoteAddress', {
          value: '10.0.0.5',
          configurable: true,
        });
        next();
      };

      const tailscaleAuthMiddleware = (
        req: AuthenticatedRequest,
        _res: Response,
        next: NextFunction
      ) => {
        req.authMethod = 'tailscale';
        req.userId = 'user@example.com';
        req.tailscaleUser = {
          login: 'user@example.com',
          name: 'Test User',
        };
        next();
      };

      app.use('/api/auth', forceRemote, tailscaleAuthMiddleware);
      app.use('/api/auth', createAuthRoutes({ authService: mockAuthService }));

      const response = await request(app)
        .post('/api/auth/tailscale-token')
        .set('x-forwarded-for', '100.64.0.1')
        .set('x-forwarded-proto', 'https')
        .set('x-forwarded-host', 'example.ts.net')
        .set('tailscale-user-login', 'user@example.com');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: 'Invalid request origin',
      });
      expect(mockAuthService.generateTokenForUser).not.toHaveBeenCalled();
    });

    it('should reject when Tailscale login header mismatches userId', async () => {
      const forceLocalhost = (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
        Object.defineProperty(req.socket, 'remoteAddress', {
          value: '127.0.0.1',
          configurable: true,
        });
        next();
      };

      const tailscaleAuthMiddleware = (
        req: AuthenticatedRequest,
        _res: Response,
        next: NextFunction
      ) => {
        req.authMethod = 'tailscale';
        req.userId = 'user@example.com';
        req.tailscaleUser = {
          login: 'user@example.com',
          name: 'Test User',
        };
        next();
      };

      app.use('/api/auth', forceLocalhost, tailscaleAuthMiddleware);
      app.use('/api/auth', createAuthRoutes({ authService: mockAuthService }));

      const response = await request(app)
        .post('/api/auth/tailscale-token')
        .set('x-forwarded-for', '100.64.0.1')
        .set('x-forwarded-proto', 'https')
        .set('x-forwarded-host', 'example.ts.net')
        .set('tailscale-user-login', 'other@example.com');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: 'Invalid Tailscale identity headers',
      });
      expect(mockAuthService.generateTokenForUser).not.toHaveBeenCalled();
    });

    it('should reject non-Tailscale authenticated requests', async () => {
      // Mock middleware to simulate non-Tailscale auth
      const nonTailscaleAuthMiddleware = (
        req: AuthenticatedRequest,
        _res: Response,
        next: NextFunction
      ) => {
        req.authMethod = 'password';
        req.userId = 'user@example.com';
        next();
      };

      app.use('/api/auth', nonTailscaleAuthMiddleware);
      app.use('/api/auth', createAuthRoutes({ authService: mockAuthService }));

      const response = await request(app).post('/api/auth/tailscale-token');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: 'This endpoint is only available for Tailscale authenticated users',
      });
      expect(mockAuthService.generateTokenForUser).not.toHaveBeenCalled();
    });

    it('should reject requests without user ID', async () => {
      // Mock middleware to simulate Tailscale auth without userId
      const tailscaleAuthNoUserMiddleware = (
        req: AuthenticatedRequest,
        _res: Response,
        next: NextFunction
      ) => {
        req.authMethod = 'tailscale';
        req.userId = undefined; // No user ID
        next();
      };

      app.use('/api/auth', tailscaleAuthNoUserMiddleware);
      app.use('/api/auth', createAuthRoutes({ authService: mockAuthService }));

      const response = await request(app).post('/api/auth/tailscale-token');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: 'No user ID found in Tailscale authentication',
      });
      expect(mockAuthService.generateTokenForUser).not.toHaveBeenCalled();
    });

    it('should handle AuthService errors gracefully', async () => {
      mockAuthService.generateTokenForUser = vi.fn().mockImplementation(() => {
        throw new Error('Token generation failed');
      });

      const forceLocalhost = (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
        Object.defineProperty(req.socket, 'remoteAddress', {
          value: '127.0.0.1',
          configurable: true,
        });
        next();
      };

      // Mock middleware to simulate Tailscale auth
      const tailscaleAuthMiddleware = (
        req: AuthenticatedRequest,
        _res: Response,
        next: NextFunction
      ) => {
        req.authMethod = 'tailscale';
        req.userId = 'user@example.com';
        next();
      };

      app.use('/api/auth', forceLocalhost, tailscaleAuthMiddleware);
      app.use('/api/auth', createAuthRoutes({ authService: mockAuthService }));

      const response = await request(app)
        .post('/api/auth/tailscale-token')
        .set('x-forwarded-for', '100.64.0.1')
        .set('x-forwarded-proto', 'https')
        .set('x-forwarded-host', 'example.ts.net')
        .set('tailscale-user-login', 'user@example.com');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: 'Failed to generate token',
      });
      expect(mockAuthService.generateTokenForUser).toHaveBeenCalledWith('user@example.com');
    });

    it('should reject unauthenticated requests', async () => {
      // No auth middleware - request remains unauthenticated
      app.use('/api/auth', createAuthRoutes({ authService: mockAuthService }));

      const response = await request(app).post('/api/auth/tailscale-token');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: 'This endpoint is only available for Tailscale authenticated users',
      });
      expect(mockAuthService.generateTokenForUser).not.toHaveBeenCalled();
    });
  });
});
