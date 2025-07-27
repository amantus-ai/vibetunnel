import { EventEmitter } from 'events';
import { type Request, type Response, Router } from 'express';
import { type ServerEvent, ServerEventType } from '../../shared/types.js';
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

    // Event ID counter
    let eventId = 0;
    // biome-ignore lint/style/useConst: keepAlive is assigned after declaration
    let keepAlive: NodeJS.Timeout;

    // Interface for command finished event
    interface CommandFinishedEvent {
      sessionId: string;
      command: string;
      duration: number;
      exitCode: number;
    }

    // Forward-declare event handlers for cleanup
    // biome-ignore lint/style/useConst: These are assigned later in the code
    let onSessionStarted: (sessionId: string, sessionName: string) => void;
    // biome-ignore lint/style/useConst: These are assigned later in the code
    let onSessionExited: (sessionId: string, sessionName: string, exitCode?: number) => void;
    // biome-ignore lint/style/useConst: These are assigned later in the code
    let onCommandFinished: (data: CommandFinishedEvent) => void;
    // biome-ignore lint/style/useConst: These are assigned later in the code
    let onClaudeTurn: (sessionId: string, sessionName: string) => void;

    // Cleanup function to remove event listeners
    const cleanup = () => {
      if (keepAlive) {
        clearInterval(keepAlive);
      }
      ptyManager.off('sessionStarted', onSessionStarted);
      ptyManager.off('sessionExited', onSessionExited);
      ptyManager.off('commandFinished', onCommandFinished);
      ptyManager.off('claudeTurn', onClaudeTurn);
    };

    // Send initial connection event
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

    // Event handlers
    const sendEvent = (type: ServerEventType, data: Omit<ServerEvent, 'type' | 'timestamp'>) => {
      const event: ServerEvent = {
        type,
        timestamp: new Date().toISOString(),
        ...data,
      };

      // Enhanced logging for all notification events
      if (
        type === ServerEventType.CommandFinished ||
        type === ServerEventType.CommandError ||
        type === ServerEventType.ClaudeTurn
      ) {
        logger.info(
          `🔔 NOTIFICATION DEBUG: Actually sending SSE event - type: ${type}, sessionId: ${data.sessionId}`
        );
      }

      // Enhanced logging for Claude-related events
      if (
        (type === ServerEventType.CommandFinished || type === ServerEventType.CommandError) &&
        data.command &&
        data.command.toLowerCase().includes('claude')
      ) {
        logger.log(`🚀 SSE: Sending Claude ${type} event for session ${data.sessionId}`);
      }

      // Proper SSE format with id, event, and data fields
      const sseMessage = `id: ${++eventId}\nevent: ${type}\ndata: ${JSON.stringify(event)}\n\n`;

      try {
        res.write(sseMessage);
      } catch (error) {
        logger.debug('Failed to write SSE event:', error);
        // Client disconnected, remove listeners
        cleanup();
      }
    };

    // Listen for session events
    onSessionStarted = (sessionId: string, sessionName: string) => {
      sendEvent(ServerEventType.SessionStart, { sessionId, sessionName });
    };

    onSessionExited = (sessionId: string, sessionName: string, exitCode?: number) => {
      sendEvent(ServerEventType.SessionExit, { sessionId, sessionName, exitCode });
    };

    onCommandFinished = (data: CommandFinishedEvent) => {
      const isClaudeCommand = data.command.toLowerCase().includes('claude');

      if (isClaudeCommand) {
        logger.debug(`📨 SSE Route: Received Claude commandFinished event - preparing to send SSE`);
      }

      const eventType = data.exitCode === 0 ? 'command-finished' : 'command-error';
      logger.info(
        `🔔 NOTIFICATION DEBUG: SSE forwarding ${eventType} event - sessionId: ${data.sessionId}, command: "${data.command}", duration: ${data.duration}ms, exitCode: ${data.exitCode}`
      );

      if (data.exitCode === 0) {
        sendEvent(ServerEventType.CommandFinished, {
          sessionId: data.sessionId,
          command: data.command,
          duration: data.duration,
          exitCode: data.exitCode,
        });
      } else {
        sendEvent(ServerEventType.CommandError, {
          sessionId: data.sessionId,
          command: data.command,
          duration: data.duration,
          exitCode: data.exitCode,
        });
      }
    };

    onClaudeTurn = (sessionId: string, sessionName: string) => {
      logger.info(
        `🔔 NOTIFICATION DEBUG: SSE forwarding claude-turn event - sessionId: ${sessionId}, sessionName: "${sessionName}"`
      );
      sendEvent(ServerEventType.ClaudeTurn, {
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
      cleanup();
    });
  });

  return router;
}
