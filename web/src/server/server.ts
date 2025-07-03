import chalk from 'chalk';
import type { Response as ExpressResponse } from 'express';
import express from 'express';
import * as fs from 'fs';
import type * as http from 'http';
import { createServer } from 'http';
import * as os from 'os';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { WebSocketServer } from 'ws';
import type { AuthenticatedRequest } from './middleware/auth.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { PtyManager } from './pty/index.js';
import { createAuthRoutes } from './routes/auth.js';
import { createFileRoutes } from './routes/files.js';
import { createFilesystemRoutes } from './routes/filesystem.js';
import { createLogRoutes } from './routes/logs.js';
import { createPushRoutes } from './routes/push.js';
import { createRemoteRoutes } from './routes/remotes.js';
import { createSessionRoutes } from './routes/sessions.js';
import { WebSocketInputHandler } from './routes/websocket-input.js';
import { ActivityMonitor } from './services/activity-monitor.js';
import { AuthService } from './services/auth-service.js';
import { BellEventHandler } from './services/bell-event-handler.js';
import { BufferAggregator } from './services/buffer-aggregator.js';
import { ControlDirWatcher } from './services/control-dir-watcher.js';
import { HQClient } from './services/hq-client.js';
import { PushNotificationService } from './services/push-notification-service.js';
import { RemoteRegistry } from './services/remote-registry.js';
import { StreamWatcher } from './services/stream-watcher.js';
import { TerminalManager } from './services/terminal-manager.js';
import { closeLogger, createLogger, initLogger, setDebugMode } from './utils/logger.js';
import { VapidManager } from './utils/vapid-manager.js';
import { getVersionInfo, printVersionBanner } from './version.js';

// Extended WebSocket request with authentication and routing info
interface WebSocketRequest extends http.IncomingMessage {
  pathname?: string;
  searchParams?: URLSearchParams;
  userId?: string;
  authMethod?: string;
}

const logger = createLogger('server');

// Global shutdown state management
let shuttingDown = false;

export function isShuttingDown(): boolean {
  return shuttingDown;
}

export function setShuttingDown(value: boolean): void {
  shuttingDown = value;
}

interface Config {
  port: number | null;
  bind: string | null;
  enableSSHKeys: boolean;
  disallowUserPassword: boolean;
  noAuth: boolean;
  isHQMode: boolean;
  hqUrl: string | null;
  hqUsername: string | null;
  hqPassword: string | null;
  remoteName: string | null;
  allowInsecureHQ: boolean;
  showHelp: boolean;
  showVersion: boolean;
  debug: boolean;
  // Push notification configuration
  pushEnabled: boolean;
  vapidEmail: string | null;
  generateVapidKeys: boolean;
  bellNotificationsEnabled: boolean;
  // Local bypass configuration
  allowLocalBypass: boolean;
  localAuthToken: string | null;
  // HQ auth bypass for testing
  noHqAuth: boolean;
}

// Show help message
function showHelp() {
  console.log(`
VibeTunnel Server - Terminal Multiplexer

Usage: vibetunnel-server [options]

Options:
  --help                Show this help message
  --version             Show version information
  --port <number>       Server port (default: 4020 or PORT env var)
  --bind <address>      Bind address (default: 0.0.0.0, all interfaces)
  --enable-ssh-keys     Enable SSH key authentication UI and functionality
  --disallow-user-password  Disable password auth, SSH keys only (auto-enables --enable-ssh-keys)
  --no-auth             Disable authentication (auto-login as current user)
  --allow-local-bypass  Allow localhost connections to bypass authentication
  --local-auth-token <token>  Token for localhost authentication bypass
  --debug               Enable debug logging

Push Notification Options:
  --push-enabled        Enable push notifications (default: enabled)
  --push-disabled       Disable push notifications
  --vapid-email <email> Contact email for VAPID (or PUSH_CONTACT_EMAIL env var)
  --generate-vapid-keys Generate new VAPID keys if none exist

HQ Mode Options:
  --hq                  Run as HQ (headquarters) server

Remote Server Options:
  --hq-url <url>        HQ server URL to register with
  --hq-username <user>  Username for HQ authentication
  --hq-password <pass>  Password for HQ authentication
  --name <name>         Unique name for this remote server
  --allow-insecure-hq   Allow HTTP URLs for HQ (default: HTTPS only)
  --no-hq-auth          Disable HQ authentication (for testing only)

Environment Variables:
  PORT                  Default port if --port not specified
  VIBETUNNEL_USERNAME   Default username if --username not specified
  VIBETUNNEL_PASSWORD   Default password if --password not specified
  VIBETUNNEL_CONTROL_DIR Control directory for session data
  PUSH_CONTACT_EMAIL    Contact email for VAPID configuration

Examples:
  # Run a simple server with authentication
  vibetunnel-server --username admin --password secret

  # Run as HQ server
  vibetunnel-server --hq --username hq-admin --password hq-secret

  # Run as remote server registering with HQ
  vibetunnel-server --username local --password local123 \\
    --hq-url https://hq.example.com \\
    --hq-username hq-admin --hq-password hq-secret \\
    --name remote-1
`);
}

// Parse command line arguments
function parseArgs(): Config {
  const args = process.argv.slice(2);
  const config = {
    port: null as number | null,
    bind: null as string | null,
    enableSSHKeys: false,
    disallowUserPassword: false,
    noAuth: false,
    isHQMode: false,
    hqUrl: null as string | null,
    hqUsername: null as string | null,
    hqPassword: null as string | null,
    remoteName: null as string | null,
    allowInsecureHQ: false,
    showHelp: false,
    showVersion: false,
    debug: false,
    // Push notification configuration
    pushEnabled: true, // Enable by default with auto-generation
    vapidEmail: null as string | null,
    generateVapidKeys: true, // Generate keys automatically
    bellNotificationsEnabled: true, // Enable bell notifications by default
    // Local bypass configuration
    allowLocalBypass: false,
    localAuthToken: null as string | null,
    // HQ auth bypass for testing
    noHqAuth: false,
  };

  // Check for help flag first
  if (args.includes('--help') || args.includes('-h')) {
    config.showHelp = true;
    return config;
  }

  // Check for version flag
  if (args.includes('--version') || args.includes('-v')) {
    config.showVersion = true;
    return config;
  }

  // Check for command line arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && i + 1 < args.length) {
      config.port = Number.parseInt(args[i + 1], 10);
      i++; // Skip the port value in next iteration
    } else if (args[i] === '--bind' && i + 1 < args.length) {
      config.bind = args[i + 1];
      i++; // Skip the bind value in next iteration
    } else if (args[i] === '--enable-ssh-keys') {
      config.enableSSHKeys = true;
    } else if (args[i] === '--disallow-user-password') {
      config.disallowUserPassword = true;
      config.enableSSHKeys = true; // Auto-enable SSH keys
    } else if (args[i] === '--no-auth') {
      config.noAuth = true;
    } else if (args[i] === '--hq') {
      config.isHQMode = true;
    } else if (args[i] === '--hq-url' && i + 1 < args.length) {
      config.hqUrl = args[i + 1];
      i++; // Skip the URL value in next iteration
    } else if (args[i] === '--hq-username' && i + 1 < args.length) {
      config.hqUsername = args[i + 1];
      i++; // Skip the username value in next iteration
    } else if (args[i] === '--hq-password' && i + 1 < args.length) {
      config.hqPassword = args[i + 1];
      i++; // Skip the password value in next iteration
    } else if (args[i] === '--name' && i + 1 < args.length) {
      config.remoteName = args[i + 1];
      i++; // Skip the name value in next iteration
    } else if (args[i] === '--allow-insecure-hq') {
      config.allowInsecureHQ = true;
    } else if (args[i] === '--debug') {
      config.debug = true;
    } else if (args[i] === '--push-enabled') {
      config.pushEnabled = true;
    } else if (args[i] === '--push-disabled') {
      config.pushEnabled = false;
    } else if (args[i] === '--vapid-email' && i + 1 < args.length) {
      config.vapidEmail = args[i + 1];
      i++; // Skip the email value in next iteration
    } else if (args[i] === '--generate-vapid-keys') {
      config.generateVapidKeys = true;
    } else if (args[i] === '--allow-local-bypass') {
      config.allowLocalBypass = true;
    } else if (args[i] === '--local-auth-token' && i + 1 < args.length) {
      config.localAuthToken = args[i + 1];
      i++; // Skip the token value in next iteration
    } else if (args[i] === '--no-hq-auth') {
      config.noHqAuth = true;
    } else if (args[i].startsWith('--')) {
      // Unknown argument
      logger.error(`Unknown argument: ${args[i]}`);
      logger.error('Use --help to see available options');
      process.exit(1);
    }
  }

  // Check environment variables for push notifications
  if (!config.vapidEmail && process.env.PUSH_CONTACT_EMAIL) {
    config.vapidEmail = process.env.PUSH_CONTACT_EMAIL;
  }

  return config;
}

// Validate configuration
function validateConfig(config: ReturnType<typeof parseArgs>) {
  // Validate auth configuration
  if (config.noAuth && (config.enableSSHKeys || config.disallowUserPassword)) {
    logger.warn(
      '--no-auth overrides all other authentication settings (authentication is disabled)'
    );
  }

  if (config.disallowUserPassword && !config.enableSSHKeys) {
    logger.warn('--disallow-user-password requires SSH keys, auto-enabling --enable-ssh-keys');
    config.enableSSHKeys = true;
  }

  // Validate HQ registration configuration
  if (config.hqUrl && (!config.hqUsername || !config.hqPassword) && !config.noHqAuth) {
    logger.error('HQ username and password required when --hq-url is specified');
    logger.error('Use --hq-username and --hq-password with --hq-url');
    logger.error('Or use --no-hq-auth for testing without authentication');
    process.exit(1);
  }

  // Validate remote name is provided when registering with HQ
  if (config.hqUrl && !config.remoteName) {
    logger.error('Remote name required when --hq-url is specified');
    logger.error('Use --name to specify a unique name for this remote server');
    process.exit(1);
  }

  // Validate HQ URL is HTTPS unless explicitly allowed
  if (config.hqUrl && !config.hqUrl.startsWith('https://') && !config.allowInsecureHQ) {
    logger.error('HQ URL must use HTTPS protocol');
    logger.error('Use --allow-insecure-hq to allow HTTP for testing');
    process.exit(1);
  }

  // Validate HQ registration configuration
  if (
    (config.hqUrl || config.hqUsername || config.hqPassword) &&
    (!config.hqUrl || !config.hqUsername || !config.hqPassword) &&
    !config.noHqAuth
  ) {
    logger.error('All HQ parameters required: --hq-url, --hq-username, --hq-password');
    logger.error('Or use --no-hq-auth for testing without authentication');
    process.exit(1);
  }

  // Can't be both HQ mode and register with HQ
  if (config.isHQMode && config.hqUrl) {
    logger.error('Cannot use --hq and --hq-url together');
    logger.error('Use --hq to run as HQ server, or --hq-url to register with an HQ');
    process.exit(1);
  }

  // Warn about no-hq-auth
  if (config.noHqAuth && config.hqUrl) {
    logger.warn('--no-hq-auth is enabled: Remote servers can register without authentication');
    logger.warn('This should only be used for testing!');
  }
}

interface AppInstance {
  app: express.Application;
  server: ReturnType<typeof createServer>;
  wss: WebSocketServer;
  startServer: () => void;
  config: Config;
  ptyManager: PtyManager;
  terminalManager: TerminalManager;
  streamWatcher: StreamWatcher;
  remoteRegistry: RemoteRegistry | null;
  hqClient: HQClient | null;
  controlDirWatcher: ControlDirWatcher | null;
  bufferAggregator: BufferAggregator | null;
  activityMonitor: ActivityMonitor;
  pushNotificationService: PushNotificationService | null;
}

// Track if app has been created
let appCreated = false;

export async function createApp(): Promise<AppInstance> {
  // Prevent multiple app instances
  if (appCreated) {
    logger.error('App already created, preventing duplicate instance');
    throw new Error('Duplicate app creation detected');
  }
  appCreated = true;

  const config = parseArgs();

  // Check if help was requested
  if (config.showHelp) {
    showHelp();
    process.exit(0);
  }

  // Check if version was requested
  if (config.showVersion) {
    const versionInfo = getVersionInfo();
    console.log(`VibeTunnel Server v${versionInfo.version}`);
    console.log(`Built: ${versionInfo.buildDate}`);
    console.log(`Platform: ${versionInfo.platform}/${versionInfo.arch}`);
    console.log(`Node: ${versionInfo.nodeVersion}`);
    process.exit(0);
  }

  // Print version banner on startup
  printVersionBanner();

  validateConfig(config);

  logger.log('Initializing VibeTunnel server components');
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  // Add JSON body parser middleware
  app.use(express.json());
  logger.debug('Configured express middleware');

  // Add security headers middleware
  app.use((_req, res, next) => {
    // Detect if we're in Playwright test environment
    // Check multiple conditions to ensure test environment is detected
    const isPlaywrightTest =
      process.env.PLAYWRIGHT_TEST === 'true' ||
      process.env.NODE_ENV === 'test' ||
      config.port === 4022; // Test port from test-config.ts

    // Log once on startup
    if (!app.locals.cspLogged) {
      logger.debug(`PLAYWRIGHT_TEST env var: ${process.env.PLAYWRIGHT_TEST}`);
      logger.debug(`NODE_ENV: ${process.env.NODE_ENV}`);
      logger.debug(`Server port: ${config.port}`);
      logger.debug(
        `CSP mode: ${isPlaywrightTest ? 'test (with unsafe-eval)' : 'production (no unsafe-eval)'}`
      );
      app.locals.cspLogged = true;
    }

    // Content Security Policy to prevent XSS and other injection attacks
    const scriptSrc = isPlaywrightTest
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com; " // Add unsafe-eval for Playwright tests
      : "script-src 'self' 'unsafe-inline' https://unpkg.com; "; // Production CSP without unsafe-eval

    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; " +
        scriptSrc +
        "style-src 'self' 'unsafe-inline'; " + // Allow inline styles
        "img-src 'self' data: blob:; " + // Allow data and blob URLs for images
        "font-src 'self' data:; " + // Allow data URLs for fonts
        "connect-src 'self' ws: wss:; " + // Allow WebSocket connections
        "frame-ancestors 'none'; " + // Prevent clickjacking
        "base-uri 'self'; " + // Restrict base tag usage
        "form-action 'self'" // Restrict form submissions
    );

    // Additional security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    next();
  });
  logger.debug('Configured security headers middleware');

  // Control directory for session data
  const CONTROL_DIR =
    process.env.VIBETUNNEL_CONTROL_DIR || path.join(os.homedir(), '.vibetunnel/control');

  // Ensure control directory exists
  if (!fs.existsSync(CONTROL_DIR)) {
    fs.mkdirSync(CONTROL_DIR, { recursive: true });
    logger.log(chalk.green(`Created control directory: ${CONTROL_DIR}`));
  } else {
    logger.debug(`Using existing control directory: ${CONTROL_DIR}`);
  }

  // Initialize PTY manager
  const ptyManager = new PtyManager(CONTROL_DIR);
  logger.debug('Initialized PTY manager');

  // Initialize Terminal Manager for server-side terminal state
  const terminalManager = new TerminalManager(CONTROL_DIR);
  logger.debug('Initialized terminal manager');

  // Initialize stream watcher for file-based streaming
  const streamWatcher = new StreamWatcher();
  logger.debug('Initialized stream watcher');

  // Initialize activity monitor
  const activityMonitor = new ActivityMonitor(CONTROL_DIR);
  logger.debug('Initialized activity monitor');

  // Initialize push notification services
  let vapidManager: VapidManager | null = null;
  let pushNotificationService: PushNotificationService | null = null;
  let bellEventHandler: BellEventHandler | null = null;

  if (config.pushEnabled) {
    try {
      logger.log('Initializing push notification services');

      // Initialize VAPID manager with auto-generation
      vapidManager = new VapidManager();
      await vapidManager.initialize({
        contactEmail: config.vapidEmail || 'noreply@vibetunnel.local',
        generateIfMissing: true, // Auto-generate keys if none exist
      });

      logger.log('VAPID keys initialized successfully');

      // Initialize push notification service
      pushNotificationService = new PushNotificationService(vapidManager);
      await pushNotificationService.initialize();

      // Initialize bell event handler
      bellEventHandler = new BellEventHandler();
      bellEventHandler.setPushNotificationService(pushNotificationService);

      logger.log(chalk.green('Push notification services initialized'));
    } catch (error) {
      logger.error('Failed to initialize push notification services:', error);
      logger.warn('Continuing without push notifications');
      vapidManager = null;
      pushNotificationService = null;
      bellEventHandler = null;
    }
  } else {
    logger.debug('Push notifications disabled');
  }

  // Initialize HQ components
  let remoteRegistry: RemoteRegistry | null = null;
  let hqClient: HQClient | null = null;
  let controlDirWatcher: ControlDirWatcher | null = null;
  let bufferAggregator: BufferAggregator | null = null;
  let remoteBearerToken: string | null = null;

  if (config.isHQMode) {
    remoteRegistry = new RemoteRegistry();
    logger.log(chalk.green('Running in HQ mode'));
    logger.debug('Initialized remote registry for HQ mode');
  } else if (
    config.hqUrl &&
    config.remoteName &&
    (config.noHqAuth || (config.hqUsername && config.hqPassword))
  ) {
    // Generate bearer token for this remote server
    remoteBearerToken = uuidv4();
    logger.debug(`Generated bearer token for remote server: ${config.remoteName}`);
  }

  // Initialize authentication service
  const authService = new AuthService();
  logger.debug('Initialized authentication service');

  // Initialize buffer aggregator
  bufferAggregator = new BufferAggregator({
    terminalManager,
    remoteRegistry,
    isHQMode: config.isHQMode,
  });
  logger.debug('Initialized buffer aggregator');

  // Initialize WebSocket input handler
  const websocketInputHandler = new WebSocketInputHandler({
    ptyManager,
    terminalManager,
    activityMonitor,
    remoteRegistry,
    authService,
    isHQMode: config.isHQMode,
  });
  logger.debug('Initialized WebSocket input handler');

  // Set up authentication
  const authMiddleware = createAuthMiddleware({
    enableSSHKeys: config.enableSSHKeys,
    disallowUserPassword: config.disallowUserPassword,
    noAuth: config.noAuth,
    isHQMode: config.isHQMode,
    bearerToken: remoteBearerToken || undefined, // Token that HQ must use to auth with us
    authService, // Add enhanced auth service for JWT tokens
    allowLocalBypass: config.allowLocalBypass,
    localAuthToken: config.localAuthToken || undefined,
  });

  // Serve static files with .html extension handling
  const publicPath = path.join(process.cwd(), 'public');
  app.use(
    express.static(publicPath, {
      extensions: ['html'], // This allows /logs to resolve to /logs.html
      setHeaders: (res, path) => {
        // Apply stricter CSP for HTML files
        if (path.endsWith('.html')) {
          const isPlaywrightTest =
            process.env.PLAYWRIGHT_TEST === 'true' ||
            process.env.NODE_ENV === 'test' ||
            config.port === 4022;
          const scriptSrc = isPlaywrightTest
            ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com; "
            : "script-src 'self' 'unsafe-inline' https://unpkg.com; ";

          res.setHeader(
            'Content-Security-Policy',
            "default-src 'self'; " +
              scriptSrc +
              "style-src 'self' 'unsafe-inline'; " +
              "img-src 'self' data: blob:; " +
              "font-src 'self' data:; " +
              "connect-src 'self' ws: wss:; " +
              "frame-ancestors 'none'; " +
              "base-uri 'self'; " +
              "form-action 'self'"
          );
        }
      },
    })
  );
  logger.debug(`Serving static files from: ${publicPath}`);

  // Health check endpoint (no auth required)
  app.get('/api/health', (_req, res) => {
    const versionInfo = getVersionInfo();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      mode: config.isHQMode ? 'hq' : 'remote',
      version: versionInfo.version,
      buildDate: versionInfo.buildDate,
      uptime: versionInfo.uptime,
      pid: versionInfo.pid,
    });
  });

  // Connect bell event handler to PTY manager if push notifications are enabled
  if (bellEventHandler) {
    ptyManager.on('bell', (bellContext) => {
      bellEventHandler.processBellEvent(bellContext).catch((error) => {
        logger.error('Failed to process bell event:', error);
      });
    });
    logger.debug('Connected bell event handler to PTY manager');
  }

  // Mount authentication routes (no auth required)
  app.use(
    '/api/auth',
    createAuthRoutes({
      authService,
      enableSSHKeys: config.enableSSHKeys,
      disallowUserPassword: config.disallowUserPassword,
      noAuth: config.noAuth,
    })
  );
  logger.debug('Mounted authentication routes');

  // Apply auth middleware to all API routes (except auth routes which are handled above)
  app.use('/api', authMiddleware);
  logger.debug('Applied authentication middleware to /api routes');

  // Mount routes
  app.use(
    '/api',
    createSessionRoutes({
      ptyManager,
      terminalManager,
      streamWatcher,
      remoteRegistry,
      isHQMode: config.isHQMode,
      activityMonitor,
    })
  );
  logger.debug('Mounted session routes');

  app.use(
    '/api',
    createRemoteRoutes({
      remoteRegistry,
      isHQMode: config.isHQMode,
    })
  );
  logger.debug('Mounted remote routes');

  // Mount filesystem routes
  app.use('/api', createFilesystemRoutes());
  logger.debug('Mounted filesystem routes');

  // Mount log routes
  app.use('/api', createLogRoutes());
  logger.debug('Mounted log routes');

  // Mount file routes
  app.use('/api', createFileRoutes());
  logger.debug('Mounted file routes');

  // Mount push notification routes
  if (vapidManager) {
    app.use(
      '/api',
      createPushRoutes({
        vapidManager,
        pushNotificationService,
        bellEventHandler: bellEventHandler ?? undefined,
      })
    );
    logger.debug('Mounted push notification routes');
  }

  // Handle WebSocket upgrade with authentication
  server.on('upgrade', async (request, socket, head) => {
    // Parse the URL to extract path and query parameters
    const parsedUrl = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);

    // Handle both /buffers and /ws/input paths
    if (parsedUrl.pathname !== '/buffers' && parsedUrl.pathname !== '/ws/input') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    // Check authentication and capture user info
    const authResult = await new Promise<{
      authenticated: boolean;
      userId?: string;
      authMethod?: string;
    }>((resolve) => {
      // Track if promise has been resolved to prevent multiple resolutions
      let resolved = false;
      const safeResolve = (value: {
        authenticated: boolean;
        userId?: string;
        authMethod?: string;
      }) => {
        if (!resolved) {
          resolved = true;
          resolve(value);
        }
      };

      // Convert URLSearchParams to plain object for query parameters
      const query: Record<string, string> = {};
      parsedUrl.searchParams.forEach((value, key) => {
        query[key] = value;
      });

      // Create a mock Express request/response to use auth middleware
      const req = {
        ...request,
        url: request.url,
        path: parsedUrl.pathname,
        userId: undefined as string | undefined,
        authMethod: undefined as string | undefined,
        query, // Include parsed query parameters for token-based auth
        headers: request.headers,
        ip: (request.socket as unknown as { remoteAddress?: string }).remoteAddress || '',
        socket: request.socket,
        hostname: request.headers.host?.split(':')[0] || 'localhost',
        // Add minimal Express-like methods needed by auth middleware
        get: (header: string) => request.headers[header.toLowerCase()],
        header: (header: string) => request.headers[header.toLowerCase()],
        accepts: () => false,
        acceptsCharsets: () => false,
        acceptsEncodings: () => false,
        acceptsLanguages: () => false,
      } as unknown as AuthenticatedRequest;

      let authFailed = false;
      const res = {
        status: (code: number) => {
          // Only consider it a failure if it's an error status code
          if (code >= 400) {
            authFailed = true;
            safeResolve({ authenticated: false });
          }
          return {
            json: () => {},
            send: () => {},
            end: () => {},
          };
        },
        setHeader: () => {},
        send: () => {},
        json: () => {},
        end: () => {},
      } as unknown as ExpressResponse;

      const next = (error?: unknown) => {
        // Authentication succeeds if next() is called without error and no auth failure was recorded
        const authenticated = !error && !authFailed;
        safeResolve({
          authenticated,
          userId: req.userId,
          authMethod: req.authMethod,
        });
      };

      // Add a timeout to prevent indefinite hanging
      const timeoutId = setTimeout(() => {
        logger.error('WebSocket auth timeout - auth middleware did not complete in time');
        safeResolve({ authenticated: false });
      }, 5000); // 5 second timeout

      // Call authMiddleware and handle potential async errors
      Promise.resolve(authMiddleware(req, res, next))
        .then(() => {
          clearTimeout(timeoutId);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          logger.error('Auth middleware error:', error);
          safeResolve({ authenticated: false });
        });
    });

    if (!authResult.authenticated) {
      logger.debug('WebSocket connection rejected: unauthorized');
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // Handle the upgrade
    wss.handleUpgrade(request, socket, head, (ws) => {
      // Add path and auth information to the request for routing
      const wsRequest = request as WebSocketRequest;
      wsRequest.pathname = parsedUrl.pathname;
      wsRequest.searchParams = parsedUrl.searchParams;
      wsRequest.userId = authResult.userId;
      wsRequest.authMethod = authResult.authMethod;
      wss.emit('connection', ws, wsRequest);
    });
  });

  // WebSocket connection router
  wss.on('connection', (ws, req) => {
    const wsReq = req as WebSocketRequest;
    const pathname = wsReq.pathname;
    const searchParams = wsReq.searchParams;

    if (pathname === '/buffers') {
      // Handle buffer updates WebSocket
      if (bufferAggregator) {
        bufferAggregator.handleClientConnection(ws);
      } else {
        logger.error('BufferAggregator not initialized for WebSocket connection');
        ws.close();
      }
    } else if (pathname === '/ws/input') {
      // Handle input WebSocket
      const sessionId = searchParams?.get('sessionId');

      if (!sessionId) {
        logger.error('WebSocket input connection missing sessionId parameter');
        ws.close();
        return;
      }

      // Extract user ID from the authenticated request
      const userId = wsReq.userId || 'unknown';

      websocketInputHandler.handleConnection(ws, sessionId, userId);
    } else {
      logger.error(`Unknown WebSocket path: ${pathname}`);
      ws.close();
    }
  });

  // Serve index.html for client-side routes (but not API routes)
  app.get('/', (_req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });

  // 404 handler for all other routes
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      res.status(404).json({ error: 'API endpoint not found' });
    } else {
      res.status(404).sendFile(path.join(publicPath, '404.html'), (err) => {
        if (err) {
          res.status(404).send('404 - Page not found');
        }
      });
    }
  });

  // Start server function
  const startServer = () => {
    const requestedPort = config.port !== null ? config.port : Number(process.env.PORT) || 4020;

    logger.log(`Starting server on port ${requestedPort}`);

    // Remove all existing error listeners first to prevent duplicates
    server.removeAllListeners('error');

    // Add error handler for port already in use
    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${requestedPort} is already in use`);

        // Provide more helpful error message in development mode
        const isDevelopment = !process.env.BUILD_DATE || process.env.NODE_ENV === 'development';
        if (isDevelopment) {
          logger.error(chalk.yellow('\nDevelopment mode options:'));
          logger.error(
            `  1. Run server on different port: ${chalk.cyan('pnpm run dev:server --port 4021')}`
          );
          logger.error(`  2. Use environment variable: ${chalk.cyan('PORT=4021 pnpm run dev')}`);
          logger.error(
            '  3. Stop the existing server (check Activity Monitor for vibetunnel processes)'
          );
        } else {
          logger.error(
            'Please use a different port with --port <number> or stop the existing server'
          );
        }
        process.exit(9); // Exit with code 9 to indicate port conflict
      } else {
        logger.error('Server error:', error);
        process.exit(1);
      }
    });

    const bindAddress = config.bind || '0.0.0.0';
    server.listen(requestedPort, bindAddress, () => {
      const address = server.address();
      const actualPort =
        typeof address === 'string' ? requestedPort : address?.port || requestedPort;
      const displayAddress = bindAddress === '0.0.0.0' ? 'localhost' : bindAddress;
      logger.log(
        chalk.green(`VibeTunnel Server running on http://${displayAddress}:${actualPort}`)
      );

      if (config.noAuth) {
        logger.warn(chalk.yellow('Authentication: DISABLED (--no-auth)'));
        logger.warn('Anyone can access this server without authentication');
      } else if (config.disallowUserPassword) {
        logger.log(chalk.green('Authentication: SSH KEYS ONLY (--disallow-user-password)'));
        logger.log(chalk.gray('Password authentication is disabled'));
      } else {
        logger.log(chalk.green('Authentication: SYSTEM USER PASSWORD'));
        if (config.enableSSHKeys) {
          logger.log(chalk.green('SSH Key Authentication: ENABLED'));
        } else {
          logger.log(
            chalk.gray('SSH Key Authentication: DISABLED (use --enable-ssh-keys to enable)')
          );
        }
      }

      // Initialize HQ client now that we know the actual port
      if (
        config.hqUrl &&
        config.remoteName &&
        (config.noHqAuth || (config.hqUsername && config.hqPassword))
      ) {
        const remoteUrl = `http://localhost:${actualPort}`;
        hqClient = new HQClient(
          config.hqUrl,
          config.hqUsername || 'no-auth',
          config.hqPassword || 'no-auth',
          config.remoteName,
          remoteUrl,
          remoteBearerToken || ''
        );
        if (config.noHqAuth) {
          logger.log(
            chalk.yellow(
              `Remote mode: ${config.remoteName} registering WITHOUT HQ authentication (--no-hq-auth)`
            )
          );
        } else {
          logger.log(
            chalk.green(`Remote mode: ${config.remoteName} will accept Bearer token for HQ access`)
          );
          logger.debug(`Bearer token: ${hqClient.getToken()}`);
        }
      }

      // Send message to parent process if running as child (for testing)
      // Skip in vitest environment to avoid channel conflicts
      if (process.send && !process.env.VITEST) {
        process.send({ type: 'server-started', port: actualPort });
      }

      // Register with HQ if configured
      if (hqClient) {
        logger.log(`Registering with HQ at ${config.hqUrl}`);
        hqClient.register().catch((err) => {
          logger.error('Failed to register with HQ:', err);
        });
      }

      // Start control directory watcher
      controlDirWatcher = new ControlDirWatcher({
        controlDir: CONTROL_DIR,
        remoteRegistry,
        isHQMode: config.isHQMode,
        hqClient,
        ptyManager,
      });
      controlDirWatcher.start();
      logger.debug('Started control directory watcher');

      // Start activity monitor
      activityMonitor.start();
      logger.debug('Started activity monitor');
    });
  };

  return {
    app,
    server,
    wss,
    startServer,
    config,
    ptyManager,
    terminalManager,
    streamWatcher,
    remoteRegistry,
    hqClient,
    controlDirWatcher,
    bufferAggregator,
    activityMonitor,
    pushNotificationService,
  };
}

// Track if server has been started
let serverStarted = false;

// Export a function to start the server
export async function startVibeTunnelServer() {
  // Initialize logger if not already initialized (preserves debug mode from CLI)
  initLogger();

  // Prevent multiple server instances
  if (serverStarted) {
    logger.error('Server already started, preventing duplicate instance');
    logger.error('This should not happen - duplicate server startup detected');
    process.exit(1);
  }
  serverStarted = true;

  logger.debug('Creating VibeTunnel application instance');
  // Create and configure the app
  const appInstance = await createApp();
  const {
    startServer,
    server,
    terminalManager,
    remoteRegistry,
    hqClient,
    controlDirWatcher,
    activityMonitor,
    config,
  } = appInstance;

  // Update debug mode based on config or environment variable
  if (config.debug || process.env.DEBUG === 'true') {
    setDebugMode(true);
    logger.log(chalk.gray('Debug logging enabled'));
  }

  startServer();

  // Cleanup old terminals every 5 minutes
  const _terminalCleanupInterval = setInterval(
    () => {
      terminalManager.cleanup(5 * 60 * 1000); // 5 minutes
    },
    5 * 60 * 1000
  );
  logger.debug('Started terminal cleanup interval (5 minutes)');

  // Cleanup inactive push subscriptions every 30 minutes
  let _subscriptionCleanupInterval: NodeJS.Timeout | null = null;
  if (appInstance.pushNotificationService) {
    _subscriptionCleanupInterval = setInterval(
      () => {
        appInstance.pushNotificationService?.cleanupInactiveSubscriptions().catch((error) => {
          logger.error('Failed to cleanup inactive subscriptions:', error);
        });
      },
      30 * 60 * 1000 // 30 minutes
    );
    logger.debug('Started subscription cleanup interval (30 minutes)');
  }

  // Graceful shutdown
  let localShuttingDown = false;

  const shutdown = async () => {
    if (localShuttingDown) {
      logger.warn('Force exit...');
      process.exit(1);
    }

    localShuttingDown = true;
    setShuttingDown(true);
    logger.log(chalk.yellow('\nShutting down...'));

    try {
      // Clear cleanup intervals
      clearInterval(_terminalCleanupInterval);
      if (_subscriptionCleanupInterval) {
        clearInterval(_subscriptionCleanupInterval);
      }
      logger.debug('Cleared cleanup intervals');

      // Stop activity monitor
      activityMonitor.stop();
      logger.debug('Stopped activity monitor');

      // Stop control directory watcher
      if (controlDirWatcher) {
        controlDirWatcher.stop();
        logger.debug('Stopped control directory watcher');
      }

      if (hqClient) {
        logger.debug('Destroying HQ client connection');
        await hqClient.destroy();
      }

      if (remoteRegistry) {
        logger.debug('Destroying remote registry');
        remoteRegistry.destroy();
      }

      server.close(() => {
        logger.log(chalk.green('Server closed successfully'));
        closeLogger();
        process.exit(0);
      });

      // Force exit after 5 seconds if graceful shutdown fails
      setTimeout(() => {
        logger.warn('Graceful shutdown timeout, forcing exit...');
        closeLogger();
        process.exit(1);
      }, 5000);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      closeLogger();
      process.exit(1);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  logger.debug('Registered signal handlers for graceful shutdown');
}

// Export for testing
export * from './version.js';
