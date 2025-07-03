import { type ChildProcess, execSync, spawn } from 'child_process';
import { Router } from 'express';
import * as fs from 'fs';
import { createProxyMiddleware } from 'http-proxy-middleware';
import * as path from 'path';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('screencap');

let screencapProcess: ChildProcess | null = null;
const SCREENCAP_PORT = 3030;

async function ensureScreencapBinary() {
  // Only available on macOS
  if (process.platform !== 'darwin') {
    throw new Error('Screencap is only available on macOS');
  }

  const screencapDir = path.join(process.cwd(), '..', 'screencap');
  const screencapPath = path.join(screencapDir, 'screencap7');

  // Check if binary exists
  if (!fs.existsSync(screencapPath)) {
    logger.log('🔨 Screencap binary not found, building...');
    try {
      // Build the screencap binary
      execSync('make build', {
        cwd: screencapDir,
        stdio: 'inherit',
      });
      logger.log('✅ Screencap binary built successfully');
    } catch (error) {
      logger.error('❌ Failed to build screencap binary:', error);
      throw error;
    }
  } else {
    logger.log('✅ Screencap binary found');
  }

  return screencapPath;
}

async function startScreencapProcess() {
  if (screencapProcess) {
    logger.log('🟡 Screencap process already running');
    return;
  }

  try {
    // Ensure binary is built
    const screencapPath = await ensureScreencapBinary();

    logger.log(`🚀 Starting screencap server on port ${SCREENCAP_PORT}`);
    logger.log(`📍 Binary path: ${screencapPath}`);

    screencapProcess = spawn(screencapPath, [SCREENCAP_PORT.toString()], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    screencapProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString().trim();
      if (output) {
        logger.log(`📺 screencap: ${output}`);
      }
    });

    screencapProcess.stderr?.on('data', (data: Buffer) => {
      const output = data.toString().trim();
      if (output) {
        logger.warn(`⚠️ screencap: ${output}`);
      }
    });

    screencapProcess.on('close', (code: number) => {
      logger.log(`🛑 Screencap process exited with code ${code}`);
      screencapProcess = null;
    });

    screencapProcess.on('error', (error: Error) => {
      logger.error('❌ Screencap process error:', error);
      screencapProcess = null;
    });

    // Give the process time to start
    await new Promise((resolve) => setTimeout(resolve, 2000));

    logger.log('✅ Screencap server started successfully');
    logger.log(`🌐 Access screencap at: http://localhost:${SCREENCAP_PORT}`);
  } catch (error) {
    logger.error('❌ Failed to start screencap process:', error);
    screencapProcess = null;
    throw error;
  }
}

function stopScreencapProcess() {
  if (screencapProcess) {
    logger.log('🛑 Stopping screencap process');
    screencapProcess.kill('SIGTERM');
    screencapProcess = null;
    logger.log('✅ Screencap process stopped');
  } else {
    logger.log('🟡 No screencap process to stop');
  }
}

// Initialize screencap on server startup
export async function initializeScreencap(): Promise<void> {
  // Skip initialization on non-macOS platforms
  if (process.platform !== 'darwin') {
    logger.log('⏭️ Skipping screencap initialization (macOS only)');
    return;
  }

  try {
    logger.log('🔄 Initializing screencap service...');
    await ensureScreencapBinary();
    // Don't start the process immediately, wait for first request
    logger.log('✅ Screencap service initialized');
  } catch (error) {
    logger.error('❌ Failed to initialize screencap service:', error);
    throw error;
  }
}

export function createScreencapRoutes(): Router {
  const router = Router();

  // Platform check middleware
  const requireMacOS = (_req: any, res: any, next: any) => {
    if (process.platform !== 'darwin') {
      return res.status(503).json({
        error: 'Screencap is only available on macOS',
        platform: process.platform,
      });
    }
    next();
  };

  // Serve screencap frontend page FIRST (exact match only)
  router.get('/screencap', requireMacOS, (_req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Screen Capture - VibeTunnel</title>
  <link rel="stylesheet" href="/bundle/styles.css">
  <style>
    :root {
      --dark-bg: #0a0a0a;
      --dark-bg-elevated: #171717;
      --dark-surface-hover: #262626;
      --dark-border: #404040;
      --dark-text: #fafafa;
      --dark-text-muted: #a3a3a3;
      --accent-primary: #3b82f6;
      --accent-secondary: #60a5fa;
      --status-success: #22c55e;
      --status-warning: #f59e0b;
      --status-error: #ef4444;
      --font-mono: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
    }
    
    body {
      margin: 0;
      padding: 0;
      font-family: var(--font-mono);
      background: var(--dark-bg);
      color: var(--dark-text);
      overflow: hidden;
    }
  </style>
</head>
<body>
  <screencap-view></screencap-view>
  <script type="module" src="/bundle/screencap.js"></script>
</body>
</html>
    `);
  });

  // Proxy API requests FIRST (specific routes before general ones)
  router.get(
    '/screencap/windows',
    async (_req, _res, next) => {
      if (!screencapProcess) {
        try {
          await startScreencapProcess();
        } catch (error) {
          logger.error('❌ Failed to start screencap for request:', error);
        }
      }
      next();
    },
    createProxyMiddleware({
      target: `http://localhost:${SCREENCAP_PORT}`,
      changeOrigin: true,
      pathRewrite: { '^/screencap': '' },
      on: {
        // biome-ignore lint/suspicious/noExplicitAny: http-proxy-middleware types
        proxyReq: (proxyReq: any, req: any, _res: any) => {
          proxyReq.setHeader('Accept', 'application/json');
          logger.debug(`🔄 Proxying ${req.method} ${req.url} to /windows on screencap server`);
        },
      },
    })
  );

  router.get(
    '/screencap/display',
    async (_req, _res, next) => {
      if (!screencapProcess) {
        try {
          await startScreencapProcess();
        } catch (error) {
          logger.error('❌ Failed to start screencap for request:', error);
        }
      }
      next();
    },
    createProxyMiddleware({
      target: `http://localhost:${SCREENCAP_PORT}`,
      changeOrigin: true,
      pathRewrite: { '^/screencap': '' },
      on: {
        // biome-ignore lint/suspicious/noExplicitAny: http-proxy-middleware types
        proxyReq: (proxyReq: any, req: any, _res: any) => {
          proxyReq.setHeader('Accept', 'application/json');
          logger.debug(`🔄 Proxying ${req.method} ${req.url} to /display on screencap server`);
        },
      },
    })
  );

  router.get(
    '/screencap/frame',
    async (_req, _res, next) => {
      if (!screencapProcess) {
        try {
          await startScreencapProcess();
        } catch (error) {
          logger.error('❌ Failed to start screencap for request:', error);
        }
      }
      next();
    },
    createProxyMiddleware({
      target: `http://localhost:${SCREENCAP_PORT}`,
      changeOrigin: true,
      pathRewrite: { '^/screencap': '' },
      on: {
        // biome-ignore lint/suspicious/noExplicitAny: http-proxy-middleware types
        proxyReq: (_proxyReq: any, req: any, _res: any) => {
          logger.debug(`🔄 Proxying ${req.method} ${req.url} to /frame on screencap server`);
        },
      },
    })
  );

  // Proxy POST requests with middleware to start screencap first
  router.post(
    '/screencap/capture',
    async (req, _res, next) => {
      logger.log(`🔄 Received capture request: ${req.method} ${req.url}`);
      logger.log(`📦 Request body:`, req.body);

      if (!screencapProcess) {
        try {
          logger.log('🚀 Starting screencap process...');
          await startScreencapProcess();
          logger.log('✅ Screencap process started');
        } catch (error) {
          logger.error('❌ Failed to start screencap for request:', error);
        }
      } else {
        logger.log('✅ Screencap process already running');
      }
      next();
    },
    createProxyMiddleware({
      target: `http://localhost:${SCREENCAP_PORT}`,
      changeOrigin: true,
      pathRewrite: { '^/screencap': '' },
      on: {
        // biome-ignore lint/suspicious/noExplicitAny: http-proxy-middleware types
        proxyReq: (proxyReq: any, req: any, _res: any) => {
          logger.log(`🔧 onProxyReq called for ${req.method} ${req.url}`);
          logger.log(`🔍 Request body exists:`, !!req.body);
          logger.log(`🔍 Request body content:`, req.body);

          // Set headers
          proxyReq.setHeader('Accept', 'application/json');
          proxyReq.setHeader('Content-Type', 'application/json');

          // Forward the body if it exists
          if (req.body && Object.keys(req.body).length > 0) {
            const bodyData = JSON.stringify(req.body);
            proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
            proxyReq.write(bodyData);
            logger.log(`📦 Forwarding body data: ${bodyData}`);
          } else {
            logger.warn(`⚠️ No body to forward or body is empty`);
          }

          logger.log(`📡 Proxying ${req.method} ${req.url} to /capture on screencap server`);
        },
        // biome-ignore lint/suspicious/noExplicitAny: http-proxy-middleware types
        proxyRes: (proxyRes: any, req: any, _res: any) => {
          logger.log(
            `📨 Proxy response: ${proxyRes.statusCode} from screencap server for ${req.url}`
          );
        },
        // biome-ignore lint/suspicious/noExplicitAny: http-proxy-middleware types
        error: (err: Error, req: any, res: any) => {
          logger.error(`❌ Proxy error for ${req.url}:`, err);
          if (res && typeof res.status === 'function' && !res.headersSent) {
            res.status(502).json({ error: 'Screencap service error', details: err.message });
          }
        },
      },
    })
  );

  router.post(
    '/screencap/capture-window',
    async (req, _res, next) => {
      logger.log(`🔄 Received capture-window request: ${req.method} ${req.url}`);
      logger.log(`📦 Request body:`, req.body);

      if (!screencapProcess) {
        try {
          await startScreencapProcess();
        } catch (error) {
          logger.error('❌ Failed to start screencap for request:', error);
        }
      }
      next();
    },
    createProxyMiddleware({
      target: `http://localhost:${SCREENCAP_PORT}`,
      changeOrigin: true,
      pathRewrite: { '^/screencap': '' },
      on: {
        // biome-ignore lint/suspicious/noExplicitAny: http-proxy-middleware types
        proxyReq: (proxyReq: any, req: any, _res: any) => {
          logger.log(`🔧 onProxyReq called for ${req.method} ${req.url}`);
          logger.log(`🔍 Request body exists:`, !!req.body);
          logger.log(`🔍 Request body content:`, req.body);

          // Set headers
          proxyReq.setHeader('Accept', 'application/json');
          proxyReq.setHeader('Content-Type', 'application/json');

          // Forward the body if it exists
          if (req.body && Object.keys(req.body).length > 0) {
            const bodyData = JSON.stringify(req.body);
            proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
            proxyReq.write(bodyData);
            logger.log(`📦 Forwarding window capture body data: ${bodyData}`);
          } else {
            logger.warn(`⚠️ No body to forward for window capture or body is empty`);
          }

          logger.log(`📡 Proxying ${req.method} ${req.url} to /capture-window on screencap server`);
        },
        // biome-ignore lint/suspicious/noExplicitAny: http-proxy-middleware types
        proxyRes: (proxyRes: any, req: any, _res: any) => {
          logger.log(
            `📨 Window capture proxy response: ${proxyRes.statusCode} from screencap server for ${req.url}`
          );
        },
        // biome-ignore lint/suspicious/noExplicitAny: http-proxy-middleware types
        error: (err: Error, req: any, res: any) => {
          logger.error(`❌ Window capture proxy error for ${req.url}:`, err);
          if (res && typeof res.status === 'function' && !res.headersSent) {
            res.status(502).json({ error: 'Screencap service error', details: err.message });
          }
        },
      },
    })
  );

  router.post(
    '/screencap/stop',
    async (_req, _res, next) => {
      if (!screencapProcess) {
        try {
          await startScreencapProcess();
        } catch (error) {
          logger.error('❌ Failed to start screencap for request:', error);
        }
      }
      next();
    },
    createProxyMiddleware({
      target: `http://localhost:${SCREENCAP_PORT}`,
      changeOrigin: true,
      pathRewrite: { '^/screencap': '' },
      on: {
        // biome-ignore lint/suspicious/noExplicitAny: http-proxy-middleware types
        proxyReq: (proxyReq: any, req: any, _res: any) => {
          proxyReq.setHeader('Accept', 'application/json');
          proxyReq.setHeader('Content-Type', 'application/json');
          logger.debug(`🔄 Proxying ${req.method} ${req.url} to /stop on screencap server`);
        },
      },
    })
  );

  router.post(
    '/screencap/click',
    async (req, _res, next) => {
      logger.log(`🔄 Received click request: ${req.method} ${req.url}`);
      logger.log(`📦 Request body:`, req.body);

      if (!screencapProcess) {
        try {
          await startScreencapProcess();
        } catch (error) {
          logger.error('❌ Failed to start screencap for request:', error);
        }
      }
      next();
    },
    createProxyMiddleware({
      target: `http://localhost:${SCREENCAP_PORT}`,
      changeOrigin: true,
      pathRewrite: { '^/screencap': '' },
      on: {
        // biome-ignore lint/suspicious/noExplicitAny: http-proxy-middleware types
        proxyReq: (proxyReq: any, req: any, _res: any) => {
          logger.log(`🔧 onProxyReq called for ${req.method} ${req.url}`);
          logger.log(`🔍 Request body exists:`, !!req.body);
          logger.log(`🔍 Request body content:`, req.body);

          // Set headers
          proxyReq.setHeader('Accept', 'application/json');
          proxyReq.setHeader('Content-Type', 'application/json');

          // Forward the body if it exists
          if (req.body && Object.keys(req.body).length > 0) {
            const bodyData = JSON.stringify(req.body);
            proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
            proxyReq.write(bodyData);
            logger.log(`📦 Forwarding click body data: ${bodyData}`);
          } else {
            logger.warn(`⚠️ No body to forward for click or body is empty`);
          }

          logger.log(`📡 Proxying ${req.method} ${req.url} to /click on screencap server`);
        },
        // biome-ignore lint/suspicious/noExplicitAny: http-proxy-middleware types
        proxyRes: (proxyRes: any, req: any, _res: any) => {
          logger.log(
            `📨 Click proxy response: ${proxyRes.statusCode} from screencap server for ${req.url}`
          );
        },
        // biome-ignore lint/suspicious/noExplicitAny: http-proxy-middleware types
        error: (err: Error, req: any, res: any) => {
          logger.error(`❌ Click proxy error for ${req.url}:`, err);
          if (res && typeof res.status === 'function' && !res.headersSent) {
            res.status(502).json({ error: 'Screencap service error', details: err.message });
          }
        },
      },
    })
  );

  // Proxy key input endpoints
  router.post(
    '/screencap/key',
    async (req, _res, next) => {
      logger.log(`🔄 Received key request: ${req.method} ${req.url}`);
      logger.log(`📦 Request body:`, req.body);

      if (!screencapProcess) {
        try {
          await startScreencapProcess();
        } catch (error) {
          logger.error('❌ Failed to start screencap for request:', error);
        }
      }
      next();
    },
    createProxyMiddleware({
      target: `http://localhost:${SCREENCAP_PORT}`,
      changeOrigin: true,
      pathRewrite: { '^/screencap': '' },
      on: {
        // biome-ignore lint/suspicious/noExplicitAny: http-proxy-middleware types
        proxyReq: (proxyReq: any, req: any, _res: any) => {
          logger.log(`🔧 onProxyReq called for ${req.method} ${req.url}`);
          logger.log(`🔍 Request body exists:`, !!req.body);
          logger.log(`🔍 Request body content:`, req.body);

          // Set headers
          proxyReq.setHeader('Accept', 'application/json');
          proxyReq.setHeader('Content-Type', 'application/json');

          // Forward the body if it exists
          if (req.body && Object.keys(req.body).length > 0) {
            const bodyData = JSON.stringify(req.body);
            proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
            proxyReq.write(bodyData);
            logger.log(`📦 Forwarding key body data: ${bodyData}`);
          } else {
            logger.warn(`⚠️ No body to forward for key or body is empty`);
          }

          logger.log(`📡 Proxying ${req.method} ${req.url} to /key on screencap server`);
        },
        // biome-ignore lint/suspicious/noExplicitAny: http-proxy-middleware types
        proxyRes: (proxyRes: any, req: any, _res: any) => {
          logger.log(
            `📨 Key proxy response: ${proxyRes.statusCode} from screencap server for ${req.url}`
          );
        },
        // biome-ignore lint/suspicious/noExplicitAny: http-proxy-middleware types
        error: (err: Error, req: any, res: any) => {
          logger.error(`❌ Key proxy error for ${req.url}:`, err);
          if (res && typeof res.status === 'function' && !res.headersSent) {
            res.status(502).json({ error: 'Screencap service error', details: err.message });
          }
        },
      },
    })
  );

  router.post(
    '/screencap/key-window',
    async (req, _res, next) => {
      logger.log(`🔄 Received key-window request: ${req.method} ${req.url}`);
      logger.log(`📦 Request body:`, req.body);

      if (!screencapProcess) {
        try {
          await startScreencapProcess();
        } catch (error) {
          logger.error('❌ Failed to start screencap for request:', error);
        }
      }
      next();
    },
    createProxyMiddleware({
      target: `http://localhost:${SCREENCAP_PORT}`,
      changeOrigin: true,
      pathRewrite: { '^/screencap': '' },
      on: {
        // biome-ignore lint/suspicious/noExplicitAny: http-proxy-middleware types
        proxyReq: (proxyReq: any, req: any, _res: any) => {
          logger.log(`🔧 onProxyReq called for ${req.method} ${req.url}`);
          logger.log(`🔍 Request body exists:`, !!req.body);
          logger.log(`🔍 Request body content:`, req.body);

          // Set headers
          proxyReq.setHeader('Accept', 'application/json');
          proxyReq.setHeader('Content-Type', 'application/json');

          // Forward the body if it exists
          if (req.body && Object.keys(req.body).length > 0) {
            const bodyData = JSON.stringify(req.body);
            proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
            proxyReq.write(bodyData);
            logger.log(`📦 Forwarding key-window body data: ${bodyData}`);
          } else {
            logger.warn(`⚠️ No body to forward for key-window or body is empty`);
          }

          logger.log(`📡 Proxying ${req.method} ${req.url} to /key-window on screencap server`);
        },
        // biome-ignore lint/suspicious/noExplicitAny: http-proxy-middleware types
        proxyRes: (proxyRes: any, req: any, _res: any) => {
          logger.log(
            `📨 Key-window proxy response: ${proxyRes.statusCode} from screencap server for ${req.url}`
          );
        },
        // biome-ignore lint/suspicious/noExplicitAny: http-proxy-middleware types
        error: (err: Error, req: any, res: any) => {
          logger.error(`❌ Key-window proxy error for ${req.url}:`, err);
          if (res && typeof res.status === 'function' && !res.headersSent) {
            res.status(502).json({ error: 'Screencap service error', details: err.message });
          }
        },
      },
    })
  );

  // Control endpoint to start/stop screencap
  router.post('/screencap-control/start', async (_req, res) => {
    try {
      await startScreencapProcess();
      res.json({ success: true, message: 'Screencap service started' });
    } catch (_error) {
      res.status(500).json({ error: 'Failed to start screencap service' });
    }
  });

  router.post('/screencap-control/stop', (_req, res) => {
    stopScreencapProcess();
    res.json({ success: true, message: 'Screencap service stopped' });
  });

  router.get('/screencap-control/status', (_req, res) => {
    res.json({
      running: screencapProcess !== null,
      port: SCREENCAP_PORT,
    });
  });

  return router;
}

// Cleanup on process exit
process.on('exit', stopScreencapProcess);
process.on('SIGTERM', stopScreencapProcess);
process.on('SIGINT', stopScreencapProcess);
