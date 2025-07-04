import express, { type NextFunction, type Request, type Response, Router } from 'express';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('screencap');

// Screencap service runs in the Mac app on port 4010
const SCREENCAP_PORT = 4010;
const SCREENCAP_URL = `http://localhost:${SCREENCAP_PORT}`;

// Initialize screencap on server startup
export async function initializeScreencap(): Promise<void> {
  // Skip initialization on non-macOS platforms
  if (process.platform !== 'darwin') {
    logger.log('⏭️ Skipping screencap initialization (macOS only)');
    return;
  }

  logger.log('✅ Screencap proxy routes ready (Mac app service on port 4010)');
}

export function createScreencapRoutes(): Router {
  const router = Router();

  // Platform check middleware
  const requireMacOS = (_req: Request, res: Response, next: NextFunction) => {
    if (process.platform !== 'darwin') {
      return res.status(503).json({
        error: 'Screencap is only available on macOS',
        platform: process.platform,
      });
    }
    next();
  };

  // Serve screencap frontend page
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

  // Proxy all screencap API endpoints
  router.get('/screencap/windows', requireMacOS, async (_req, res) => {
    try {
      const response = await fetch(`${SCREENCAP_URL}/windows`);
      if (response.ok) {
        const data = await response.json();
        res.json(data);
      } else {
        res.status(response.status).json({ error: 'Failed to get windows' });
      }
    } catch (error) {
      logger.error('Failed to proxy windows request:', error);
      res.status(502).json({ error: 'Cannot reach screencap service' });
    }
  });

  router.get('/screencap/display', requireMacOS, async (_req, res) => {
    try {
      const response = await fetch(`${SCREENCAP_URL}/display`);
      if (response.ok) {
        const data = await response.json();
        res.json(data);
      } else {
        res.status(response.status).json({ error: 'Failed to get display info' });
      }
    } catch (error) {
      logger.error('Failed to proxy display request:', error);
      res.status(502).json({ error: 'Cannot reach screencap service' });
    }
  });

  router.get('/screencap/displays', requireMacOS, async (_req, res) => {
    try {
      const response = await fetch(`${SCREENCAP_URL}/displays`);
      if (response.ok) {
        const data = await response.json();
        res.json(data);
      } else {
        res.status(response.status).json({ error: 'Failed to get displays info' });
      }
    } catch (error) {
      logger.error('Failed to proxy displays request:', error);
      res.status(502).json({ error: 'Cannot reach screencap service' });
    }
  });

  router.get('/screencap/frame', requireMacOS, async (_req, res) => {
    try {
      const response = await fetch(`${SCREENCAP_URL}/frame`);
      if (response.ok) {
        const buffer = await response.arrayBuffer();
        res.set('Content-Type', 'image/jpeg');
        res.set('Cache-Control', 'no-cache');
        res.send(Buffer.from(buffer));
      } else {
        res.status(response.status).json({ error: 'Failed to get frame' });
      }
    } catch (error) {
      logger.error('Failed to proxy frame request:', error);
      res.status(502).json({ error: 'Cannot reach screencap service' });
    }
  });

  // Special handling for capture endpoint to ensure body is properly forwarded
  router.post('/screencap/capture', requireMacOS, express.json(), async (req, res) => {
    try {
      logger.debug('Capture request body:', req.body);

      const response = await fetch(`${SCREENCAP_URL}/capture`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(req.body),
      });

      if (response.ok) {
        const data = await response.json();
        res.json(data);
      } else {
        const errorText = await response.text();
        logger.error(`Screencap service returned ${response.status}: ${errorText}`);
        res.status(response.status).json({ error: errorText });
      }
    } catch (error) {
      logger.error('Failed to proxy capture request:', error);
      res.status(502).json({
        error: 'Failed to reach screencap service',
        details: 'Please check if screen sharing is enabled in Settings > Advanced',
      });
    }
  });

  router.post('/screencap/capture-window', requireMacOS, express.json(), async (req, res) => {
    try {
      const response = await fetch(`${SCREENCAP_URL}/capture-window`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });

      if (response.ok) {
        const data = await response.json();
        res.json(data);
      } else {
        const errorText = await response.text();
        res.status(response.status).json({ error: errorText });
      }
    } catch (error) {
      logger.error('Failed to proxy capture-window request:', error);
      res.status(502).json({ error: 'Cannot reach screencap service' });
    }
  });

  router.post('/screencap/stop', requireMacOS, async (_req, res) => {
    try {
      const response = await fetch(`${SCREENCAP_URL}/stop`, {
        method: 'POST',
      });

      if (response.ok) {
        const data = await response.json();
        res.json(data);
      } else {
        res.status(response.status).json({ error: 'Failed to stop capture' });
      }
    } catch (error) {
      logger.error('Failed to proxy stop request:', error);
      res.status(502).json({ error: 'Cannot reach screencap service' });
    }
  });

  router.post('/screencap/click', requireMacOS, express.json(), async (req, res) => {
    try {
      const response = await fetch(`${SCREENCAP_URL}/click`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });

      if (response.ok) {
        const data = await response.json();
        res.json(data);
      } else {
        res.status(response.status).json({ error: 'Failed to send click' });
      }
    } catch (error) {
      logger.error('Failed to proxy click request:', error);
      res.status(502).json({ error: 'Cannot reach screencap service' });
    }
  });

  router.post('/screencap/mousedown', requireMacOS, express.json(), async (req, res) => {
    try {
      const response = await fetch(`${SCREENCAP_URL}/mousedown`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });

      if (response.ok) {
        const data = await response.json();
        res.json(data);
      } else {
        res.status(response.status).json({ error: 'Failed to send mouse down' });
      }
    } catch (error) {
      logger.error('Failed to proxy mousedown request:', error);
      res.status(502).json({ error: 'Cannot reach screencap service' });
    }
  });

  router.post('/screencap/mousemove', requireMacOS, express.json(), async (req, res) => {
    try {
      const response = await fetch(`${SCREENCAP_URL}/mousemove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });

      if (response.ok) {
        const data = await response.json();
        res.json(data);
      } else {
        res.status(response.status).json({ error: 'Failed to send mouse move' });
      }
    } catch (error) {
      logger.error('Failed to proxy mousemove request:', error);
      res.status(502).json({ error: 'Cannot reach screencap service' });
    }
  });

  router.post('/screencap/mouseup', requireMacOS, express.json(), async (req, res) => {
    try {
      const response = await fetch(`${SCREENCAP_URL}/mouseup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });

      if (response.ok) {
        const data = await response.json();
        res.json(data);
      } else {
        res.status(response.status).json({ error: 'Failed to send mouse up' });
      }
    } catch (error) {
      logger.error('Failed to proxy mouseup request:', error);
      res.status(502).json({ error: 'Cannot reach screencap service' });
    }
  });

  router.post('/screencap/click-window', requireMacOS, express.json(), async (req, res) => {
    try {
      const response = await fetch(`${SCREENCAP_URL}/click-window`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });

      if (response.ok) {
        const data = await response.json();
        res.json(data);
      } else {
        res.status(response.status).json({ error: 'Failed to send click' });
      }
    } catch (error) {
      logger.error('Failed to proxy click-window request:', error);
      res.status(502).json({ error: 'Cannot reach screencap service' });
    }
  });

  router.post('/screencap/key', requireMacOS, express.json(), async (req, res) => {
    try {
      const response = await fetch(`${SCREENCAP_URL}/key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });

      if (response.ok) {
        const data = await response.json();
        res.json(data);
      } else {
        res.status(response.status).json({ error: 'Failed to send key' });
      }
    } catch (error) {
      logger.error('Failed to proxy key request:', error);
      res.status(502).json({ error: 'Cannot reach screencap service' });
    }
  });

  router.post('/screencap/key-window', requireMacOS, express.json(), async (req, res) => {
    try {
      const response = await fetch(`${SCREENCAP_URL}/key-window`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });

      if (response.ok) {
        const data = await response.json();
        res.json(data);
      } else {
        res.status(response.status).json({ error: 'Failed to send key' });
      }
    } catch (error) {
      logger.error('Failed to proxy key-window request:', error);
      res.status(502).json({ error: 'Cannot reach screencap service' });
    }
  });

  // Health check endpoint
  router.get('/screencap/health', requireMacOS, async (_req, res) => {
    try {
      const response = await fetch(`${SCREENCAP_URL}/health`);
      if (response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        res.json({ ...data, proxy: 'ok' });
      } else {
        res.status(502).json({
          error: 'Screencap service unhealthy',
          details: 'Service is not responding correctly',
        });
      }
    } catch (_error) {
      res.status(502).json({
        error: 'Cannot reach screencap service',
        details: 'Please check if screen sharing is enabled in Settings > Advanced',
      });
    }
  });

  return router;
}
