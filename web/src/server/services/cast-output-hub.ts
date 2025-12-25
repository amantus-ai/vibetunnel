import chalk from 'chalk';
import * as fs from 'fs';
import type { SessionManager } from '../pty/session-manager.js';
import type { AsciinemaHeader } from '../pty/types.js';
import { createLogger } from '../utils/logger.js';
import {
  calculatePruningPositionInFile,
  containsPruningSequence,
  findLastPrunePoint,
  logPruningDetection,
} from '../utils/pruning-detector.js';

const logger = createLogger('cast-output-hub');

const HEADER_READ_BUFFER_SIZE = 4096;

type AsciinemaOutputEvent = [number, 'o', string];
type AsciinemaInputEvent = [number, 'i', string];
type AsciinemaResizeEvent = [number, 'r', string];
type AsciinemaExitEvent = ['exit', number, string];
type AsciinemaEvent =
  | AsciinemaOutputEvent
  | AsciinemaInputEvent
  | AsciinemaResizeEvent
  | AsciinemaExitEvent;

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

export type CastOutputHubEvent =
  | { kind: 'header'; header: AsciinemaHeader }
  | { kind: 'output'; data: string; historical: boolean }
  | { kind: 'resize'; dimensions: string; historical: boolean }
  | { kind: 'exit'; exitCode: number }
  | { kind: 'error'; message: string };

export type CastOutputHubListener = (event: CastOutputHubEvent) => void;

interface WatcherInfo {
  streamPath: string;
  clients: Set<CastOutputHubListener>;
  watcher?: fs.FSWatcher;
  lastOffset: number;
  lastSize: number;
  lastMtime: number;
  lineBuffer: string;
  retryTimer?: NodeJS.Timeout;
}

export class CastOutputHub {
  private activeWatchers: Map<string, WatcherInfo> = new Map();

  constructor(private sessionManager: SessionManager) {
    process.on('beforeExit', () => this.cleanup());
  }

  subscribe(sessionId: string, listener: CastOutputHubListener): () => void {
    const paths = this.sessionManager.getSessionPaths(sessionId, true);
    if (!paths) {
      listener({ kind: 'error', message: 'Session paths not found' });
      return () => {};
    }

    const streamPath = paths.stdoutPath;
    let watcherInfo = this.activeWatchers.get(sessionId);

    if (!watcherInfo) {
      watcherInfo = {
        streamPath,
        clients: new Set(),
        lastOffset: 0,
        lastSize: 0,
        lastMtime: 0,
        lineBuffer: '',
      };
      this.activeWatchers.set(sessionId, watcherInfo);

      // Send existing content (pruned) to the first subscriber.
      this.sendExistingContent(sessionId, streamPath, listener);

      // Initialize offsets if file exists.
      if (fs.existsSync(streamPath)) {
        const stats = fs.statSync(streamPath);
        watcherInfo.lastOffset = stats.size;
        watcherInfo.lastSize = stats.size;
        watcherInfo.lastMtime = stats.mtimeMs;
      }

      // Start watching (or retry until file exists).
      this.startWatchingWithRetry(sessionId, watcherInfo);
    } else {
      // Send pruned existing content to late joiners too.
      this.sendExistingContent(sessionId, watcherInfo.streamPath, listener);
    }

    watcherInfo.clients.add(listener);

    return () => {
      const current = this.activeWatchers.get(sessionId);
      if (!current) return;
      current.clients.delete(listener);

      if (current.clients.size === 0) {
        this.stopWatching(sessionId);
      }
    };
  }

  private stopWatching(sessionId: string) {
    const watcherInfo = this.activeWatchers.get(sessionId);
    if (!watcherInfo) return;

    watcherInfo.retryTimer && clearTimeout(watcherInfo.retryTimer);
    watcherInfo.watcher?.close();
    watcherInfo.watcher = undefined;
    this.activeWatchers.delete(sessionId);
    logger.debug(chalk.yellow(`stopped cast watcher for session ${sessionId}`));
  }

  private startWatchingWithRetry(sessionId: string, watcherInfo: WatcherInfo) {
    if (watcherInfo.watcher) return;

    if (!fs.existsSync(watcherInfo.streamPath)) {
      watcherInfo.retryTimer = setTimeout(() => {
        watcherInfo.retryTimer = undefined;
        this.startWatchingWithRetry(sessionId, watcherInfo);
      }, 200);
      return;
    }

    this.startWatching(sessionId, watcherInfo);
  }

  private startWatching(sessionId: string, watcherInfo: WatcherInfo): void {
    watcherInfo.watcher = fs.watch(watcherInfo.streamPath, { persistent: true }, (eventType) => {
      if (eventType !== 'change') return;

      try {
        const stats = fs.statSync(watcherInfo.streamPath);
        if (!(stats.size > watcherInfo.lastSize || stats.mtimeMs > watcherInfo.lastMtime)) return;

        watcherInfo.lastSize = stats.size;
        watcherInfo.lastMtime = stats.mtimeMs;

        if (stats.size <= watcherInfo.lastOffset) return;

        const fd = fs.openSync(watcherInfo.streamPath, 'r');
        const buffer = Buffer.alloc(stats.size - watcherInfo.lastOffset);
        fs.readSync(fd, buffer, 0, buffer.length, watcherInfo.lastOffset);
        fs.closeSync(fd);

        watcherInfo.lastOffset = stats.size;

        watcherInfo.lineBuffer += buffer.toString('utf8');
        const lines = watcherInfo.lineBuffer.split('\n');
        watcherInfo.lineBuffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          this.broadcastLine(sessionId, line, watcherInfo);
        }
      } catch (error) {
        logger.error(`failed to read file changes for session ${sessionId}:`, error);
      }
    });

    watcherInfo.watcher.on('error', (error) => {
      logger.error(`file watcher error for session ${sessionId}:`, error);
    });

    logger.debug(chalk.green(`watching cast file for session ${sessionId}`));
  }

  private parseAsciinemaLine(line: string): AsciinemaEvent | AsciinemaHeader | null {
    if (!line.trim()) return null;
    try {
      const parsed = JSON.parse(line);
      if (parsed.version && parsed.width && parsed.height) return parsed as AsciinemaHeader;
      if (Array.isArray(parsed)) {
        if (parsed[0] === 'exit') return parsed as AsciinemaExitEvent;
        if (parsed.length >= 3 && typeof parsed[0] === 'number') return parsed as AsciinemaEvent;
      }
      return null;
    } catch {
      return null;
    }
  }

  private broadcastLine(_sessionId: string, line: string, watcherInfo: WatcherInfo): void {
    const parsed = this.parseAsciinemaLine(line);
    if (!parsed) {
      // Treat as raw output line
      for (const client of watcherInfo.clients) {
        client({ kind: 'output', data: line, historical: false });
      }
      return;
    }

    // Skip headers during live follow (clients already got one from existing content).
    if (!Array.isArray(parsed)) return;

    if (isExitEvent(parsed)) {
      for (const client of watcherInfo.clients) {
        client({ kind: 'exit', exitCode: parsed[1] });
      }
      return;
    }

    if (isOutputEvent(parsed)) {
      for (const client of watcherInfo.clients) {
        client({ kind: 'output', data: parsed[2], historical: false });
      }
    } else if (isResizeEvent(parsed)) {
      for (const client of watcherInfo.clients) {
        client({ kind: 'resize', dimensions: parsed[2], historical: false });
      }
    }
  }

  private processClearSequence(
    event: AsciinemaOutputEvent,
    eventIndex: number,
    fileOffset: number,
    currentResize: AsciinemaResizeEvent | null,
    eventLine: string
  ): {
    lastClearIndex: number;
    lastClearOffset: number;
    lastResizeBeforeClear: AsciinemaResizeEvent | null;
  } | null {
    const prunePoint = findLastPrunePoint(event[2]);
    if (!prunePoint) return null;

    const lastClearOffset = calculatePruningPositionInFile(
      fileOffset,
      eventLine,
      prunePoint.position
    );
    logPruningDetection(prunePoint.sequence, lastClearOffset, '(retroactive scan)');

    return {
      lastClearIndex: eventIndex,
      lastClearOffset,
      lastResizeBeforeClear: currentResize,
    };
  }

  private sendExistingContent(
    sessionId: string,
    streamPath: string,
    listener: CastOutputHubListener
  ) {
    try {
      const sessionInfo = this.sessionManager.loadSessionInfo(sessionId);
      let startOffset = sessionInfo?.lastClearOffset ?? 0;
      if (fs.existsSync(streamPath)) {
        const stats = fs.statSync(streamPath);
        startOffset = Math.min(startOffset, stats.size);
      }

      // Read header line (best-effort)
      let header: AsciinemaHeader | null = null;
      let fd: number | null = null;
      try {
        fd = fs.openSync(streamPath, 'r');
        const buf = Buffer.alloc(HEADER_READ_BUFFER_SIZE);
        let data = '';
        let filePosition = 0;
        let bytesRead = fs.readSync(fd, buf, 0, buf.length, filePosition);

        while (!data.includes('\n') && bytesRead > 0) {
          data += buf.toString('utf8', 0, bytesRead);
          filePosition += bytesRead;
          if (!data.includes('\n')) {
            bytesRead = fs.readSync(fd, buf, 0, buf.length, filePosition);
          }
        }

        const idx = data.indexOf('\n');
        if (idx !== -1) header = JSON.parse(data.slice(0, idx));
      } catch {
        // ignore
      } finally {
        if (fd !== null) {
          try {
            fs.closeSync(fd);
          } catch {
            // ignore
          }
        }
      }

      const analysisStream = fs.createReadStream(streamPath, {
        encoding: 'utf8',
        start: startOffset,
      });
      let lineBuffer = '';
      const events: AsciinemaEvent[] = [];
      let lastClearIndex = -1;
      let lastResizeBeforeClear: AsciinemaResizeEvent | null = null;
      let currentResize: AsciinemaResizeEvent | null = null;

      let fileOffset = startOffset;
      let lastClearOffset = startOffset;

      const processLine = (line: string) => {
        fileOffset += Buffer.byteLength(line, 'utf8') + 1;
        if (!line.trim()) return;

        try {
          const parsed = JSON.parse(line);
          if (parsed.version && parsed.width && parsed.height) {
            header = parsed as AsciinemaHeader;
            return;
          }

          if (!Array.isArray(parsed)) return;

          if (parsed[0] === 'exit') {
            events.push(parsed as AsciinemaExitEvent);
            return;
          }

          if (parsed.length < 3 || typeof parsed[0] !== 'number') return;
          const event = parsed as AsciinemaEvent;

          if (isResizeEvent(event)) currentResize = event;

          if (isOutputEvent(event) && containsPruningSequence(event[2])) {
            const clearResult = this.processClearSequence(
              event as AsciinemaOutputEvent,
              events.length,
              fileOffset,
              currentResize,
              line
            );
            if (clearResult) {
              lastClearIndex = clearResult.lastClearIndex;
              lastClearOffset = clearResult.lastClearOffset;
              lastResizeBeforeClear = clearResult.lastResizeBeforeClear;
            }
          }

          events.push(event);
        } catch {
          // ignore invalid lines
        }
      };

      analysisStream.on('data', (chunk: string | Buffer) => {
        lineBuffer += chunk.toString();
        let idx = lineBuffer.indexOf('\n');
        while (idx !== -1) {
          const line = lineBuffer.slice(0, idx);
          lineBuffer = lineBuffer.slice(idx + 1);
          processLine(line);
          idx = lineBuffer.indexOf('\n');
        }
      });

      analysisStream.on('end', () => {
        if (lineBuffer.trim()) {
          // last line without trailing newline
          processLine(lineBuffer);
        }

        let startIndex = 0;
        if (lastClearIndex >= 0) {
          startIndex = lastClearIndex + 1;
          if (sessionInfo) {
            sessionInfo.lastClearOffset = lastClearOffset;
            this.sessionManager.saveSessionInfo(sessionId, sessionInfo);
          }
        }

        if (header) {
          const headerToSend = { ...header };
          if (lastClearIndex >= 0 && lastResizeBeforeClear) {
            const [w, h] = lastResizeBeforeClear[2].split('x');
            headerToSend.width = Number.parseInt(w, 10);
            headerToSend.height = Number.parseInt(h, 10);
          }
          listener({ kind: 'header', header: headerToSend });
        }

        let exitFound = false;
        for (let i = startIndex; i < events.length; i++) {
          const event = events[i];
          if (isExitEvent(event)) {
            exitFound = true;
            listener({ kind: 'exit', exitCode: event[1] });
          } else if (isOutputEvent(event)) {
            listener({ kind: 'output', data: event[2], historical: true });
          } else if (isResizeEvent(event)) {
            listener({ kind: 'resize', dimensions: event[2], historical: true });
          }
        }

        if (exitFound) {
          // Caller may choose to unsubscribe.
        }
      });

      analysisStream.on('error', (error) => {
        logger.error(`failed to read existing cast content for ${sessionId}:`, error);
        listener({ kind: 'error', message: 'Failed to read session output' });
      });
    } catch (error) {
      logger.error(`failed to send existing cast content for ${sessionId}:`, error);
      listener({ kind: 'error', message: 'Failed to read session output' });
    }
  }

  private cleanup(): void {
    for (const [sessionId] of this.activeWatchers) {
      this.stopWatching(sessionId);
    }
  }
}
