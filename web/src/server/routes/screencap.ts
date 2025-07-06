import { type NextFunction, type Request, type Response, Router } from 'express';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('screencap');

// Initialize screencap on server startup
export async function initializeScreencap(): Promise<void> {
  // Skip initialization on non-macOS platforms
  if (process.platform !== 'darwin') {
    logger.log('⏭️ Skipping screencap initialization (macOS only)');
    return;
  }

  logger.log('✅ Screencap ready via WebSocket API');
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

  return router;
}
