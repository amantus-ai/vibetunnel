// VibeTunnel server entry point
import chalk from 'chalk';
import compression from 'compression';
import type { Response as ExpressResponse } from 'express';
import express from 'express';
import * as fs from 'fs';
import helmet from 'helmet';
import type * as http from 'http';
import { createServer } from 'http';
import * as os from 'os';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { WebSocketServer } from 'ws';
import { ServerEventType } from '../shared/types.js';
import { apiSocketServer } from './api-socket-server.js';
import type { AuthenticatedRequest } from './middleware/auth.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { PtyManager } from './pty/index.js';
import { createAuthRoutes } from './routes/auth.js';
import { createConfigRoutes } from './routes/config.js';
import { createFileRoutes } from './routes/files.js';
import { createFilesystemRoutes } from './routes/filesystem.js';
import { createGitRoutes } from './routes/git.js';
import { createLogRoutes } from './routes/logs.js';
import { createMultiplexerRoutes } from './routes/multiplexer.js';
import { createPushRoutes } from './routes/push.js';
import { createRemoteRoutes } from './routes/remotes.js';
import { createRepositoryRoutes } from './routes/repositories.js';
import { createSessionRoutes } from './routes/sessions.js';
import { createTestNotificationRouter } from './routes/test-notification.js';
import { createTmuxRoutes } from './routes/tmux.js';
import { createWorktreeRoutes } from './routes/worktrees.js';
import { AuthService } from './services/auth-service.js';
import { CastOutputHub } from './services/cast-output-hub.js';
import { CloudflareService } from './services/cloudflare-service.js';
import { ConfigService } from './services/config-service.js';
import { ControlDirWatcher } from './services/control-dir-watcher.js';
import { GitStatusHub } from './services/git-status-hub.js';
import { HQClient } from './services/hq-client.js';
import { mdnsService } from './services/mdns-service.js';
import { NgrokService } from './services/ngrok-service.js';
import { PushNotificationService } from './services/push-notification-service.js';
import { RemoteRegistry } from './services/remote-registry.js';
import { SessionMonitor } from './services/session-monitor.js';
import { tailscaleServeService } from './services/tailscale-serve-service.js';
import { TerminalManager } from './services/terminal-manager.js';
import { WsV3Hub } from './services/ws-v3-hub.js';
import { closeLogger, createLogger, initLogger, setDebugMode } from './utils/logger.js';
import { VapidManager } from './utils/vapid-manager.js';
import { getVersionInfo, printVersionBanner } from './version.js';
import { controlUnixHandler } from './websocket/control-unix-handler.js';

// Extended WebSocket request with authentication and routing info
interface WebSocketRequest extends http.IncomingMessage {
  pathname?: string;
  searchParams?: URLSearchParams;
  userId?: string;
  authMethod?: string;
}

interface TailscaleConnectionInfo {
  available: boolean;
  isRunning: boolean;
  httpsAvailable: boolean;
  isPublic: boolean;
  funnel: boolean;
  mode: string;
  hostname?: string;
  httpsUrl?: string;
}

interface ConnectionInfo {
  http: {
    port: number | null;
    url: string;
  };
  port: number | null;
  tailscale?: TailscaleConnectionInfo;
  sslAvailable?: boolean;
  isPublic?: boolean;
  tailscaleUrl?: string;
}

interface GlobalTunnelState {
  __ngrokService?: NgrokService;
  __cloudflareService?: CloudflareService;
}

const globalTunnelState = global as typeof global & GlobalTunnelState;

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
  // Tailscale Serve integration (manages auth and proxy)
  enableTailscaleServe: boolean;
  // Tailscale Funnel integration (public internet access)
  enableTailscaleFunnel: boolean;
  // HQ auth bypass for testing
  noHqAuth: boolean;
  // mDNS advertisement
  enableMDNS: boolean;
  // Ngrok tunnel configuration
  enableNgrok: boolean;
  ngrokAuthToken: string | null;
  ngrokDomain: string | null;
  ngrokRegion: string | null;
  // Cloudflare tunnel configuration
  enableCloudflare: boolean;
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
  --enable-tailscale-serve  Enable Tailscale Serve integration (auto-manages proxy and auth)
  --enable-tailscale-funnel Enable Tailscale Funnel for public internet access (requires --enable-tailscale-serve)
  --debug               Enable debug logging

Push Notification Options:
  --push-enabled        Enable push notifications (default: enabled)
  --push-disabled       Disable push notifications
  --vapid-email <email> Contact email for VAPID (or PUSH_CONTACT_EMAIL env var)
  --generate-vapid-keys Generate new VAPID keys if none exist

Network Discovery Options:
  --no-mdns             Disable mDNS/Bonjour advertisement (enabled by default)

Tunnel Options:
  --ngrok               Enable ngrok tunnel for remote access
  --ngrok-auth <token>  Ngrok authentication token
  --ngrok-domain <dom>  Custom ngrok domain (requires paid plan)
  --ngrok-region <reg>  Ngrok region (us, eu, ap, au, sa, jp, in)
  --cloudflare          Enable Cloudflare tunnel (Quick Tunnel)

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
  NGROK_AUTHTOKEN       Ngrok auth token (used with --ngrok)

Examples:
  # Run a simple server with authentication
  vibetunnel-server --username admin --password secret

  # Run with ngrok tunnel (no auth)
  vibetunnel-server --no-auth --ngrok

  # Run with Cloudflare tunnel
  vibetunnel-server --no-auth --cloudflare

  # Run with ngrok and custom domain
  vibetunnel-server --ngrok --ngrok-auth TOKEN --ngrok-domain custom.ngrok.io

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
  const envNgrokAuthToken = process.env.NGROK_AUTHTOKEN?.trim() || null;
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
    // Tailscale Serve integration (manages auth and proxy)
    enableTailscaleServe: false,
    // Tailscale Funnel integration (public internet access)
    enableTailscaleFunnel: false,
    // HQ auth bypass for testing
    noHqAuth: false,
    // mDNS advertisement
    enableMDNS: true, // Enable mDNS by default
    // Ngrok tunnel configuration
    enableNgrok: false,
    ngrokAuthToken: envNgrokAuthToken as string | null,
    ngrokDomain: null as string | null,
    ngrokRegion: null as string | null,
    // Cloudflare tunnel configuration
    enableCloudflare: false,
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
    } else if (args[i] === '--enable-tailscale-serve') {
      config.enableTailscaleServe = true;
    } else if (args[i] === '--enable-tailscale-funnel') {
      config.enableTailscaleFunnel = true;
    } else if (args[i] === '--no-hq-auth') {
      config.noHqAuth = true;
    } else if (args[i] === '--no-mdns') {
      config.enableMDNS = false;
    } else if (args[i] === '--ngrok') {
      config.enableNgrok = true;
    } else if (args[i] === '--ngrok-auth' && i + 1 < args.length) {
      config.ngrokAuthToken = args[i + 1];
      config.enableNgrok = true;
      i++; // Skip the token value in next iteration
    } else if (args[i] === '--ngrok-domain' && i + 1 < args.length) {
      config.ngrokDomain = args[i + 1];
      config.enableNgrok = true;
      i++; // Skip the domain value in next iteration
    } else if (args[i] === '--ngrok-region' && i + 1 < args.length) {
      config.ngrokRegion = args[i + 1];
      config.enableNgrok = true;
      i++; // Skip the region value in next iteration
    } else if (args[i] === '--cloudflare') {
      config.enableCloudflare = true;
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

  // Note: Tailscale Serve configuration is handled by the Mac app
  // The Mac app will restart with appropriate binding if Tailscale Serve fails
  if (config.enableTailscaleServe) {
    logger.info('Tailscale Serve integration enabled - Mac app will handle fallback if needed');
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
  configService: ConfigService;
  ptyManager: PtyManager;
  terminalManager: TerminalManager;
  remoteRegistry: RemoteRegistry | null;
  hqClient: HQClient | null;
  controlDirWatcher: ControlDirWatcher | null;
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
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: true });

  // Add security headers with Helmet
  app.use(
    helmet({
      contentSecurityPolicy: false, // We handle CSP ourselves for the web terminal
      crossOriginEmbedderPolicy: false, // Allow embedding in iframes for integrations
    })
  );
  logger.debug('Configured security headers with helmet');

  // Add compression middleware with Brotli support
  app.use(
    compression({
      // Enable Brotli compression with highest priority
      level: 6, // Balanced compression level
    })
  );
  logger.debug('Configured compression middleware');

  // Add JSON body parser middleware with size limit
  app.use(express.json({ limit: '10mb' }));
  logger.debug('Configured express middleware');

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

  // Initialize PTY manager with fallback support
  await PtyManager.initialize();
  const ptyManager = new PtyManager(CONTROL_DIR);
  logger.debug('Initialized PTY manager');

  // Clean up sessions from old VibeTunnel versions
  const sessionManager = ptyManager.getSessionManager();
  const cleanupResult = sessionManager.cleanupOldVersionSessions();
  if (cleanupResult.versionChanged) {
    logger.log(
      chalk.yellow(
        `Version change detected - cleaned up ${cleanupResult.cleanedCount} sessions from previous version`
      )
    );
  } else if (cleanupResult.cleanedCount > 0) {
    logger.log(
      chalk.yellow(
        `Cleaned up ${cleanupResult.cleanedCount} legacy sessions without version information`
      )
    );
  }

  // Initialize Terminal Manager for server-side terminal state
  const terminalManager = new TerminalManager(CONTROL_DIR);
  logger.debug('Initialized terminal manager');

  // Initialize cast output hub + git status hub for WebSocket v3
  const castOutputHub = new CastOutputHub(sessionManager);
  const gitStatusHub = new GitStatusHub();
  logger.debug('Initialized v3 cast output + git status hubs');

  // Initialize session monitor with PTY manager
  const sessionMonitor = new SessionMonitor(ptyManager);
  await sessionMonitor.initialize();

  // Set the session monitor on PTY manager for data tracking
  ptyManager.setSessionMonitor(sessionMonitor);
  logger.debug('Initialized session monitor');

  // Initialize configuration service
  const configService = new ConfigService();
  configService.startWatching();
  logger.debug('Initialized configuration service');

  // Initialize push notification services
  let vapidManager: VapidManager | null = null;
  let pushNotificationService: PushNotificationService | null = null;

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

      logger.log(chalk.green('Push notification services initialized'));
    } catch (error) {
      logger.error('Failed to initialize push notification services:', error);
      logger.warn('Continuing without push notifications');
      vapidManager = null;
      pushNotificationService = null;
    }
  } else {
    logger.debug('Push notifications disabled');
  }

  // Connect SessionMonitor to push notification service
  if (sessionMonitor && pushNotificationService) {
    logger.info('Connecting SessionMonitor to push notification service');

    // Listen for session monitor notifications and send push notifications
    sessionMonitor.on('notification', async (event) => {
      try {
        // Map event types to push notification data
        let pushPayload = null;

        switch (event.type) {
          case ServerEventType.SessionStart:
            pushPayload = {
              type: 'session-start',
              title: '🚀 Session Started',
              body: event.sessionName || 'Terminal Session',
            };
            break;

          case ServerEventType.SessionExit:
            pushPayload = {
              type: 'session-exit',
              title: '🏁 Session Ended',
              body: event.sessionName || 'Terminal Session',
              data: { exitCode: event.exitCode },
            };
            break;

          case ServerEventType.CommandFinished:
            pushPayload = {
              type: 'command-finished',
              title: '✅ Your Turn',
              body: event.command || 'Command completed',
              data: { duration: event.duration },
            };
            break;

          case ServerEventType.CommandError:
            pushPayload = {
              type: 'command-error',
              title: '❌ Command Failed',
              body: event.command || 'Command failed',
              data: { exitCode: event.exitCode },
            };
            break;

          case ServerEventType.Bell:
            pushPayload = {
              type: 'bell',
              title: '🔔 Terminal Bell',
              body: event.sessionName || 'Terminal',
            };
            break;

          case ServerEventType.TestNotification:
            // Test notifications are already handled by the test endpoint
            return;

          default:
            return; // Skip unknown event types
        }

        if (pushPayload) {
          // Send push notification
          const result = await pushNotificationService.sendNotification({
            ...pushPayload,
            icon: '/apple-touch-icon.png',
            badge: '/favicon-32.png',
            tag: `vibetunnel-${pushPayload.type}`,
            requireInteraction: pushPayload.type === 'command-error',
            actions: [
              {
                action: 'view-session',
                title: 'View Session',
              },
              {
                action: 'dismiss',
                title: 'Dismiss',
              },
            ],
            data: {
              ...pushPayload.data,
              type: pushPayload.type,
              sessionId: event.sessionId,
              timestamp: event.timestamp,
            },
          });

          logger.debug(
            `Push notification sent for ${event.type}: ${result.sent} successful, ${result.failed} failed`
          );
        }
      } catch (error) {
        logger.error('Failed to send push notification for SessionMonitor event:', error);
      }
    });
  }

  // Initialize HQ components
  let remoteRegistry: RemoteRegistry | null = null;
  let hqClient: HQClient | null = null;
  let controlDirWatcher: ControlDirWatcher | null = null;
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

  // Initialize v3 WebSocket hub (single-socket terminal transport)
  const wsV3Hub = new WsV3Hub({
    ptyManager,
    terminalManager,
    castOutputHub,
    gitStatusHub,
    sessionMonitor,
    remoteRegistry,
    isHQMode: config.isHQMode,
  });
  logger.debug('Initialized WebSocket v3 hub');

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
    allowTailscaleAuth: config.enableTailscaleServe,
  });

  // Serve static files with .html extension handling and caching headers
  // In production/bundled mode, use the package directory; in development, use cwd
  const getPublicPath = () => {
    // First check if BUILD_PUBLIC_PATH is set (used by Mac app bundle)
    if (process.env.BUILD_PUBLIC_PATH) {
      logger.info(`Using BUILD_PUBLIC_PATH: ${process.env.BUILD_PUBLIC_PATH}`);
      return process.env.BUILD_PUBLIC_PATH;
    }
    // More precise npm package detection:
    // 1. Check if we're explicitly in an npm package structure
    // 2. The file should be in node_modules/vibetunnel/lib/
    // 3. Or check for our specific package markers
    const isNpmPackage = (() => {
      // Most reliable: check if we're in node_modules/vibetunnel structure
      if (__filename.includes(path.join('node_modules', 'vibetunnel', 'lib'))) {
        return true;
      }

      // Check for Windows path variant
      if (__filename.includes('node_modules\\vibetunnel\\lib')) {
        return true;
      }

      // Secondary check: if we're in a lib directory, verify it's actually an npm package
      // by checking for the existence of package.json in the parent directory
      if (path.basename(__dirname) === 'lib') {
        const parentDir = path.dirname(__dirname);
        const packageJsonPath = path.join(parentDir, 'package.json');
        try {
          const packageJson = require(packageJsonPath);
          // Verify this is actually our package
          return packageJson.name === 'vibetunnel';
        } catch {
          // Not a valid npm package structure
          return false;
        }
      }

      return false;
    })();

    if (process.env.VIBETUNNEL_BUNDLED === 'true' || process.env.BUILD_DATE || isNpmPackage) {
      // In bundled/production/npm mode, find package root
      // When bundled, __dirname is /path/to/package/dist, so go up one level
      // When globally installed, we need to find the package root
      let packageRoot = __dirname;

      // If we're in the dist directory, go up one level
      if (path.basename(packageRoot) === 'dist') {
        packageRoot = path.dirname(packageRoot);
      }

      // For npm package context, if we're in lib directory, go up one level
      if (path.basename(packageRoot) === 'lib') {
        packageRoot = path.dirname(packageRoot);
      }

      // Look for package.json to confirm we're in the right place
      const publicPath = path.join(packageRoot, 'public');
      const indexPath = path.join(publicPath, 'index.html');

      // If index.html exists, we found the right path
      if (require('fs').existsSync(indexPath)) {
        return publicPath;
      }

      // Fallback: try going up from the bundled CLI location
      // The bundled CLI might be in node_modules/vibetunnel/dist/
      return path.join(__dirname, '..', 'public');
    } else {
      // In development mode, use current working directory
      return path.join(process.cwd(), 'public');
    }
  };

  const publicPath = getPublicPath();
  const isDevelopment = !process.env.BUILD_DATE || process.env.NODE_ENV === 'development';

  app.use(
    express.static(publicPath, {
      extensions: ['html'], // This allows /logs to resolve to /logs.html
      maxAge: isDevelopment ? 0 : '1d', // No cache in dev, 1 day in production
      etag: !isDevelopment, // Disable ETag in development
      lastModified: !isDevelopment, // Disable Last-Modified in development
      setHeaders: (res, filePath) => {
        if (isDevelopment) {
          // Disable all caching in development
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        } else {
          // Production caching rules
          // Set longer cache for immutable assets
          if (filePath.match(/\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico)$/)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
          // Shorter cache for HTML files
          else if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'public, max-age=3600'); // 1 hour
          }
        }
      },
    })
  );
  logger.debug(
    `Serving static files from: ${publicPath} ${isDevelopment ? 'with caching disabled (dev mode)' : 'with caching headers'}`
  );

  // Health check endpoint (no auth required)
  app.get('/api/health', async (_req, res) => {
    const versionInfo = getVersionInfo();

    // Get connection information
    const connections: ConnectionInfo = {
      http: {
        port: config.port,
        url: `http://localhost:${config.port}`,
      },
      // Legacy fields for older clients
      port: config.port,
    };

    let responseTailscaleUrl: string | undefined;

    // Check if Tailscale is enabled and get status
    if (config.enableTailscaleServe) {
      try {
        const tailscaleStatus = await tailscaleServeService.getStatus();

        // Get Tailscale hostname if available
        let tailscaleHostname: string | undefined;
        let tailscaleUrl: string | undefined;

        if (tailscaleStatus.isRunning && !tailscaleStatus.isPermanentlyDisabled) {
          try {
            // Get Tailscale hostname from status
            const { execSync } = await import('child_process');
            const statusJson = execSync('tailscale status --json', { encoding: 'utf8' });
            const status = JSON.parse(statusJson);

            if (status.Self?.DNSName) {
              // Remove trailing dot from DNS name
              tailscaleHostname = status.Self.DNSName.replace(/\.$/, '');
              tailscaleUrl = `https://${tailscaleHostname}`;
              logger.debug(`Tailscale hostname detected: ${tailscaleHostname}`);
            }
          } catch (error) {
            logger.debug('Failed to get Tailscale hostname:', error);
          }
        }

        // HTTPS is only available when Funnel (public mode) is enabled
        // In private mode, HTTPS doesn't work from mobile devices due to self-signed certs
        const httpsActuallyAvailable =
          tailscaleStatus.isRunning &&
          !tailscaleStatus.isPermanentlyDisabled &&
          (tailscaleStatus.funnelEnabled || false);
        const tailscaleAvailable =
          tailscaleStatus.isRunning && !tailscaleStatus.isPermanentlyDisabled;

        connections.tailscale = {
          available: tailscaleAvailable,
          isRunning: tailscaleStatus.isRunning,
          httpsAvailable: httpsActuallyAvailable,
          isPublic: tailscaleStatus.funnelEnabled || false,
          funnel: tailscaleStatus.funnelEnabled || false,
          mode: tailscaleStatus.actualMode || 'private',
          hostname: tailscaleHostname,
          httpsUrl: httpsActuallyAvailable ? tailscaleUrl : undefined,
        };
        connections.sslAvailable = httpsActuallyAvailable;
        connections.isPublic = tailscaleStatus.funnelEnabled || false;

        // Add the HTTPS URL at the top level for easy access only if actually available
        if (httpsActuallyAvailable && tailscaleUrl) {
          connections.tailscaleUrl = tailscaleUrl;
          responseTailscaleUrl = tailscaleUrl;
        }
      } catch (error) {
        logger.debug('Failed to get Tailscale status for health endpoint:', error);
        connections.tailscale = {
          available: false,
          isRunning: false,
          httpsAvailable: false,
          isPublic: false,
          funnel: false,
          mode: 'private',
        };
        connections.sslAvailable = false;
        connections.isPublic = false;
      }
    } else {
      connections.sslAvailable = false;
      connections.isPublic = false;
    }

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      mode: config.isHQMode ? 'hq' : 'remote',
      version: versionInfo.version,
      buildDate: versionInfo.buildDate,
      uptime: versionInfo.uptime,
      pid: versionInfo.pid,
      connections,
      ...(responseTailscaleUrl ? { tailscaleUrl: responseTailscaleUrl } : {}),
    });
  });

  // Connect session exit notifications if push notifications are enabled
  if (pushNotificationService) {
    ptyManager.on('sessionExited', (sessionId: string) => {
      // Load session info to get details
      const sessionInfo = sessionManager.loadSessionInfo(sessionId);
      const exitCode = sessionInfo?.exitCode ?? 0;
      const sessionName = sessionInfo?.name || `Session ${sessionId}`;

      // Determine notification type based on exit code
      const notificationType = exitCode === 0 ? 'session-exit' : 'session-error';
      const title = exitCode === 0 ? 'Session Ended' : 'Session Ended with Errors';
      const body =
        exitCode === 0
          ? `${sessionName} has finished.`
          : `${sessionName} exited with code ${exitCode}.`;

      pushNotificationService
        .sendNotification({
          type: notificationType,
          title,
          body,
          icon: '/apple-touch-icon.png',
          badge: '/favicon-32.png',
          tag: `vibetunnel-${notificationType}-${sessionId}`,
          requireInteraction: false,
          data: {
            type: notificationType,
            sessionId,
            sessionName,
            exitCode,
            timestamp: new Date().toISOString(),
          },
          actions: [
            { action: 'view-logs', title: 'View Logs' },
            { action: 'dismiss', title: 'Dismiss' },
          ],
        })
        .catch((error) => {
          logger.error('Failed to send session exit notification:', error);
        });
    });
    logger.debug('Connected session exit notifications to PTY manager');

    // Connect command finished notifications
    ptyManager.on('commandFinished', ({ sessionId, command, exitCode, duration, timestamp }) => {
      const isClaudeCommand = command.toLowerCase().includes('claude');

      // Enhanced logging for Claude commands
      if (isClaudeCommand) {
        logger.log(
          chalk.magenta(
            `📬 Server received Claude commandFinished event: sessionId=${sessionId}, command="${command}", exitCode=${exitCode}, duration=${duration}ms`
          )
        );
      } else {
        logger.debug(
          `Server received commandFinished event for session ${sessionId}: "${command}"`
        );
      }

      // Determine notification type based on exit code
      const notificationType = exitCode === 0 ? 'command-finished' : 'command-error';
      const title = exitCode === 0 ? 'Command Completed' : 'Command Failed';
      const body =
        exitCode === 0
          ? `${command} completed successfully`
          : `${command} failed with exit code ${exitCode}`;

      // Format duration for display
      const durationStr =
        duration > 60000
          ? `${Math.round(duration / 60000)}m ${Math.round((duration % 60000) / 1000)}s`
          : `${Math.round(duration / 1000)}s`;

      logger.debug(
        `Sending push notification: type=${notificationType}, title="${title}", body="${body} (${durationStr})"`
      );

      pushNotificationService
        .sendNotification({
          type: notificationType,
          title,
          body: `${body} (${durationStr})`,
          icon: '/apple-touch-icon.png',
          badge: '/favicon-32.png',
          tag: `vibetunnel-command-${sessionId}-${Date.now()}`,
          requireInteraction: false,
          data: {
            type: notificationType,
            sessionId,
            command,
            exitCode,
            duration,
            timestamp,
          },
          actions: [
            { action: 'view-session', title: 'View Session' },
            { action: 'dismiss', title: 'Dismiss' },
          ],
        })
        .catch((error) => {
          logger.error('Failed to send command finished notification:', error);
        });
    });
    logger.debug('Connected command finished notifications to PTY manager');
  }

  // Apply auth middleware to all API routes (including auth routes for Tailscale header detection)
  app.use('/api', authMiddleware);
  logger.debug('Applied authentication middleware to /api routes');

  // Mount authentication routes (auth middleware will skip these but still check Tailscale headers)
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

  // Mount routes
  app.use(
    '/api',
    createSessionRoutes({
      ptyManager,
      terminalManager,
      remoteRegistry,
      isHQMode: config.isHQMode,
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

  // Mount repository routes
  app.use('/api', createRepositoryRoutes());
  logger.debug('Mounted repository routes');

  // Mount config routes
  app.use(
    '/api',
    createConfigRoutes({
      configService,
    })
  );
  logger.debug('Mounted config routes');

  // Mount Git routes
  app.use('/api', createGitRoutes());
  logger.debug('Mounted Git routes');

  // Mount worktree routes
  app.use('/api', createWorktreeRoutes());
  logger.debug('Mounted worktree routes');

  // Mount tmux routes
  app.use('/api/tmux', createTmuxRoutes({ ptyManager }));
  logger.debug('Mounted tmux routes');

  // Mount multiplexer routes (unified tmux/zellij interface)
  app.use('/api/multiplexer', createMultiplexerRoutes({ ptyManager }));
  logger.debug('Mounted multiplexer routes');

  // Mount push notification routes - always mount even if VAPID is not initialized
  // This ensures proper error responses instead of 404s
  app.use(
    '/api',
    createPushRoutes({
      vapidManager: vapidManager || new VapidManager(), // Pass a dummy instance if null
      pushNotificationService,
      sessionMonitor,
    })
  );
  logger.debug('Mounted push notification routes');

  // Mount test notification router
  app.use('/api', createTestNotificationRouter({ sessionMonitor, pushNotificationService }));
  logger.debug('Mounted test notification routes');

  // Initialize control socket
  try {
    await controlUnixHandler.start();
    logger.log(chalk.green('Control UNIX socket: READY'));
  } catch (error) {
    logger.error('Failed to initialize control socket:', error);
    logger.warn('Mac control features will not be available.');
    // Depending on the desired behavior, you might want to exit here
    // For now, we'll let the server continue without these features.
  }

  // Initialize API socket for CLI commands
  try {
    await apiSocketServer.start();
    logger.log(chalk.green('API socket server: READY'));
  } catch (error) {
    logger.error('Failed to initialize API socket server:', error);
    logger.warn('vt commands will not work via socket.');
  }

  // Handle WebSocket upgrade with authentication
  server.on('upgrade', async (request, socket, head) => {
    // Parse the URL to extract path and query parameters
    const parsedUrl = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);

    // Handle WebSocket paths
    if (parsedUrl.pathname !== '/ws') {
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

    logger.log(`🔌 WebSocket connection to path: ${pathname}`);
    logger.log(`👤 User ID: ${wsReq.userId || 'unknown'}`);
    logger.log(`🔐 Auth method: ${wsReq.authMethod || 'unknown'}`);

    if (pathname === '/ws') {
      logger.log('🧩 Handling v3 WebSocket connection');
      wsV3Hub.handleClientConnection(ws, wsReq);
    } else {
      logger.error(`❌ Unknown WebSocket path: ${pathname}`);
      ws.close();
    }
  });

  // Serve index.html for client-side routes (but not API routes)
  app.get('/', (_req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });

  // Handle /session/:id routes by serving the same index.html
  app.get('/session/:id', (_req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });

  // Handle /worktrees route by serving the same index.html
  app.get('/worktrees', (_req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });

  // Handle /file-browser route by serving the same index.html
  app.get('/file-browser', (_req, res) => {
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

    // Regular TCP mode
    logger.log(`Starting server on port ${requestedPort}`);
    // Use the requested bind address - don't force localhost just because Tailscale is enabled
    // The Mac app will handle binding logic based on actual Tailscale Serve status
    const bindAddress = config.bind || '0.0.0.0';
    server.listen(requestedPort, bindAddress, () => {
      const address = server.address();
      const actualPort =
        typeof address === 'string' ? requestedPort : address?.port || requestedPort;
      const displayAddress = bindAddress === '0.0.0.0' ? 'localhost' : bindAddress;
      logger.log(
        chalk.green(`VibeTunnel Server running on http://${displayAddress}:${actualPort}`)
      );

      // Update API socket server with actual port information
      apiSocketServer.setServerInfo(actualPort, `http://${displayAddress}:${actualPort}`);

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

      // Validate Tailscale configuration
      if (config.enableTailscaleFunnel && !config.enableTailscaleServe) {
        logger.error('Tailscale Funnel requires Tailscale Serve to be enabled');
        process.exit(1);
      }

      // Start Tailscale Serve if requested
      if (config.enableTailscaleServe) {
        logger.info(chalk.blue('Starting Tailscale Serve integration...'));

        tailscaleServeService
          .start(actualPort, config.enableTailscaleFunnel)
          .then(() => {
            logger.info(chalk.green('Tailscale Serve: ENABLED'));
            if (config.enableTailscaleFunnel) {
              logger.warn(chalk.yellow('Tailscale Funnel: ENABLED - PUBLIC INTERNET ACCESS'));
            }
            logger.info(
              chalk.gray('Users will be auto-authenticated via Tailscale identity headers')
            );
            logger.info(
              chalk.gray(
                `Access via HTTPS on your Tailscale hostname (e.g., https://hostname.tailnet.ts.net)`
              )
            );
          })
          .catch((error) => {
            logger.error(chalk.red('❌ Failed to start Tailscale Serve:'), error.message);
            logger.warn(
              chalk.yellow(
                '⚠️ VibeTunnel will continue running, but Tailscale Serve is not available'
              )
            );
            logger.info(chalk.blue('💻 You can manually configure Tailscale Serve with:'));
            logger.info(chalk.gray(`  tailscale serve ${actualPort}`));
          });
      }

      // Start ngrok tunnel if requested
      if (config.enableNgrok) {
        logger.log(chalk.blue('Starting ngrok tunnel...'));

        const ngrokService = new NgrokService({
          port: actualPort,
          authToken: config.ngrokAuthToken || undefined,
          domain: config.ngrokDomain || undefined,
          region: config.ngrokRegion || undefined,
        });
        globalTunnelState.__ngrokService = ngrokService;

        ngrokService
          .start()
          .then((tunnel) => {
            logger.log(chalk.green('Ngrok tunnel: ENABLED'));
            logger.log(chalk.green(`Public URL: ${tunnel.publicUrl}`));
            logger.log(chalk.gray('Your VibeTunnel server is now accessible from the internet'));
          })
          .catch((error) => {
            logger.error(chalk.red('Failed to start ngrok tunnel:'), error.message);
            logger.warn(
              chalk.yellow(
                'VibeTunnel will continue running locally, but ngrok tunnel is not available'
              )
            );
            if (!config.ngrokAuthToken) {
              logger.log(
                chalk.blue('Tip: Set an auth token with --ngrok-auth for better reliability')
              );
            }
          });
      }

      // Start Cloudflare tunnel if requested
      if (config.enableCloudflare) {
        logger.log(chalk.blue('Starting Cloudflare tunnel...'));

        const cloudflareService = new CloudflareService(actualPort);
        globalTunnelState.__cloudflareService = cloudflareService;

        cloudflareService
          .start()
          .then((tunnel) => {
            logger.log(chalk.green('Cloudflare tunnel: ENABLED'));
            logger.log(chalk.green(`Public URL: ${tunnel.publicUrl}`));
            logger.log(chalk.gray('Your VibeTunnel server is now accessible from the internet'));
            logger.log(chalk.gray('Note: Cloudflare Quick Tunnels have usage limits'));
          })
          .catch((error) => {
            logger.error(chalk.red('Failed to start Cloudflare tunnel:'), error.message);
            logger.warn(
              chalk.yellow(
                'VibeTunnel will continue running locally, but Cloudflare tunnel is not available'
              )
            );
            logger.log(
              chalk.blue(
                'Install cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/'
              )
            );
          });
      }

      // Log local bypass status
      if (config.allowLocalBypass) {
        logger.log(chalk.yellow('Local Bypass: ENABLED'));
        if (config.localAuthToken) {
          logger.log(chalk.gray('Local connections require auth token'));
        } else {
          logger.log(chalk.gray('Local connections bypass authentication without token'));
        }
      }

      // Initialize HQ client now that we know the actual port
      if (
        config.hqUrl &&
        config.remoteName &&
        (config.noHqAuth || (config.hqUsername && config.hqPassword))
      ) {
        // Use the actual bind address for HQ registration
        // If bind is 0.0.0.0, we need to determine the actual network interface IP
        let remoteHost = bindAddress;
        if (bindAddress === '0.0.0.0') {
          // When binding to all interfaces, use the machine's hostname
          // This allows HQ to connect from the network
          remoteHost = os.hostname();
        }
        const remoteUrl = `http://${remoteHost}:${actualPort}`;
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
        pushNotificationService: pushNotificationService || undefined,
      });
      controlDirWatcher.start();
      logger.debug('Started control directory watcher');

      // Start mDNS advertisement if enabled
      if (config.enableMDNS) {
        mdnsService.startAdvertising(actualPort).catch((err) => {
          logger.warn('Failed to start mDNS advertisement:', err);
        });
      } else {
        logger.debug('mDNS advertisement disabled');
      }
    });
  };

  return {
    app,
    server,
    wss,
    startServer,
    config,
    configService,
    ptyManager,
    terminalManager,
    remoteRegistry,
    hqClient,
    controlDirWatcher,
    pushNotificationService,
  };
}

// Track if server has been started
let serverStarted = false;

// Export a function to start the server
export async function startVibeTunnelServer() {
  // Initialize logger if not already initialized (preserves debug mode from CLI)
  initLogger();

  // Log diagnostic info if debug mode
  if (process.env.DEBUG === 'true' || process.argv.includes('--debug')) {
  }

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
    config,
    configService,
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

      // Stop configuration service watcher
      configService.stopWatching();
      logger.debug('Stopped configuration service watcher');

      // Stop mDNS advertisement if it was started
      if (mdnsService.isActive()) {
        await mdnsService.stopAdvertising();
        logger.debug('Stopped mDNS advertisement');
      }

      // Stop Tailscale Serve if it was started
      if (config.enableTailscaleServe && tailscaleServeService.isRunning()) {
        logger.log('Stopping Tailscale Serve...');
        await tailscaleServeService.stop();
        logger.debug('Stopped Tailscale Serve service');
      }

      // Stop ngrok tunnel if it was started
      const ngrokService = globalTunnelState.__ngrokService;
      if (ngrokService?.isActive()) {
        logger.log('Stopping ngrok tunnel...');
        await ngrokService.stop();
        logger.debug('Stopped ngrok tunnel');
      }

      // Stop Cloudflare tunnel if it was started
      const cloudflareService = globalTunnelState.__cloudflareService;
      if (cloudflareService?.isActive()) {
        logger.log('Stopping Cloudflare tunnel...');
        await cloudflareService.stop();
        logger.debug('Stopped Cloudflare tunnel');
      }

      // Stop control directory watcher
      if (controlDirWatcher) {
        controlDirWatcher.stop();
        logger.debug('Stopped control directory watcher');
      }

      // Stop UNIX socket server
      try {
        const { controlUnixHandler } = await import('./websocket/control-unix-handler.js');
        controlUnixHandler.stop();
        logger.debug('Stopped UNIX socket server');
      } catch (_error) {
        // Ignore if module not loaded
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
