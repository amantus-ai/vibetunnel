/**
 * Control Event Stream Route
 *
 * Provides a server-sent event stream for real-time control messages
 * including Git notifications and system events.
 */
import { EventEmitter } from 'events';
import { Router } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('control-stream');

// Event emitter for control events
export const controlEventEmitter = new EventEmitter();

export interface ControlEvent {
  category: string;
  action: string;
  data?: unknown;
}

export function createControlRoutes(): Router {
  const router = Router();

  // SSE endpoint for control events
  router.get('/control/stream', (req: AuthenticatedRequest, res) => {
    // Set headers for SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable Nginx buffering
    });

    // Send initial connection message
    res.write(':ok\n\n');

    logger.debug('Control event stream connected');

    // Subscribe to control events
    const handleEvent = (event: ControlEvent) => {
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch (error) {
        logger.error('Failed to send control event:', error);
      }
    };

    controlEventEmitter.on('event', handleEvent);

    // Send periodic heartbeat to keep connection alive
    const heartbeatInterval = setInterval(() => {
      res.write(':heartbeat\n\n');
    }, 30000); // 30 seconds

    // Clean up on disconnect
    req.on('close', () => {
      logger.debug('Control event stream disconnected');
      controlEventEmitter.off('event', handleEvent);
      clearInterval(heartbeatInterval);
    });
  });

  return router;
}
