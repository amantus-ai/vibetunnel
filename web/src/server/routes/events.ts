import { EventEmitter } from 'events';
import { type Request, type Response, Router } from 'express';
import type { PtyManager } from '../pty/pty-manager.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('events');

// Global event bus for server-wide events
export const serverEventBus = new EventEmitter();

/**
 * Server-Sent Events (SSE) endpoint for real-time event streaming
 */
export function createEventsRouter(ptyManager: PtyManager): Router {
  const router = Router();

  // SSE endpoint for event streaming
  router.get('/events', (req: Request, res: Response) => {
    logger.debug('Client connected to event stream');

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Send initial connection event
    res.write('event: connected\ndata: {"type": "connected"}\n\n');

    // Keep connection alive
    const keepAlive = setInterval(() => {
      res.write(':\n\n'); // SSE comment to keep connection alive
    }, 30000);

    // Event handlers
    const sendEvent = (type: string, data: Record<string, unknown>) => {
      const event = {
        type,
        timestamp: new Date().toISOString(),
        ...data,
      };

      // Enhanced logging for all notification events
      if (type === 'command-finished' || type === 'command-error' || type === 'claude-turn') {
        logger.info(
          `🔔 NOTIFICATION DEBUG: Actually sending SSE event - type: ${type}, sessionId: ${data.sessionId}`
        );
      }

      // Enhanced logging for Claude-related events
      if (
        (type === 'command-finished' || type === 'command-error') &&
        data.command &&
        (data.command as string).toLowerCase().includes('claude')
      ) {
        logger.log(`🚀 SSE: Sending Claude ${type} event for session ${data.sessionId}`);
      }

      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // Listen for session events
    const onSessionStarted = (sessionId: string, sessionName: string) => {
      sendEvent('session-start', { sessionId, sessionName });
    };

    const onSessionExited = (sessionId: string, sessionName: string, exitCode?: number) => {
      sendEvent('session-exit', { sessionId, sessionName, exitCode });
    };

    interface CommandFinishedEvent {
      sessionId: string;
      command: string;
      duration: number;
      exitCode: number;
    }

    const onCommandFinished = (data: CommandFinishedEvent) => {
      const isClaudeCommand = data.command.toLowerCase().includes('claude');

      if (isClaudeCommand) {
        logger.debug(`📨 SSE Route: Received Claude commandFinished event - preparing to send SSE`);
      }

      const eventType = data.exitCode === 0 ? 'command-finished' : 'command-error';
      logger.info(
        `🔔 NOTIFICATION DEBUG: SSE forwarding ${eventType} event - sessionId: ${data.sessionId}, command: "${data.command}", duration: ${data.duration}ms, exitCode: ${data.exitCode}`
      );

      if (data.exitCode === 0) {
        sendEvent('command-finished', {
          sessionId: data.sessionId,
          command: data.command,
          duration: data.duration,
          exitCode: data.exitCode,
        });
      } else {
        sendEvent('command-error', {
          sessionId: data.sessionId,
          command: data.command,
          duration: data.duration,
          exitCode: data.exitCode,
        });
      }
    };

    const onClaudeTurn = (sessionId: string, sessionName: string) => {
      logger.info(
        `🔔 NOTIFICATION DEBUG: SSE forwarding claude-turn event - sessionId: ${sessionId}, sessionName: "${sessionName}"`
      );
      sendEvent('claude-turn', {
        sessionId,
        sessionName,
        message: 'Claude has finished responding',
      });
    };

    // Subscribe to events
    ptyManager.on('sessionStarted', onSessionStarted);
    ptyManager.on('sessionExited', onSessionExited);
    ptyManager.on('commandFinished', onCommandFinished);
    ptyManager.on('claudeTurn', onClaudeTurn);

    // Handle client disconnect
    req.on('close', () => {
      logger.debug('Client disconnected from event stream');
      clearInterval(keepAlive);

      // Unsubscribe from events
      ptyManager.off('sessionStarted', onSessionStarted);
      ptyManager.off('sessionExited', onSessionExited);
      ptyManager.off('commandFinished', onCommandFinished);
      ptyManager.off('claudeTurn', onClaudeTurn);
    });
  });

  return router;
}
