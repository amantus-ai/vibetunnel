import { Request, Response, NextFunction } from 'express';
import chalk from 'chalk';
import { AuthService } from '../services/auth-service.js';

interface AuthConfig {
  basicAuthUsername: string | null;
  basicAuthPassword: string | null;
  isHQMode: boolean;
  bearerToken?: string; // Token that HQ must use to authenticate with this remote
  authService?: AuthService; // Enhanced auth service for JWT tokens
}

interface AuthenticatedRequest extends Request {
  userId?: string;
  authMethod?: 'ssh-key' | 'password' | 'basic' | 'hq-bearer';
  isHQRequest?: boolean;
}

export function createAuthMiddleware(config: AuthConfig) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    // Skip auth for health check endpoint and auth endpoints
    if (req.path === '/api/health' || req.path.startsWith('/api/auth')) {
      return next();
    }

    // If no auth configured, allow all requests
    if (!config.basicAuthUsername || !config.basicAuthPassword) {
      return next();
    }

    console.log(
      `[AUTH] ${req.method} ${req.path}, auth header: ${req.headers.authorization ? req.headers.authorization.substring(0, 20) + '...' : 'none'}`
    );

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

      // If we have enhanced auth service, try JWT token validation
      if (config.authService) {
        const verification = config.authService.verifyToken(token);
        if (verification.valid && verification.userId) {
          console.log(`[AUTH] ✅ Valid JWT token for user: ${verification.userId}`);
          req.userId = verification.userId;
          req.authMethod = 'ssh-key'; // JWT tokens are issued for SSH key auth
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
        req.authMethod = 'ssh-key'; // JWT tokens are issued for SSH key auth
        return next();
      } else {
        console.log('[AUTH] ❌ Invalid query token');
      }
    }

    // Check Basic auth
    if (authHeader && authHeader.startsWith('Basic ')) {
      const base64Credentials = authHeader.substring(6);
      const credentials = Buffer.from(base64Credentials, 'base64').toString('utf8');
      const [username, password] = credentials.split(':');

      if (username === config.basicAuthUsername && password === config.basicAuthPassword) {
        console.log('[AUTH] ✅ Valid basic authentication');
        req.authMethod = 'basic';
        return next();
      } else {
        console.log('[AUTH] ❌ Invalid basic auth credentials');
      }
    }

    // No valid auth provided
    console.log(
      chalk.red(`[AUTH] ❌ Unauthorized request to ${req.method} ${req.path} from ${req.ip}`)
    );
    res.setHeader('WWW-Authenticate', 'Basic realm="VibeTunnel"');
    res.status(401).json({ error: 'Authentication required' });
  };
}
