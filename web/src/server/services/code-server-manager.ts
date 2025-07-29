import { type ChildProcess, spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { RequestHandler, Router } from 'express';
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { createLogger } from '../utils/logger.js';

/**
 * Represents a running code-server instance associated with a VibeTunnel session
 */
interface CodeServerInstance {
  sessionId: string;
  workingDir: string;
  port: number;
  process: ChildProcess;
  router: Router;
  proxy: RequestHandler; // Store reference to the proxy middleware
}

const logger = createLogger('code-server-manager');

/**
 * Manages code-server (VS Code in the browser) instances for VibeTunnel sessions.
 *
 * This service allows users to run VS Code in their browser for each terminal session.
 * Each session gets its own isolated code-server instance running on a unique port.
 *
 * Key features:
 * - Spawns code-server processes on demand
 * - Manages port allocation to avoid conflicts
 * - Creates proxy middleware to route requests to the correct code-server instance
 * - Handles cleanup when sessions are terminated
 * - Stores configuration in .vibetunnel-config directory
 */
export class CodeServerManager {
  private instances = new Map<string, CodeServerInstance>();
  private nextPort = 8100; // Port counter

  constructor() {
    logger.debug('CodeServerManager initialized');
  }

  async start(sessionId: string, workingDir: string): Promise<Router> {
    logger.log(`Starting code-server for session ${sessionId} in ${workingDir}`);

    // Check if already running
    const existing = this.instances.get(sessionId);
    if (existing) {
      logger.debug(`code-server already running for session ${sessionId}`);
      return existing.router;
    }

    const port = this.nextPort++;
    const router = express.Router();

    try {
      // Create config directory for this session
      const configDir = path.join(process.cwd(), '.vibetunnel-config', sessionId);
      await fs.mkdir(configDir, { recursive: true });

      // Create code-server config
      const configPath = path.join(configDir, 'config.yaml');
      const basePath = `/code-server/${sessionId}`;
      const config = `bind-addr: 127.0.0.1:${port}
auth: none
cert: false
disable-telemetry: true
disable-update-check: true
`;
      await fs.writeFile(configPath, config);

      // Start code-server process
      const childProcess = spawn(
        'code-server',
        [
          '--config',
          configPath,
          '--disable-telemetry',
          '--disable-update-check',
          '--bind-addr',
          `127.0.0.1:${port}`,
          '--auth',
          'none',
          '--abs-proxy-base-path',
          basePath,
          workingDir,
        ],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            // Disable code-server's own proxy for cleaner integration
            VSCODE_PROXY_URI: undefined,
          },
        }
      );

      // Handle process events
      childProcess.on('error', (error: Error) => {
        logger.error(`code-server process error for session ${sessionId}:`, error);
        this.instances.delete(sessionId);
      });

      childProcess.on('exit', (code: number | null) => {
        logger.log(`code-server process exited for session ${sessionId} with code ${code}`);
        this.instances.delete(sessionId);
      });

      // Log output for debugging
      childProcess.stdout?.on('data', (data: Buffer) => {
        logger.debug(`code-server stdout (${sessionId}):`, data.toString().trim());
      });

      childProcess.stderr?.on('data', (data: Buffer) => {
        logger.debug(`code-server stderr (${sessionId}):`, data.toString().trim());
      });

      // Wait for code-server to start
      await this.waitForCodeServer(port);

      // Create proxy middleware
      const proxy = createProxyMiddleware({
        target: `http://127.0.0.1:${port}`,
        changeOrigin: true,
        ws: true, // Enable WebSocket proxying
        secure: false,
        followRedirects: true,
      });

      // Route everything through the proxy
      router.use('/', proxy);

      // Store instance
      this.instances.set(sessionId, {
        sessionId,
        workingDir,
        port,
        process: childProcess,
        router,
        proxy,
      });

      logger.log(`code-server started for session ${sessionId} on port ${port}`);
      return router;
    } catch (error) {
      logger.error(`Failed to start code-server for session ${sessionId}:`, error);
      throw error;
    }
  }

  stop(sessionId: string): void {
    const instance = this.instances.get(sessionId);
    if (instance) {
      logger.log(`Stopping code-server for session ${sessionId}`);

      // Kill the process
      if (!instance.process.killed) {
        instance.process.kill('SIGTERM');

        // Force kill after 5 seconds if not terminated
        setTimeout(() => {
          if (!instance.process.killed) {
            instance.process.kill('SIGKILL');
          }
        }, 5000);
      }

      this.instances.delete(sessionId);
      logger.log(`code-server stopped for session ${sessionId}`);
    }
  }

  isRunning(sessionId: string): boolean {
    const instance = this.instances.get(sessionId);
    return instance !== undefined && !instance.process.killed;
  }

  getRouter(sessionId: string): Router | undefined {
    return this.instances.get(sessionId)?.router;
  }

  getPort(sessionId: string): number | undefined {
    return this.instances.get(sessionId)?.port;
  }

  getProxy(sessionId: string): RequestHandler | undefined {
    return this.instances.get(sessionId)?.proxy;
  }

  stopAll(): void {
    for (const sessionId of this.instances.keys()) {
      this.stop(sessionId);
    }
  }

  private async waitForCodeServer(port: number, maxRetries = 30): Promise<void> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok || response.status === 302) {
          logger.debug(`code-server is ready on port ${port}`);
          return;
        }
      } catch {
        // Server not ready yet
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error(`code-server failed to start on port ${port} after ${maxRetries} retries`);
  }
}
