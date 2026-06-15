import { Router } from 'express';
import { promisify } from 'util';
import type { AuthenticatedRequest, TailscaleUser } from '../middleware/auth.js';
import type { AuthService } from '../services/auth-service.js';

interface AuthRoutesConfig {
  authService: AuthService;
  enableSSHKeys?: boolean;
  disallowUserPassword?: boolean;
  noAuth?: boolean;
}

function isFromLocalhost(req: AuthenticatedRequest): boolean {
  const remoteAddr = req.socket.remoteAddress;
  return remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1';
}

function hasProxyHeaders(req: AuthenticatedRequest): boolean {
  return Boolean(
    req.headers['x-forwarded-proto'] &&
      req.headers['x-forwarded-for'] &&
      req.headers['x-forwarded-host']
  );
}

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function getTailscaleLogin(req: AuthenticatedRequest): string | undefined {
  return getHeaderValue(req.headers['tailscale-user-login']);
}

function getConfiguredPasswordUserId(): string | undefined {
  const username = process.env.VIBETUNNEL_USERNAME;
  return username && process.env.VIBETUNNEL_PASSWORD ? username : undefined;
}

export function createAuthRoutes(config: AuthRoutesConfig): Router {
  const router = Router();
  const { authService } = config;

  /**
   * Create authentication challenge for SSH key auth
   * POST /api/auth/challenge
   */
  router.post('/challenge', async (req, res) => {
    try {
      const { userId } = req.body;

      if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
      }

      // Check if user exists
      const userExists = await authService.userExists(userId);
      if (!userExists) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Create challenge
      const challenge = authService.createChallenge(userId);

      res.json({
        challengeId: challenge.challengeId,
        challenge: challenge.challenge,
        expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
      });
    } catch (error) {
      console.error('Error creating auth challenge:', error);
      res.status(500).json({ error: 'Failed to create authentication challenge' });
    }
  });

  /**
   * Authenticate with SSH key
   * POST /api/auth/ssh-key
   */
  router.post('/ssh-key', async (req, res) => {
    try {
      const { challengeId, publicKey, signature } = req.body;

      if (!challengeId || !publicKey || !signature) {
        return res.status(400).json({
          error: 'Challenge ID, public key, and signature are required',
        });
      }

      const result = await authService.authenticateWithSSHKey({
        challengeId,
        publicKey,
        signature,
      });

      if (result.success) {
        res.json({
          success: true,
          token: result.token,
          userId: result.userId,
          authMethod: 'ssh-key',
        });
      } else {
        res.status(401).json({
          success: false,
          error: result.error,
        });
      }
    } catch (error) {
      console.error('Error authenticating with SSH key:', error);
      res.status(500).json({ error: 'SSH key authentication failed' });
    }
  });

  /**
   * Authenticate with password
   * POST /api/auth/password
   */
  router.post('/password', async (req, res) => {
    try {
      const { userId, password } = req.body;

      if (!userId || !password) {
        return res.status(400).json({
          error: 'User ID and password are required',
        });
      }

      const passwordUserId = getConfiguredPasswordUserId() || userId;
      const result = await authService.authenticateWithPassword(passwordUserId, password);

      if (result.success) {
        res.json({
          success: true,
          token: result.token,
          userId: result.userId,
          authMethod: 'password',
        });
      } else {
        res.status(401).json({
          success: false,
          error: result.error,
        });
      }
    } catch (error) {
      console.error('Error authenticating with password:', error);
      res.status(500).json({ error: 'Password authentication failed' });
    }
  });

  /**
   * Verify current authentication status
   * GET /api/auth/verify
   */
  router.get('/verify', (req, res) => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ valid: false, error: 'No token provided' });
      }

      const token = authHeader.slice(7);
      const verification = authService.verifyToken(token);

      if (verification.valid) {
        res.json({
          valid: true,
          userId: verification.userId,
        });
      } else {
        res.status(401).json({
          valid: false,
          error: 'Invalid or expired token',
        });
      }
    } catch (error) {
      console.error('Error verifying token:', error);
      res.status(500).json({ error: 'Token verification failed' });
    }
  });

  /**
   * Get current system user (for initial auth)
   * GET /api/auth/current-user
   */
  router.get('/current-user', (_req, res) => {
    try {
      const currentUser = authService.getCurrentUser();
      res.json({ userId: currentUser });
    } catch (error) {
      console.error('Error getting current user:', error);
      res.status(500).json({ error: 'Failed to get current user' });
    }
  });

  /**
   * Get authentication configuration
   * GET /api/auth/config
   */
  router.get('/config', (req: AuthenticatedRequest, res) => {
    try {
      interface AuthConfigResponse {
        enableSSHKeys: boolean;
        disallowUserPassword: boolean;
        noAuth: boolean;
        passwordAuthMode: 'system' | 'configured';
        tailscaleAuth?: boolean;
        authenticatedUser?: string;
        tailscaleUser?: TailscaleUser;
      }

      const response: AuthConfigResponse = {
        enableSSHKeys: config.enableSSHKeys || false,
        disallowUserPassword: config.disallowUserPassword || false,
        noAuth: config.noAuth || false,
        passwordAuthMode: getConfiguredPasswordUserId() ? 'configured' : 'system',
      };

      // If user is authenticated via Tailscale, indicate this
      if (req.authMethod === 'tailscale' && req.userId) {
        response.tailscaleAuth = true;
        response.authenticatedUser = req.userId;
        response.tailscaleUser = req.tailscaleUser;
      }

      res.json(response);
    } catch (error) {
      console.error('Error getting auth config:', error);
      res.status(500).json({ error: 'Failed to get auth config' });
    }
  });

  /**
   * Get JWT token for Tailscale authenticated users (for WebSocket auth)
   * POST /api/auth/tailscale-token
   */
  router.post('/tailscale-token', (req: AuthenticatedRequest, res) => {
    try {
      // Only allow Tailscale-authenticated users to get tokens
      if (req.authMethod !== 'tailscale') {
        return res.status(401).json({
          error: 'This endpoint is only available for Tailscale authenticated users',
        });
      }

      if (!req.userId) {
        return res.status(401).json({
          error: 'No user ID found in Tailscale authentication',
        });
      }

      // Validate that the request is actually coming from the local Tailscale proxy
      if (!isFromLocalhost(req)) {
        return res.status(401).json({
          error: 'Invalid request origin',
        });
      }

      if (!hasProxyHeaders(req)) {
        return res.status(401).json({
          error: 'Invalid proxy configuration',
        });
      }

      const tailscaleLogin = getTailscaleLogin(req);
      if (!tailscaleLogin || tailscaleLogin !== req.userId) {
        return res.status(401).json({
          error: 'Invalid Tailscale identity headers',
        });
      }

      // Generate a JWT token for WebSocket authentication
      // Use the private generateToken method via a wrapper in AuthService
      const token = authService.generateTokenForUser(req.userId);

      res.json({
        success: true,
        token,
        userId: req.userId,
        authMethod: 'tailscale',
        expiresIn: '24h',
      });
    } catch (error) {
      console.error('Error generating Tailscale token:', error);
      res.status(500).json({ error: 'Failed to generate token' });
    }
  });

  /**
   * Get user avatar (macOS only)
   * GET /api/auth/avatar/:userId
   */
  router.get('/avatar/:userId', async (req, res) => {
    try {
      const { userId } = req.params;

      // Validate userId to prevent command injection
      // Only allow alphanumeric characters, dots, hyphens, and underscores
      if (!userId || !/^[a-zA-Z0-9._-]+$/.test(userId)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      // Additional length check
      if (userId.length > 255) {
        return res.status(400).json({ error: 'User ID too long' });
      }

      // Check if we're on macOS
      if (process.platform !== 'darwin') {
        return res.json({ avatar: null, platform: process.platform });
      }

      // Try to get user's JPEGPhoto from Directory Services
      try {
        // Use execFile with explicit arguments to prevent command injection
        const { execFile } = await import('child_process');
        const execFileAsync = promisify(execFile);
        const { stdout } = await execFileAsync('dscl', [
          '.',
          '-read',
          `/Users/${userId}`,
          'JPEGPhoto',
        ]);

        // Check if JPEGPhoto exists and extract the hex data
        if (stdout.includes('JPEGPhoto:')) {
          const lines = stdout.split('\n');
          const hexLines = lines
            .slice(1)
            .filter((line) => line.trim() && !line.startsWith('dsAttrTypeNative'));

          if (hexLines.length > 0) {
            // Join all hex lines and remove spaces
            const hexData = hexLines.join('').replace(/\s/g, '');

            // Convert hex to base64
            const buffer = Buffer.from(hexData, 'hex');
            const base64 = buffer.toString('base64');

            return res.json({
              avatar: `data:image/jpeg;base64,${base64}`,
              platform: 'darwin',
              source: 'dscl',
            });
          }
        }
      } catch (_dsclError) {
        console.log('No JPEGPhoto found for user, trying Picture attribute');
      }

      // Fallback: try Picture attribute (file path)
      try {
        const { execFile } = await import('child_process');
        const execFileAsync = promisify(execFile);
        const { stdout } = await execFileAsync('dscl', [
          '.',
          '-read',
          `/Users/${userId}`,
          'Picture',
        ]);
        if (stdout.includes('Picture:')) {
          const picturePath = stdout.split('Picture:')[1].trim();
          if (picturePath && picturePath !== 'Picture:') {
            return res.json({
              avatar: picturePath,
              platform: 'darwin',
              source: 'picture_path',
            });
          }
        }
      } catch (_pictureError) {
        console.log('No Picture attribute found for user');
      }

      // No avatar found
      res.json({ avatar: null, platform: 'darwin' });
    } catch (error) {
      console.error('Error getting user avatar:', error);
      res.status(500).json({ error: 'Failed to get user avatar' });
    }
  });

  /**
   * Logout (invalidate token - client-side only for now)
   * POST /api/auth/logout
   */
  router.post('/logout', (_req, res) => {
    // For JWT tokens, logout is primarily client-side (remove token)
    // In the future, we could implement token blacklisting
    res.json({ success: true, message: 'Logged out successfully' });
  });

  return router;
}
