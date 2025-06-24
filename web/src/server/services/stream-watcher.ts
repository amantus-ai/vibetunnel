import chalk from 'chalk';
import type { Response } from 'express';
import * as fs from 'fs';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('stream-watcher');

interface StreamClient {
  response: Response;
  startTime: number;
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
