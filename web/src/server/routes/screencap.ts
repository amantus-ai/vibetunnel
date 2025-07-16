import { Router } from 'express';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('screencap');

// Initialize screencap on server startup
export async function initializeScreencap(): Promise<void> {
  // Log platform support
  if (process.platform === 'darwin') {
    logger.log('✅ Screencap ready via native Mac app and WebSocket API');
  } else {
    logger.log('✅ Screencap ready via browser API on', process.platform);
  }
}

export function createScreencapRoutes(): Router {
  const router = Router();

  // Serve screencap frontend page
  router.get('/screencap', (_req, res) => {
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
