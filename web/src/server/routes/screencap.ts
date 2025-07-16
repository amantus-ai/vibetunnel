import * as path from 'node:path';
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

  // Serve screencap frontend page (serve the static file instead of inline HTML)
  router.get('/screencap', requireMacOS, (_req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'screencap.html'));
  });

  return router;
}
