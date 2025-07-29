import { type Request, type Response, Router } from 'express';
import { type ServerEvent, ServerEventType } from '../../shared/types.js';
import type { SessionMonitor } from '../services/session-monitor.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('events');

/**
 * Server-Sent Events (SSE) endpoint for real-time event streaming
 */
export function createEventsRouter(sessionMonitor?: SessionMonitor): Router {
  const router = Router();

  // SSE endpoint for event streaming
  router.get('/events', (req: Request, res: Response) => {
    logger.info('📡 SSE connection attempt received');
    logger.debug('Client connected to event stream');

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable proxy buffering

    // Event ID counter
    let eventId = 0;
    // biome-ignore lint/style/useConst: keepAlive is assigned after declaration
    let keepAlive: NodeJS.Timeout;

    // Forward-declare event handlers for cleanup
    let onNotification: (event: ServerEvent) => void;

    // Cleanup function to remove event listeners
    const cleanup = () => {
      if (keepAlive) {
        clearInterval(keepAlive);
      }
      if (sessionMonitor) {
        sessionMonitor.off('notification', onNotification);
      }
    };

    // Send initial connection event as default message event
    try {
      res.write('event: connected\ndata: {"type": "connected"}\n\n');
    } catch (error) {
      logger.debug('Failed to send initial connection event:', error);
      return;
    }

    // Keep connection alive
    keepAlive = setInterval(() => {
      try {
        res.write(':heartbeat\n\n'); // SSE comment to keep connection alive
      } catch (error) {
        logger.debug('Failed to send heartbeat:', error);
        cleanup();
      }
    }, 30000);

    // Handle SessionMonitor notification events
    if (sessionMonitor) {
      onNotification = (event: ServerEvent) => {
        // SessionMonitor already provides properly formatted ServerEvent objects
        logger.info(`📢 SessionMonitor notification: ${event.type} for session ${event.sessionId}`);

        // Log test notifications specifically for debugging
        if (event.type === ServerEventType.TestNotification) {
          logger.info('🧪 Forwarding test notification through SSE:', event);
        }

        // The event type is already included in the data payload
        try {
          const sseMessage = `id: ${++eventId}\nevent: ${
            event.type
          }\ndata: ${JSON.stringify(event)}\n\n`;
          res.write(sseMessage);
          logger.debug(`✅ SSE event written: ${event.type}`);
        } catch (error) {
          logger.error('Failed to write SSE event:', error);
        }
      };

      sessionMonitor.on('notification', onNotification);
    }

    // Handle client disconnect
    req.on('close', () => {
      logger.debug('Client disconnected from event stream');
      cleanup();
    });
  });

  return router;
}
