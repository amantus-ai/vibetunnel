import { type ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { testLogger } from './test-logger';

/**
 * Configuration options for starting a test server
 */
export interface ServerConfig {
  /** Server arguments (e.g., ['--port', '0', '--no-auth']) */
  args?: string[];
  /** Environment variables to pass to the server */
  env?: Record<string, string>;
  /** Control directory path. If not provided, a temporary directory will be created */
  controlDir?: string;
  /** Whether to use pnpm exec tsx or direct tsx command */
  usePnpm?: boolean;
  /** Timeout for waiting for server to start (in ms) */
  timeout?: number;
  /** Whether to log server output */
  logOutput?: boolean;
  /** Server type for logging context */
  serverType?: string;
  /** Whether to wait for health check after port detection */
  waitForHealth?: boolean;
}

/**
 * Server instance with process and metadata
 */
export interface ServerInstance {
  process: ChildProcess;
  port: number;
  controlDir: string;
}

/**
 * Default paths and timeouts
 */
const CLI_PATH = path.join(process.cwd(), 'src', 'cli.ts');
const BUILT_CLI_PATH = path.join(process.cwd(), 'dist', 'vibetunnel-cli');
const DEFAULT_TIMEOUT = 30000;
const HEALTH_CHECK_INTERVAL = 100;
const PROCESS_KILL_TIMEOUT = 5000;

/**
 * Extracts the server port from stdout output
 * @param output - The stdout output string
 * @returns The port number if found, null otherwise
 */
export function extractPortFromOutput(output: string): number | null {
  const patterns = [
    /VibeTunnel Server running on http:\/\/(?:localhost|[\d.]+):(\d+)/,
    /Server listening on port (\d+)/,
    // Also match when timestamp is present
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\s+LOG\s+\[[\w-]+\]\s+VibeTunnel Server running on http:\/\/(?:localhost|[\d.]+):(\d+)/,
  ];

  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) {
      // The port might be in match[1] or match[2] depending on the pattern
      return Number.parseInt(match[1] || match[2], 10);
    }
  }

  return null;
}

/**
 * Creates a temporary directory for testing
 * @param prefix - Directory prefix (e.g., 'vt', 'rs', 'hq')
 * @returns The created directory path
 */
export function createTestDirectory(prefix = 'vt'): string {
  // Use short prefix and only 4 chars from UUID to avoid exceeding Unix socket path limit (104 chars on macOS)
  const dir = path.join(os.tmpdir(), prefix, uuidv4().substring(0, 4));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Cleans up test directories
 * @param dirs - Array of directory paths to clean up
 */
export async function cleanupTestDirectories(dirs: string[]): Promise<void> {
  for (const dir of dirs) {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch (error) {
      testLogger.warn('Directory cleanup', `Failed to remove ${dir}:`, error);
    }
  }
}

/**
 * Waits for a server to be ready by checking its health endpoint
 * @param port - Server port
 * @param username - Optional username for basic auth
 * @param password - Optional password for basic auth
 * @param maxRetries - Maximum number of retries
 * @returns True if server is ready, false if timeout
 */
export async function waitForServerHealth(
  port: number,
  username?: string,
  password?: string,
  maxRetries = 30
): Promise<boolean> {
  const headers: Record<string, string> = {};
  if (username && password) {
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`http://localhost:${port}/api/health`, { headers });
      if (response.ok) {
        return true;
      }
    } catch (_e) {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_CHECK_INTERVAL));
  }
  return false;
}

/**
 * Starts a VibeTunnel test server with standardized configuration
 * @param config - Server configuration options
 * @returns Server instance with process and port
 */
export async function startTestServer(config: ServerConfig = {}): Promise<ServerInstance> {
  const {
    args = ['--port', '0'],
    env = {},
    controlDir = createTestDirectory(),
    usePnpm = false,
    timeout = DEFAULT_TIMEOUT,
    logOutput = true,
    serverType = 'SERVER',
    waitForHealth = false,
  } = config;

  // Build spawn command - always use source code with tsx for tests
  // This avoids issues with SEA patches in node-pty
  const useBuiltBinary = false; // Disabled - always use source for tests
  const command = useBuiltBinary ? BUILT_CLI_PATH : usePnpm ? 'pnpm' : 'tsx';
  const spawnArgs = useBuiltBinary
    ? args
    : usePnpm
      ? ['exec', 'tsx', CLI_PATH, ...args]
      : [CLI_PATH, ...args];

  // Merge environment variables
  const processEnv = {
    ...process.env,
    VIBETUNNEL_CONTROL_DIR: controlDir,
    NODE_ENV: 'production',
    FORCE_COLOR: '0',
    // Ensure INFO verbosity for tests to see server startup messages
    VIBETUNNEL_LOG_LEVEL: env.VIBETUNNEL_LOG_LEVEL || env.VIBETUNNEL_DEBUG ? undefined : 'info',
    ...env,
  };

  return new Promise((resolve, reject) => {
    const serverProcess = spawn(command, spawnArgs, {
      env: processEnv,
      stdio: 'pipe',
      detached: false, // Ensure child dies with parent
    });

    let outputBuffer = '';
    let resolved = false;
    let port = 0;

    const timeoutHandle = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        serverProcess.stdout?.off('data', dataListener);
        reject(new Error(`${serverType} did not start within ${timeout}ms`));
      }
    }, timeout);

    const dataListener = (data: Buffer) => {
      const output = data.toString();
      outputBuffer += output;

      if (logOutput) {
        console.log(`[${serverType}] ${output.trim()}`);
      }

      const extractedPort = extractPortFromOutput(outputBuffer);
      if (extractedPort && !resolved) {
        port = extractedPort;
        resolved = true;
        clearTimeout(timeoutHandle);
        serverProcess.stdout?.off('data', dataListener);

        // If waitForHealth is enabled, wait for the health endpoint
        if (waitForHealth) {
          // Calculate max retries based on timeout and interval
          const maxRetries = Math.floor(timeout / HEALTH_CHECK_INTERVAL);
          waitForServerHealth(port, undefined, undefined, maxRetries)
            .then((ready) => {
              if (ready) {
                resolve({ process: serverProcess, port, controlDir });
              } else {
                serverProcess.kill();
                reject(new Error(`${serverType} health check failed after ${timeout}ms`));
              }
            })
            .catch((error) => {
              serverProcess.kill();
              reject(error);
            });
        } else {
          resolve({ process: serverProcess, port, controlDir });
        }
      }
    };

    // Set up listeners
    serverProcess.stdout?.on('data', dataListener);

    if (logOutput || serverProcess.stderr) {
      serverProcess.stderr?.on('data', (data) => {
        const output = data.toString();
        if (logOutput) {
          console.error(`[${serverType} ERROR] ${output.trim()}`);
        }
        testLogger.error(`${serverType} stderr`, output);
      });
    }

    serverProcess.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutHandle);
        reject(err);
      } else if (logOutput) {
        testLogger.error(`${serverType} error`, err);
      }
    });

    serverProcess.on('exit', (code, signal) => {
      if (logOutput) {
        console.log(`[${serverType} EXIT] code: ${code}, signal: ${signal}`);
      }
    });
  });
}

/**
 * Gracefully stops a server process
 * @param serverProcess - The server process to stop
 * @param forceful - Whether to use SIGKILL if SIGTERM fails
 * @returns Promise that resolves when the process is stopped
 */
export async function stopServer(
  serverProcess: ChildProcess | null,
  forceful = true
): Promise<void> {
  if (!serverProcess) {
    return;
  }

  return new Promise<void>((resolve) => {
    // First try SIGTERM
    serverProcess.kill('SIGTERM');

    const timeout = setTimeout(() => {
      if (forceful) {
        testLogger.info('Server shutdown', 'Force killing server process');
        try {
          serverProcess.kill('SIGKILL');
        } catch (_e) {
          // Process may already be dead
        }
      }
      resolve();
    }, PROCESS_KILL_TIMEOUT);

    const checkInterval = setInterval(() => {
      if (serverProcess.killed || serverProcess.exitCode !== null) {
        clearTimeout(timeout);
        clearInterval(checkInterval);
        resolve();
      }
    }, 100);
  });
}

/**
 * Creates a basic auth header
 * @param username - Username
 * @param password - Password
 * @returns Base64 encoded auth header value
 */
export function createBasicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

/**
 * Utility to sleep for a given number of milliseconds
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after the timeout
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Helper to manage multiple server instances
 */
export class ServerManager {
  private servers: ServerInstance[] = [];
  private directories: string[] = [];

  /**
   * Starts a new server and tracks it
   * @param config - Server configuration
   * @returns The started server instance
   */
  async startServer(config: ServerConfig = {}): Promise<ServerInstance> {
    const server = await startTestServer(config);
    this.servers.push(server);
    if (!config.controlDir) {
      this.directories.push(server.controlDir);
    }
    return server;
  }

  /**
   * Stops all managed servers
   */
  async stopAll(): Promise<void> {
    await Promise.all(this.servers.map((server) => stopServer(server.process)));
    this.servers = [];
  }

  /**
   * Cleans up all managed directories
   */
  async cleanupDirectories(): Promise<void> {
    await cleanupTestDirectories(this.directories);
    this.directories = [];
  }

  /**
   * Full cleanup - stops servers and removes directories
   */
  async cleanup(): Promise<void> {
    await this.stopAll();
    await this.cleanupDirectories();
  }
}
