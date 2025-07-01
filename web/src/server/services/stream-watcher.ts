import chalk from 'chalk';
import type { Response } from 'express';
import * as fs from 'fs';
import type { AsciinemaHeader } from '../pty/types.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('stream-watcher');

interface StreamClient {
  response: Response;
  startTime: number;
}

// Type for asciinema event array format
type AsciinemaOutputEvent = [number, 'o', string];
type AsciinemaInputEvent = [number, 'i', string];
type AsciinemaResizeEvent = [number, 'r', string];
type AsciinemaExitEvent = ['exit', number, string];
type AsciinemaEvent =
  | AsciinemaOutputEvent
  | AsciinemaInputEvent
  | AsciinemaResizeEvent
  | AsciinemaExitEvent;

// Type guard functions
function isOutputEvent(event: AsciinemaEvent): event is AsciinemaOutputEvent {
  return (
    Array.isArray(event) && event.length === 3 && event[1] === 'o' && typeof event[0] === 'number'
  );
}

function isResizeEvent(event: AsciinemaEvent): event is AsciinemaResizeEvent {
  return (
    Array.isArray(event) && event.length === 3 && event[1] === 'r' && typeof event[0] === 'number'
  );
}

function isExitEvent(event: AsciinemaEvent): event is AsciinemaExitEvent {
  return Array.isArray(event) && event[0] === 'exit';
}

interface WatcherInfo {
  clients: Set<StreamClient>;
  watcher?: fs.FSWatcher;
  lastOffset: number;
  lastSize: number;
  lastMtime: number;
  lineBuffer: string;
}

export class StreamWatcher {
  private activeWatchers: Map<string, WatcherInfo> = new Map();

  constructor() {
    // Clean up notification listeners on exit
    process.on('beforeExit', () => {
      this.cleanup();
    });
    logger.debug('stream watcher initialized');
  }

  /**
   * Add a client to watch a stream file
   */
  addClient(sessionId: string, streamPath: string, response: Response): void {
    logger.debug(`adding client to session ${sessionId}`);
    const startTime = Date.now() / 1000;
    const client: StreamClient = { response, startTime };

    let watcherInfo = this.activeWatchers.get(sessionId);

    if (!watcherInfo) {
      // Create new watcher for this session
      logger.log(chalk.green(`creating new stream watcher for session ${sessionId}`));
      watcherInfo = {
        clients: new Set(),
        lastOffset: 0,
        lastSize: 0,
        lastMtime: 0,
        lineBuffer: '',
      };
      this.activeWatchers.set(sessionId, watcherInfo);

      // Send existing content first
      this.sendExistingContent(streamPath, client);

      // Get current file size and stats
      if (fs.existsSync(streamPath)) {
        const stats = fs.statSync(streamPath);
        watcherInfo.lastOffset = stats.size;
        watcherInfo.lastSize = stats.size;
        watcherInfo.lastMtime = stats.mtimeMs;
        logger.debug(`initial file size: ${stats.size} bytes`);
      } else {
        logger.debug(`stream file does not exist yet: ${streamPath}`);
      }

      // Start watching for new content
      this.startWatching(sessionId, streamPath, watcherInfo);
    } else {
      // Send existing content to new client
      this.sendExistingContent(streamPath, client);
    }

    // Add client to set
    watcherInfo.clients.add(client);
    logger.log(
      chalk.blue(`client connected to stream ${sessionId} (${watcherInfo.clients.size} total)`)
    );
  }

  /**
   * Remove a client
   */
  removeClient(sessionId: string, response: Response): void {
    const watcherInfo = this.activeWatchers.get(sessionId);
    if (!watcherInfo) {
      logger.debug(`no watcher found for session ${sessionId}`);
      return;
    }

    // Find and remove client
    let clientToRemove: StreamClient | undefined;
    for (const client of watcherInfo.clients) {
      if (client.response === response) {
        clientToRemove = client;
        break;
      }
    }

    if (clientToRemove) {
      watcherInfo.clients.delete(clientToRemove);
      logger.log(
        chalk.yellow(
          `client disconnected from stream ${sessionId} (${watcherInfo.clients.size} remaining)`
        )
      );

      // If no more clients, stop watching
      if (watcherInfo.clients.size === 0) {
        logger.log(chalk.yellow(`stopping watcher for session ${sessionId} (no clients)`));
        if (watcherInfo.watcher) {
          watcherInfo.watcher.close();
        }
        this.activeWatchers.delete(sessionId);
      }
    }
  }

  /**
   * Send existing content to a client
   */
  private sendExistingContent(streamPath: string, client: StreamClient): void {
    try {
      // First pass: analyze the stream to find the last clear and track resize events
      const analysisStream = fs.createReadStream(streamPath, { encoding: 'utf8' });
      let lineBuffer = '';
      const events: AsciinemaEvent[] = [];
      let lastClearIndex = -1;
      let lastResizeBeforeClear: AsciinemaResizeEvent | null = null;
      let currentResize: AsciinemaResizeEvent | null = null;
      let header: AsciinemaHeader | null = null;

      analysisStream.on('data', (chunk: string | Buffer) => {
        lineBuffer += chunk.toString();
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || ''; // Keep incomplete line for next chunk

        for (const line of lines) {
          if (line.trim()) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.version && parsed.width && parsed.height) {
                header = parsed;
              } else if (Array.isArray(parsed)) {
                // Check if it's an exit event first
                if (parsed[0] === 'exit') {
                  events.push(parsed as AsciinemaExitEvent);
                } else if (parsed.length >= 3 && typeof parsed[0] === 'number') {
                  const event = parsed as AsciinemaEvent;

                  // Track resize events
                  if (isResizeEvent(event)) {
                    currentResize = event;
                  }

                  // Check for clear sequence in output events
                  if (isOutputEvent(event) && event[2].includes('\x1b[3J')) {
                    lastClearIndex = events.length;
                    lastResizeBeforeClear = currentResize;
                    logger.debug(
                      `found clear sequence at event index ${lastClearIndex}, current resize: ${currentResize ? currentResize[2] : 'none'}`
                    );
                  }

                  events.push(event);
                }
              }
            } catch (e) {
              logger.debug(`skipping invalid JSON line during analysis: ${e}`);
            }
          }
        }
      });

      analysisStream.on('end', () => {
        // Process any remaining line in analysis
        if (lineBuffer.trim()) {
          try {
            const parsed = JSON.parse(lineBuffer);
            if (Array.isArray(parsed)) {
              if (parsed[0] === 'exit') {
                events.push(parsed as AsciinemaExitEvent);
              } else if (parsed.length >= 3 && typeof parsed[0] === 'number') {
                const event = parsed as AsciinemaEvent;

                if (isResizeEvent(event)) {
                  currentResize = event;
                }
                if (isOutputEvent(event) && event[2].includes('\x1b[3J')) {
                  lastClearIndex = events.length;
                  lastResizeBeforeClear = currentResize;
                  logger.debug(
                    `found clear sequence at event index ${lastClearIndex} (last event)`
                  );
                }
                events.push(event);
              }
            }
          } catch (e) {
            logger.debug(`skipping invalid JSON in line buffer during analysis: ${e}`);
          }
        }

        // Now replay the stream with pruning
        let startIndex = 0;

        if (lastClearIndex >= 0) {
          // Start from after the last clear
          startIndex = lastClearIndex + 1;
          logger.log(
            chalk.green(`pruning stream: skipping ${lastClearIndex + 1} events before last clear`)
          );
        }

        // Send header first - update dimensions if we have a resize
        if (header) {
          const headerToSend = { ...header };
          if (lastClearIndex >= 0 && lastResizeBeforeClear) {
            // Update header with last known dimensions before clear
            const dimensions = lastResizeBeforeClear[2].split('x');
            headerToSend.width = Number.parseInt(dimensions[0], 10);
            headerToSend.height = Number.parseInt(dimensions[1], 10);
          }
          client.response.write(`data: ${JSON.stringify(headerToSend)}\n\n`);
        }

        // Send remaining events
        let exitEventFound = false;
        for (let i = startIndex; i < events.length; i++) {
          const event = events[i];
          if (isExitEvent(event)) {
            exitEventFound = true;
            client.response.write(`data: ${JSON.stringify(event)}\n\n`);
          } else if (isOutputEvent(event) || isResizeEvent(event)) {
            // Set timestamp to 0 for existing content
            const instantEvent: AsciinemaEvent = [0, event[1], event[2]];
            client.response.write(`data: ${JSON.stringify(instantEvent)}\n\n`);
          }
        }

        // If exit event found, close connection
        if (exitEventFound) {
          logger.log(
            chalk.yellow(
              `session ${client.response.locals?.sessionId || 'unknown'} already ended, closing stream`
            )
          );
          client.response.end();
        }
      });

      analysisStream.on('error', (error) => {
        logger.error('failed to analyze stream for pruning:', error);
        // Fall back to original implementation without pruning
        this.sendExistingContentWithoutPruning(streamPath, client);
      });
    } catch (error) {
      logger.error('failed to create read stream:', error);
    }
  }

  /**
   * Original implementation without pruning (fallback)
   */
  private sendExistingContentWithoutPruning(streamPath: string, client: StreamClient): void {
    try {
      const stream = fs.createReadStream(streamPath, { encoding: 'utf8' });
      let exitEventFound = false;
      let lineBuffer = '';

      stream.on('data', (chunk: string | Buffer) => {
        lineBuffer += chunk.toString();
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || ''; // Keep incomplete line for next chunk

        for (const line of lines) {
          if (line.trim()) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.version && parsed.width && parsed.height) {
                // Send header as-is
                client.response.write(`data: ${line}\n\n`);
              } else if (Array.isArray(parsed) && parsed.length >= 3) {
                if (parsed[0] === 'exit') {
                  exitEventFound = true;
                  client.response.write(`data: ${line}\n\n`);
                } else {
                  // Set timestamp to 0 for existing content
                  const instantEvent = [0, parsed[1], parsed[2]];
                  client.response.write(`data: ${JSON.stringify(instantEvent)}\n\n`);
                }
              }
            } catch (e) {
              logger.debug(`skipping invalid JSON line during replay: ${e}`);
            }
          }
        }
      });

      stream.on('end', () => {
        // Process any remaining line
        if (lineBuffer.trim()) {
          try {
            const parsed = JSON.parse(lineBuffer);
            if (parsed.version && parsed.width && parsed.height) {
              client.response.write(`data: ${lineBuffer}\n\n`);
            } else if (Array.isArray(parsed) && parsed.length >= 3) {
              if (parsed[0] === 'exit') {
                exitEventFound = true;
                client.response.write(`data: ${lineBuffer}\n\n`);
              } else {
                const instantEvent = [0, parsed[1], parsed[2]];
                client.response.write(`data: ${JSON.stringify(instantEvent)}\n\n`);
              }
            }
          } catch (e) {
            logger.debug(`skipping invalid JSON in line buffer: ${e}`);
          }
        }

        // If exit event found, close connection
        if (exitEventFound) {
          logger.log(
            chalk.yellow(
              `session ${client.response.locals?.sessionId || 'unknown'} already ended, closing stream`
            )
          );
          client.response.end();
        }
      });

      stream.on('error', (error) => {
        logger.error('failed to stream existing content:', error);
      });
    } catch (error) {
      logger.error('failed to create read stream:', error);
    }
  }

  /**
   * Start watching a file for changes
   */
  private startWatching(sessionId: string, streamPath: string, watcherInfo: WatcherInfo): void {
    logger.log(chalk.green(`started watching stream file for session ${sessionId}`));

    // Use standard fs.watch with stat checking
    watcherInfo.watcher = fs.watch(streamPath, { persistent: true }, (eventType) => {
      if (eventType === 'change') {
        try {
          // Check if file actually changed by comparing stats
          const stats = fs.statSync(streamPath);

          // Only process if size increased (append-only file)
          if (stats.size > watcherInfo.lastSize || stats.mtimeMs > watcherInfo.lastMtime) {
            const sizeDiff = stats.size - watcherInfo.lastSize;
            if (sizeDiff > 0) {
              logger.debug(`file grew by ${sizeDiff} bytes`);
            }
            watcherInfo.lastSize = stats.size;
            watcherInfo.lastMtime = stats.mtimeMs;

            // Read only new data
            if (stats.size > watcherInfo.lastOffset) {
              const fd = fs.openSync(streamPath, 'r');
              const buffer = Buffer.alloc(stats.size - watcherInfo.lastOffset);
              fs.readSync(fd, buffer, 0, buffer.length, watcherInfo.lastOffset);
              fs.closeSync(fd);

              // Update offset
              watcherInfo.lastOffset = stats.size;

              // Process new data
              const newData = buffer.toString('utf8');
              watcherInfo.lineBuffer += newData;

              // Process complete lines
              const lines = watcherInfo.lineBuffer.split('\n');
              watcherInfo.lineBuffer = lines.pop() || '';

              for (const line of lines) {
                if (line.trim()) {
                  this.broadcastLine(sessionId, line, watcherInfo);
                }
              }
            }
          }
        } catch (error) {
          logger.error('failed to read file changes:', error);
        }
      }
    });

    watcherInfo.watcher.on('error', (error) => {
      logger.error(`file watcher error for session ${sessionId}:`, error);
    });
  }

  /**
   * Broadcast a line to all clients
   */
  private broadcastLine(sessionId: string, line: string, watcherInfo: WatcherInfo): void {
    let eventData: string | null = null;

    try {
      const parsed = JSON.parse(line);
      if (parsed.version && parsed.width && parsed.height) {
        return; // Skip duplicate headers
      }
      if (Array.isArray(parsed) && parsed.length >= 3) {
        if (parsed[0] === 'exit') {
          logger.log(chalk.yellow(`session ${sessionId} ended with exit code ${parsed[2]}`));
          eventData = `data: ${JSON.stringify(parsed)}\n\n`;

          // Send exit event to all clients and close connections
          for (const client of watcherInfo.clients) {
            try {
              client.response.write(eventData);
              client.response.end();
            } catch (error) {
              logger.error('failed to send exit event to client:', error);
            }
          }
          return;
        } else {
          // Calculate relative timestamp for each client
          for (const client of watcherInfo.clients) {
            const currentTime = Date.now() / 1000;
            const relativeEvent = [currentTime - client.startTime, parsed[1], parsed[2]];
            const clientData = `data: ${JSON.stringify(relativeEvent)}\n\n`;

            try {
              client.response.write(clientData);
              // @ts-expect-error - flush exists but not in types
              if (client.response.flush) client.response.flush();
            } catch (error) {
              logger.debug(
                `client write failed (likely disconnected): ${error instanceof Error ? error.message : String(error)}`
              );
            }
          }
          return; // Already handled per-client
        }
      }
    } catch {
      // Handle non-JSON as raw output
      logger.debug(`broadcasting raw output line: ${line.substring(0, 50)}...`);
      const currentTime = Date.now() / 1000;
      for (const client of watcherInfo.clients) {
        const castEvent = [currentTime - client.startTime, 'o', line];
        const clientData = `data: ${JSON.stringify(castEvent)}\n\n`;

        try {
          client.response.write(clientData);
          // @ts-expect-error - flush exists but not in types
          if (client.response.flush) client.response.flush();
        } catch (error) {
          logger.debug(
            `client write failed (likely disconnected): ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
      return;
    }
  }

  /**
   * Clean up all watchers and listeners
   */
  private cleanup(): void {
    const watcherCount = this.activeWatchers.size;
    if (watcherCount > 0) {
      logger.log(chalk.yellow(`cleaning up ${watcherCount} active watchers`));
      for (const [sessionId, watcherInfo] of this.activeWatchers) {
        if (watcherInfo.watcher) {
          watcherInfo.watcher.close();
        }
        logger.debug(`closed watcher for session ${sessionId}`);
      }
      this.activeWatchers.clear();
    }
  }
}
