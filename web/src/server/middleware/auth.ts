import { Request, Response, NextFunction } from 'express';
import chalk from 'chalk';
import { AuthService } from '../services/auth-service.js';

interface AuthConfig {
  enableSSHKeys: boolean;
  disallowUserPassword: boolean;
  noAuth: boolean;
  isHQMode: boolean;
  bearerToken?: string; // Token that HQ must use to authenticate with this remote
  authService?: AuthService; // Enhanced auth service for JWT tokens
}

interface AuthenticatedRequest extends Request {
  userId?: string;
  authMethod?: 'ssh-key' | 'password' | 'hq-bearer' | 'no-auth';
  isHQRequest?: boolean;
}

export function createAuthMiddleware(config: AuthConfig) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    // Skip auth for health check endpoint, auth endpoints, client logging, and push notifications
    if (
      req.path === '/api/health' ||
      req.path.startsWith('/api/auth') ||
      req.path.startsWith('/api/logs') ||
      req.path.startsWith('/api/push')
    ) {
      return next();
    }

    // If no auth is disabled, allow all requests
    if (config.noAuth) {
      req.authMethod = 'no-auth';
      return next();
    }

    // Only log auth requests that might be problematic (no header or failures)
    // Remove verbose logging for successful token auth to reduce spam

    const authHeader = req.headers.authorization;
    const tokenQuery = req.query.token as string;

    // Check for Bearer token
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);

      // In HQ mode, check if this is a valid HQ-to-remote bearer token
      if (config.isHQMode && config.bearerToken && token === config.bearerToken) {
        console.log('[AUTH] ✅ Valid HQ bearer token authentication');
        req.isHQRequest = true;
        req.authMethod = 'hq-bearer';
        return next();
      }

      // If we have enhanced auth service and SSH keys are enabled, try JWT token validation
      if (config.authService && config.enableSSHKeys) {
        const verification = config.authService.verifyToken(token);
        if (verification.valid && verification.userId) {
          req.userId = verification.userId;
          req.authMethod = 'ssh-key'; // JWT tokens are issued for SSH key auth
          return next();
        } else {
          console.log('[AUTH] ❌ Invalid JWT token');
        }
      } else if (config.authService) {
        const verification = config.authService.verifyToken(token);
        if (verification.valid && verification.userId) {
          console.log(`[AUTH] ✅ Valid JWT token for user: ${verification.userId}`);
          req.userId = verification.userId;
          req.authMethod = 'password'; // Password auth only
          return next();
        } else {
          console.log('[AUTH] ❌ Invalid JWT token');
        }
      }

      // For non-HQ mode, check if bearer token matches remote expectation
      if (!config.isHQMode && config.bearerToken && token === config.bearerToken) {
        console.log('[AUTH] ✅ Valid remote bearer token authentication');
        req.authMethod = 'hq-bearer';
        return next();
      }

      console.log(
        `[AUTH] ❌ Bearer token rejected - HQ mode: ${config.isHQMode}, token matches: ${config.bearerToken === token}`
      );
    }

    // Check for token in query parameter (for EventSource connections)
    if (tokenQuery && config.authService) {
      const verification = config.authService.verifyToken(tokenQuery);
      if (verification.valid && verification.userId) {
        console.log(`[AUTH] ✅ Valid query token for user: ${verification.userId}`);
        req.userId = verification.userId;
        req.authMethod = config.enableSSHKeys ? 'ssh-key' : 'password';
        return next();
      } else {
        console.log('[AUTH] ❌ Invalid query token');
      }
    }

    // No valid auth provided
    console.log(
      chalk.red(`[AUTH] ❌ Unauthorized request to ${req.method} ${req.path} from ${req.ip}`)
    );
    res.setHeader('WWW-Authenticate', 'Bearer realm="VibeTunnel"');
    res.status(401).json({ error: 'Authentication required' });
  };
}
