import { BlockList, isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import type { NextFunction, Request, Response } from 'express';
import type { AuthService } from '../services/auth-service.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('auth');

interface AuthConfig {
  enableSSHKeys: boolean;
  disallowUserPassword: boolean;
  noAuth: boolean;
  isHQMode: boolean;
  bearerToken?: string; // Token that HQ must use to authenticate with this remote
  authService?: AuthService; // Enhanced auth service for JWT tokens
  allowLocalBypass?: boolean; // Allow localhost connections to bypass auth
  localAuthToken?: string; // Token for localhost authentication
  allowTailscaleAuth?: boolean; // Allow Tailscale identity headers for authentication
}

export interface AuthenticatedRequest extends Request {
  userId?: string;
  authMethod?: 'ssh-key' | 'password' | 'hq-bearer' | 'no-auth' | 'local-bypass' | 'tailscale';
  isHQRequest?: boolean;
  tailscaleUser?: TailscaleUser;
}

const loopbackAddresses = new Set(['127.0.0.1', '::1', 'localhost']);

function normalizeAddress(address: string): string {
  const withoutBrackets =
    address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
  const withoutScope = withoutBrackets.split('%', 1)[0];
  return withoutScope.startsWith('::ffff:') ? withoutScope.slice(7) : withoutScope;
}

export function isLocalMachineAddress(address: string, interfaces = networkInterfaces()): boolean {
  const normalizedAddress = normalizeAddress(address);
  if (loopbackAddresses.has(normalizedAddress)) {
    return true;
  }

  const addressVersion = isIP(normalizedAddress);
  if (addressVersion === 0) {
    return false;
  }

  const localAddresses = new BlockList();
  for (const addresses of Object.values(interfaces)) {
    for (const entry of addresses ?? []) {
      const localAddress = normalizeAddress(entry.address);
      const localAddressVersion = isIP(localAddress);
      if (localAddressVersion !== 0) {
        localAddresses.addAddress(localAddress, localAddressVersion === 4 ? 'ipv4' : 'ipv6');
      }
    }
  }

  return localAddresses.check(normalizedAddress, addressVersion === 4 ? 'ipv4' : 'ipv6');
}

// Helper function to check if request is from localhost or, with a valid token, this machine.
function isLocalRequest(req: Request, allowLocalInterface: boolean): boolean {
  const clientIp = req.socket.remoteAddress || '';
  const ipIsLocal =
    loopbackAddresses.has(normalizeAddress(clientIp)) ||
    (allowLocalInterface && isLocalMachineAddress(clientIp));

  // Additional security checks to prevent spoofing
  const noForwardedFor = !req.headers['x-forwarded-for'];
  const noRealIP = !req.headers['x-real-ip'];
  const noForwardedHost = !req.headers['x-forwarded-host'];

  // Check hostname
  const hostIsLocal =
    loopbackAddresses.has(normalizeAddress(req.hostname)) ||
    (allowLocalInterface && isLocalMachineAddress(req.hostname));

  logger.debug(
    `Local request check - IP: ${clientIp}, Host: ${req.hostname}, ` +
      `Forwarded headers: ${!noForwardedFor || !noRealIP || !noForwardedHost}`
  );

  return ipIsLocal && noForwardedFor && noRealIP && noForwardedHost && hostIsLocal;
}

// Helper function to check if request is from localhost (for reverse proxy scenarios)
function isFromLocalhostAddress(req: Request): boolean {
  const remoteAddr = req.socket.remoteAddress;
  return remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1';
}

// Type definition for Tailscale headers
interface TailscaleHeaders {
  'tailscale-user-login'?: string;
  'tailscale-user-name'?: string;
  'tailscale-user-profile-pic'?: string;
}

// Type for validated Tailscale user information
export interface TailscaleUser {
  login: string;
  name: string;
  profilePic?: string;
}

// Helper function to check if request has valid Tailscale headers
function getTailscaleUser(req: Request): TailscaleUser | null {
  // Type-safe header access
  const headers = req.headers as unknown as TailscaleHeaders;

  const login = headers['tailscale-user-login'];
  const name = headers['tailscale-user-name'];
  const profilePic = headers['tailscale-user-profile-pic'];

  // Must have at least login to be valid
  if (!login) {
    return null;
  }

  return {
    login,
    name: name || login, // Fallback to login if name not provided
    profilePic,
  };
}

export function createAuthMiddleware(config: AuthConfig) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    // Skip auth for auth endpoints, client logging, push notifications, and Tailscale status
    if (
      req.path.startsWith('/auth') ||
      req.path.startsWith('/api/auth') ||
      req.path.startsWith('/logs') ||
      req.path === '/sessions/tailscale/status' ||
      req.path.startsWith('/push')
    ) {
      // Special case: If Tailscale auth is enabled and we have valid headers,
      // set the auth info even for /auth endpoints so the client knows we're authenticated
      if (
        config.allowTailscaleAuth &&
        (req.path.startsWith('/auth') || req.path.startsWith('/api/auth'))
      ) {
        const tailscaleUser = getTailscaleUser(req);
        if (tailscaleUser) {
          req.authMethod = 'tailscale';
          req.userId = tailscaleUser.login;
          req.tailscaleUser = tailscaleUser;
        }
      }
      return next();
    }

    // If no auth is required, allow all requests
    if (config.noAuth) {
      req.authMethod = 'no-auth';
      req.userId = 'no-auth-user'; // Set a default user ID for no-auth mode
      return next();
    }

    // Check for Tailscale authentication if enabled
    if (config.allowTailscaleAuth) {
      const tailscaleUser = getTailscaleUser(req);
      if (tailscaleUser) {
        // Security check: Ensure request is from localhost (Tailscale Serve proxy)
        if (!isFromLocalhostAddress(req)) {
          logger.warn(
            `Tailscale headers present but request not from localhost: ${req.socket.remoteAddress}`
          );
          return res.status(401).json({ error: 'Invalid request origin' });
        }

        // Additional check: Verify proxy headers exist
        const hasProxyHeaders = !!(
          req.headers['x-forwarded-proto'] &&
          req.headers['x-forwarded-for'] &&
          req.headers['x-forwarded-host']
        );

        if (!hasProxyHeaders) {
          logger.warn('Tailscale headers present but missing proxy headers');
          return res.status(401).json({ error: 'Invalid proxy configuration' });
        }

        // Log Tailscale authentication
        logger.info(`Tailscale authentication successful for user: ${tailscaleUser.login}`);
        logger.info(
          `User details - Name: ${tailscaleUser.name}, Has profile pic: ${!!tailscaleUser.profilePic}`
        );

        req.authMethod = 'tailscale';
        req.userId = tailscaleUser.login;
        req.tailscaleUser = tailscaleUser;
        return next();
      }
    }

    // Check for local bypass if enabled
    const providedLocalToken = req.headers['x-vibetunnel-local'];
    const hasValidLocalToken =
      typeof providedLocalToken === 'string' &&
      Boolean(config.localAuthToken) &&
      providedLocalToken === config.localAuthToken;

    if (config.allowLocalBypass && isLocalRequest(req, hasValidLocalToken)) {
      // If a local auth token is configured, check for it
      if (config.localAuthToken) {
        if (hasValidLocalToken) {
          logger.debug('Local request authenticated with token');
          req.authMethod = 'local-bypass';
          req.userId = 'local-user';
          return next();
        } else {
          logger.debug('Local request missing or invalid token');
        }
      } else {
        // No token required for local bypass
        logger.debug('Local request authenticated without token');
        req.authMethod = 'local-bypass';
        req.userId = 'local-user';
        return next();
      }
    }

    // Only log auth requests that might be problematic (no header or failures)
    // Remove verbose logging for successful token auth to reduce spam

    const authHeader = req.headers.authorization;
    const tokenQuery = req.query.token as string;

    // Check for Bearer token
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);

      // In HQ mode, check if this is a valid HQ-to-remote bearer token
      if (config.isHQMode && config.bearerToken && token === config.bearerToken) {
        logger.debug('Valid HQ bearer token authentication');
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
          logger.error('Invalid JWT token');
        }
      } else if (config.authService) {
        const verification = config.authService.verifyToken(token);
        if (verification.valid && verification.userId) {
          req.userId = verification.userId;
          req.authMethod = 'password'; // Password auth only
          return next();
        } else {
          logger.error('Invalid JWT token');
        }
      }

      // For non-HQ mode, check if bearer token matches remote expectation
      if (!config.isHQMode && config.bearerToken && token === config.bearerToken) {
        logger.debug('Valid remote bearer token authentication');
        req.authMethod = 'hq-bearer';
        return next();
      }

      logger.error(
        `Bearer token rejected - HQ mode: ${config.isHQMode}, token matches: ${config.bearerToken === token}`
      );
    }

    // Check for token in query parameter (WebSocket v3 + other non-header clients)
    if (tokenQuery && config.authService) {
      const verification = config.authService.verifyToken(tokenQuery);
      if (verification.valid && verification.userId) {
        logger.debug(`Valid query token for user: ${verification.userId}`);
        req.userId = verification.userId;
        req.authMethod = config.enableSSHKeys ? 'ssh-key' : 'password';
        return next();
      } else {
        logger.error('Invalid query token');
      }
    }

    // No valid auth provided
    logger.error(`Unauthorized request to ${req.method} ${req.path} from ${req.ip}`);
    res.setHeader('WWW-Authenticate', 'Bearer realm="VibeTunnel"');
    res.status(401).json({ error: 'Authentication required' });
  };
}
