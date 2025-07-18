import { Terminal as XtermTerminal } from '@xterm/headless';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { ErrorDeduplicator, formatErrorSummary } from '../utils/error-deduplicator.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('terminal-manager');

// Helper function to truncate long strings for logging
function truncateForLog(str: string, maxLength: number = 50): string {
  if (str.length <= maxLength) return str;
  return `${str.substring(0, maxLength)}...(${str.length} chars total)`;
}

// Flow control configuration
const FLOW_CONTROL_CONFIG = {
  // When buffer exceeds this percentage of max lines, pause reading
  // 80% gives a good buffer before hitting the scrollback limit
  highWatermark: 0.8,
  // Resume reading when buffer drops below this percentage
  // 50% ensures enough space is cleared before resuming
  lowWatermark: 0.5,
  // Check interval for resuming paused sessions
  // 100ms provides responsive resumption without excessive CPU usage
  checkInterval: 100, // ms
  // Maximum pending lines to accumulate while paused
  // 10K lines handles bursts without excessive memory (avg ~1MB at 100 chars/line)
  maxPendingLines: 10000,
  // Maximum time a session can be paused before timing out
  // 5 minutes handles temporary client issues without indefinite memory growth
  maxPauseTime: 5 * 60 * 1000, // 5 minutes
  // Lines to process between buffer pressure checks
  // Checking every 100 lines balances performance with responsiveness
  bufferCheckInterval: 100,
};

interface SessionTerminal {
  terminal: XtermTerminal;
  watcher?: fs.FSWatcher;
  lastUpdate: number;
  isPaused?: boolean;
  pendingLines?: string[];
  pausedAt?: number;
  linesProcessedSinceCheck?: number;
  isProcessingPending?: boolean;
  lastFileOffset?: number;
  lineBuffer?: string;
}

type BufferChangeListener = (sessionId: string, snapshot: BufferSnapshot) => void;

interface BufferCell {
  char: string;
  width: number;
  fg?: number;
  bg?: number;
  attributes?: number;
}

interface BufferSnapshot {
  cols: number;
  rows: number;
  viewportY: number;
  cursorX: number;
  cursorY: number;
  cells: BufferCell[][];
}

export class TerminalManager {
  private terminals: Map<string, SessionTerminal> = new Map();
  private controlDir: string;
  private bufferListeners: Map<string, Set<BufferChangeListener>> = new Map();
  private changeTimers: Map<string, NodeJS.Timeout> = new Map();
  private writeQueues: Map<string, string[]> = new Map();
  private writeTimers: Map<string, NodeJS.Timeout> = new Map();
  private errorDeduplicator = new ErrorDeduplicator({
    keyExtractor: (error, context) => {
      // Use session ID and line prefix as context for xterm parsing errors
      const errorMessage = error instanceof Error ? error.message : String(error);
      return `${context}:${errorMessage}`;
    },
  });
  private originalConsoleWarn: typeof console.warn;
  private flowControlTimer?: NodeJS.Timeout;

  constructor(controlDir: string) {
    this.controlDir = controlDir;

    // Override console.warn to suppress xterm.js parsing warnings
    this.originalConsoleWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      const message = args[0];
      if (
        typeof message === 'string' &&
        (message.includes('xterm.js parsing error') ||
          message.includes('Unable to process character') ||
          message.includes('Cannot read properties of undefined'))
      ) {
        // Suppress xterm.js parsing warnings
        return;
      }
      this.originalConsoleWarn.apply(console, args);
    };

    // Start flow control check timer
    this.startFlowControlTimer();
  }

  /**
   * Get or create a terminal for a session
   */
  async getTerminal(sessionId: string): Promise<XtermTerminal> {
    let sessionTerminal = this.terminals.get(sessionId);

    if (!sessionTerminal) {
      // Create new terminal
      const terminal = new XtermTerminal({
        cols: 80,
        rows: 24,
        scrollback: 10000,
        allowProposedApi: true,
        convertEol: true,
      });

      sessionTerminal = {
        terminal,
        lastUpdate: Date.now(),
      };

      this.terminals.set(sessionId, sessionTerminal);
      logger.log(
        chalk.green(`Terminal created for session ${sessionId} (${terminal.cols}x${terminal.rows})`)
      );

      // Start watching the stream file
      await this.watchStreamFile(sessionId);
    }

    sessionTerminal.lastUpdate = Date.now();
    return sessionTerminal.terminal;
  }

  /**
   * Watch stream file for changes
   */
  private async watchStreamFile(sessionId: string): Promise<void> {
    const sessionTerminal = this.terminals.get(sessionId);
    if (!sessionTerminal) return;

    const streamPath = path.join(this.controlDir, sessionId, 'stdout');
    let lastOffset = sessionTerminal.lastFileOffset || 0;
    let lineBuffer = sessionTerminal.lineBuffer || '';

    // Check if the file exists
    if (!fs.existsSync(streamPath)) {
      logger.error(
        `Stream file does not exist for session ${truncateForLog(sessionId)}: ${truncateForLog(streamPath, 100)}`
      );
      return;
    }

    try {
      // Read existing content first
      const content = fs.readFileSync(streamPath, 'utf8');
      lastOffset = Buffer.byteLength(content, 'utf8');

      // Process existing content
      const lines = content.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          this.handleStreamLine(sessionId, sessionTerminal, line);
        }
      }

      // Watch for changes
      sessionTerminal.watcher = fs.watch(streamPath, (eventType) => {
        if (eventType === 'change') {
          try {
            const stats = fs.statSync(streamPath);
            if (stats.size > lastOffset) {
              // Read only the new data
              const fd = fs.openSync(streamPath, 'r');
              const buffer = Buffer.alloc(stats.size - lastOffset);
              fs.readSync(fd, buffer, 0, buffer.length, lastOffset);
              fs.closeSync(fd);

              // Update offset
              lastOffset = stats.size;
              sessionTerminal.lastFileOffset = lastOffset;

              // Process new data
              const newData = buffer.toString('utf8');
              lineBuffer += newData;

              // Process complete lines
              const lines = lineBuffer.split('\n');
              lineBuffer = lines.pop() || ''; // Keep incomplete line for next time
              sessionTerminal.lineBuffer = lineBuffer;

              for (const line of lines) {
                if (line.trim()) {
                  this.handleStreamLine(sessionId, sessionTerminal, line);
                }
              }
            }
          } catch (error) {
            logger.error(
              `Error reading stream file for session ${truncateForLog(sessionId)}:`,
              error
            );
          }
        }
      });

      logger.log(chalk.green(`Watching stream file for session ${truncateForLog(sessionId)}`));
    } catch (error) {
      logger.error(`Failed to watch stream file for session ${truncateForLog(sessionId)}:`, error);
      throw error;
    }
  }

  /**
   * Start flow control timer to check paused sessions
   */
  private startFlowControlTimer(): void {
    let checkIndex = 0;
    const sessionIds: string[] = [];

    this.flowControlTimer = setInterval(() => {
      // Rebuild session list periodically
      if (checkIndex === 0) {
        sessionIds.length = 0;
        for (const [sessionId, sessionTerminal] of this.terminals) {
          if (sessionTerminal.isPaused) {
            sessionIds.push(sessionId);
          }
        }
      }

      // Process one session per tick to avoid thundering herd
      if (sessionIds.length > 0) {
        const sessionId = sessionIds[checkIndex % sessionIds.length];
        const sessionTerminal = this.terminals.get(sessionId);

        if (sessionTerminal?.isPaused) {
          // Check for timeout
          if (
            sessionTerminal.pausedAt &&
            Date.now() - sessionTerminal.pausedAt > FLOW_CONTROL_CONFIG.maxPauseTime
          ) {
            logger.warn(
              chalk.red(
                `Session ${sessionId} has been paused for too long. ` +
                  `Dropping ${sessionTerminal.pendingLines?.length || 0} pending lines.`
              )
            );
            sessionTerminal.isPaused = false;
            sessionTerminal.pendingLines = [];
            sessionTerminal.pausedAt = undefined;

            // Resume file watching after timeout
            this.resumeFileWatcher(sessionId).catch((error) => {
              logger.error(
                `Failed to resume file watcher for session ${sessionId} after timeout:`,
                error
              );
            });
          } else {
            this.checkBufferPressure(sessionId);
          }
        }

        checkIndex = (checkIndex + 1) % Math.max(sessionIds.length, 1);
      }
    }, FLOW_CONTROL_CONFIG.checkInterval);
  }

  /**
   * Check buffer pressure and pause/resume as needed
   */
  private checkBufferPressure(sessionId: string): boolean {
    const sessionTerminal = this.terminals.get(sessionId);
    if (!sessionTerminal) return false;

    const terminal = sessionTerminal.terminal;
    const buffer = terminal.buffer.active;
    const maxLines = terminal.options.scrollback || 10000;
    const currentLines = buffer.length;
    const bufferUtilization = currentLines / maxLines;

    const wasPaused = sessionTerminal.isPaused || false;

    // Check if we should pause
    if (!wasPaused && bufferUtilization > FLOW_CONTROL_CONFIG.highWatermark) {
      sessionTerminal.isPaused = true;
      sessionTerminal.pendingLines = [];
      sessionTerminal.pausedAt = Date.now();

      // Apply backpressure by closing the file watcher
      if (sessionTerminal.watcher) {
        sessionTerminal.watcher.close();
        sessionTerminal.watcher = undefined;
      }

      logger.warn(
        chalk.yellow(
          `Buffer pressure high for session ${sessionId}: ${Math.round(bufferUtilization * 100)}% ` +
            `(${currentLines}/${maxLines} lines). Pausing file watcher.`
        )
      );
      return true;
    }

    // Check if we should resume
    if (wasPaused && bufferUtilization < FLOW_CONTROL_CONFIG.lowWatermark) {
      // Avoid race condition: mark as processing pending before resuming
      if (
        sessionTerminal.pendingLines &&
        sessionTerminal.pendingLines.length > 0 &&
        !sessionTerminal.isProcessingPending
      ) {
        sessionTerminal.isProcessingPending = true;

        const pendingCount = sessionTerminal.pendingLines.length;
        logger.log(
          chalk.green(
            `Buffer pressure normalized for session ${sessionId}: ${Math.round(bufferUtilization * 100)}% ` +
              `(${currentLines}/${maxLines} lines). Processing ${pendingCount} pending lines.`
          )
        );

        // Process pending lines asynchronously to avoid blocking
        setImmediate(() => {
          const lines = sessionTerminal.pendingLines || [];
          sessionTerminal.pendingLines = [];
          sessionTerminal.isPaused = false;
          sessionTerminal.pausedAt = undefined;
          sessionTerminal.isProcessingPending = false;

          for (const pendingLine of lines) {
            this.processStreamLine(sessionId, sessionTerminal, pendingLine);
          }

          // Resume file watching after processing pending lines
          this.resumeFileWatcher(sessionId).catch((error) => {
            logger.error(
              `Failed to resume file watcher for session ${truncateForLog(sessionId)}:`,
              error
            );
          });
        });
      } else if (!sessionTerminal.pendingLines || sessionTerminal.pendingLines.length === 0) {
        // No pending lines, just resume
        sessionTerminal.isPaused = false;
        sessionTerminal.pausedAt = undefined;

        // Resume file watching
        this.resumeFileWatcher(sessionId).catch((error) => {
          logger.error(
            `Failed to resume file watcher for session ${truncateForLog(sessionId)}:`,
            error
          );
        });

        logger.log(
          chalk.green(
            `Buffer pressure normalized for session ${sessionId}: ${Math.round(bufferUtilization * 100)}% ` +
              `(${currentLines}/${maxLines} lines). Resuming file watcher.`
          )
        );
      }
      return false;
    }

    return wasPaused;
  }

  /**
   * Handle stream line
   */
  private handleStreamLine(sessionId: string, sessionTerminal: SessionTerminal, line: string) {
    // Initialize line counter if needed
    if (sessionTerminal.linesProcessedSinceCheck === undefined) {
      sessionTerminal.linesProcessedSinceCheck = 0;
    }

    // Check buffer pressure periodically or if already paused
    let isPaused = sessionTerminal.isPaused || false;
    if (
      !isPaused &&
      sessionTerminal.linesProcessedSinceCheck >= FLOW_CONTROL_CONFIG.bufferCheckInterval
    ) {
      isPaused = this.checkBufferPressure(sessionId);
      sessionTerminal.linesProcessedSinceCheck = 0;
    }

    if (isPaused) {
      // Queue the line for later processing
      if (!sessionTerminal.pendingLines) {
        sessionTerminal.pendingLines = [];
      }

      // Limit pending lines to prevent memory issues
      if (sessionTerminal.pendingLines.length < FLOW_CONTROL_CONFIG.maxPendingLines) {
        sessionTerminal.pendingLines.push(line);
      } else {
        logger.warn(
          chalk.red(
            `Pending lines limit reached for session ${sessionId}. Dropping new data to prevent memory overflow.`
          )
        );
      }
      return;
    }

    sessionTerminal.linesProcessedSinceCheck++;
    this.processStreamLine(sessionId, sessionTerminal, line);
  }

  /**
   * Process a stream line (separated from handleStreamLine for flow control)
   */
  private processStreamLine(sessionId: string, sessionTerminal: SessionTerminal, line: string) {
    try {
      const data = JSON.parse(line);

      // Handle asciinema header
      if (data.version && data.width && data.height) {
        sessionTerminal.terminal.resize(data.width, data.height);
        this.notifyBufferChange(sessionId);
        return;
      }

      // Handle asciinema events [timestamp, type, data]
      if (Array.isArray(data) && data.length >= 3) {
        const [timestamp, type, eventData] = data;

        if (timestamp === 'exit') {
          // Session exited
          logger.log(
            chalk.yellow(`Session ${truncateForLog(sessionId)} exited with code ${data[1]}`)
          );
          if (sessionTerminal.watcher) {
            sessionTerminal.watcher.close();
          }
          return;
        }

        if (type === 'o') {
          // Output event - queue write to terminal with rate limiting
          this.queueTerminalWrite(sessionId, sessionTerminal, eventData);
          this.scheduleBufferChangeNotification(sessionId);
        } else if (type === 'r') {
          // Resize event
          const match = eventData.match(/^(\d+)x(\d+)$/);
          if (match) {
            const cols = Number.parseInt(match[1], 10);
            const rows = Number.parseInt(match[2], 10);
            sessionTerminal.terminal.resize(cols, rows);
            this.notifyBufferChange(sessionId);
          }
        }
        // Ignore 'i' (input) events
      }
    } catch (error) {
      // Use deduplicator to check if we should log this error
      // Use a more generic context key to group similar parsing errors together
      const contextKey = `${sessionId}:parse-stream-line`;

      if (this.errorDeduplicator.shouldLog(error, contextKey)) {
        const stats = this.errorDeduplicator.getErrorStats(error, contextKey);

        if (stats && stats.count > 1) {
          // Log summary for repeated errors
          logger.warn(formatErrorSummary(error, stats, `session ${truncateForLog(sessionId)}`));
        } else {
          // First occurrence - log the error with details
          const truncatedLine = line.length > 100 ? `${line.substring(0, 100)}...` : line;
          logger.error(
            `Failed to parse stream line for session ${truncateForLog(sessionId)}: ${truncatedLine}`
          );
          if (error instanceof Error && error.stack) {
            logger.debug(`Parse error details: ${error.message}`);
          }
        }
      }
    }
  }

  /**
   * Get buffer stats for a session
   */
  async getBufferStats(sessionId: string) {
    const terminal = await this.getTerminal(sessionId);
    const buffer = terminal.buffer.active;
    const sessionTerminal = this.terminals.get(sessionId);
    logger.debug(
      `Getting buffer stats for session ${truncateForLog(sessionId)}: ${buffer.length} total rows`
    );

    const maxLines = terminal.options.scrollback || 10000;
    const bufferUtilization = buffer.length / maxLines;

    return {
      totalRows: buffer.length,
      cols: terminal.cols,
      rows: terminal.rows,
      viewportY: buffer.viewportY,
      cursorX: buffer.cursorX,
      cursorY: buffer.cursorY,
      scrollback: terminal.options.scrollback || 0,
      // Flow control metrics
      isPaused: sessionTerminal?.isPaused || false,
      pendingLines: sessionTerminal?.pendingLines?.length || 0,
      bufferUtilization: Math.round(bufferUtilization * 100),
      maxBufferLines: maxLines,
    };
  }

  /**
   * Get buffer snapshot for a session - always returns full terminal buffer (cols x rows)
   */
  async getBufferSnapshot(sessionId: string): Promise<BufferSnapshot> {
    const startTime = Date.now();
    const terminal = await this.getTerminal(sessionId);
    const buffer = terminal.buffer.active;

    // Always get the visible terminal area from bottom
    const startLine = Math.max(0, buffer.length - terminal.rows);
    const endLine = buffer.length;
    const actualLines = endLine - startLine;

    // Get cursor position relative to our viewport
    const cursorX = buffer.cursorX;
    const cursorY = buffer.cursorY + buffer.viewportY - startLine;

    // Extract cells
    const cells: BufferCell[][] = [];
    const cell = buffer.getNullCell();

    for (let row = 0; row < actualLines; row++) {
      const line = buffer.getLine(startLine + row);
      const rowCells: BufferCell[] = [];

      if (line) {
        for (let col = 0; col < terminal.cols; col++) {
          line.getCell(col, cell);

          const char = cell.getChars() || ' ';
          const width = cell.getWidth();

          // Skip zero-width cells (part of wide characters)
          if (width === 0) continue;

          // Build attributes byte
          let attributes = 0;
          if (cell.isBold()) attributes |= 0x01;
          if (cell.isItalic()) attributes |= 0x02;
          if (cell.isUnderline()) attributes |= 0x04;
          if (cell.isDim()) attributes |= 0x08;
          if (cell.isInverse()) attributes |= 0x10;
          if (cell.isInvisible()) attributes |= 0x20;
          if (cell.isStrikethrough()) attributes |= 0x40;

          const bufferCell: BufferCell = {
            char,
            width,
          };

          // Only include non-default values
          const fg = cell.getFgColor();
          const bg = cell.getBgColor();

          // Handle color values - -1 means default color
          if (fg !== undefined && fg !== -1) bufferCell.fg = fg;
          if (bg !== undefined && bg !== -1) bufferCell.bg = bg;
          if (attributes !== 0) bufferCell.attributes = attributes;

          rowCells.push(bufferCell);
        }

        // Trim blank cells from the end of the line
        let lastNonBlankCell = rowCells.length - 1;
        while (lastNonBlankCell >= 0) {
          const cell = rowCells[lastNonBlankCell];
          if (
            cell.char !== ' ' ||
            cell.fg !== undefined ||
            cell.bg !== undefined ||
            cell.attributes !== undefined
          ) {
            break;
          }
          lastNonBlankCell--;
        }

        // Trim the array, but keep at least one cell
        if (lastNonBlankCell < rowCells.length - 1) {
          rowCells.splice(Math.max(1, lastNonBlankCell + 1));
        }
      } else {
        // Empty line - just add a single space
        rowCells.push({ char: ' ', width: 1 });
      }

      cells.push(rowCells);
    }

    // Trim blank lines from the bottom
    let lastNonBlankRow = cells.length - 1;
    while (lastNonBlankRow >= 0) {
      const row = cells[lastNonBlankRow];
      const hasContent = row.some(
        (cell) =>
          cell.char !== ' ' ||
          cell.fg !== undefined ||
          cell.bg !== undefined ||
          cell.attributes !== undefined
      );
      if (hasContent) break;
      lastNonBlankRow--;
    }

    // Keep at least one row
    const trimmedCells = cells.slice(0, Math.max(1, lastNonBlankRow + 1));

    const duration = Date.now() - startTime;
    if (duration > 10) {
      logger.debug(
        `Buffer snapshot for session ${sessionId} took ${duration}ms (${trimmedCells.length} rows)`
      );
    }

    return {
      cols: terminal.cols,
      rows: trimmedCells.length,
      viewportY: startLine,
      cursorX,
      cursorY,
      cells: trimmedCells,
    };
  }

  /**
   * Encode buffer snapshot to binary format - optimized for minimal data transmission
   */
  encodeSnapshot(snapshot: BufferSnapshot): Buffer {
    const startTime = Date.now();
    const { cols, rows, viewportY, cursorX, cursorY, cells } = snapshot;

    // Pre-calculate actual data size for efficiency
    let dataSize = 32; // Header size

    // First pass: calculate exact size needed
    for (let row = 0; row < cells.length; row++) {
      const rowCells = cells[row];
      if (
        rowCells.length === 0 ||
        (rowCells.length === 1 &&
          rowCells[0].char === ' ' &&
          !rowCells[0].fg &&
          !rowCells[0].bg &&
          !rowCells[0].attributes)
      ) {
        // Empty row marker: 2 bytes
        dataSize += 2;
      } else {
        // Row header: 3 bytes (marker + length)
        dataSize += 3;

        for (const cell of rowCells) {
          dataSize += this.calculateCellSize(cell);
        }
      }
    }

    const buffer = Buffer.allocUnsafe(dataSize);
    let offset = 0;

    // Write header (32 bytes)
    buffer.writeUInt16LE(0x5654, offset);
    offset += 2; // Magic "VT"
    buffer.writeUInt8(0x01, offset); // Version 1 - our only format
    offset += 1; // Version
    buffer.writeUInt8(0x00, offset);
    offset += 1; // Flags
    buffer.writeUInt32LE(cols, offset);
    offset += 4; // Cols (32-bit)
    buffer.writeUInt32LE(rows, offset);
    offset += 4; // Rows (32-bit)
    buffer.writeInt32LE(viewportY, offset); // Signed for large buffers
    offset += 4; // ViewportY (32-bit signed)
    buffer.writeInt32LE(cursorX, offset); // Signed for consistency
    offset += 4; // CursorX (32-bit signed)
    buffer.writeInt32LE(cursorY, offset); // Signed for relative positions
    offset += 4; // CursorY (32-bit signed)
    buffer.writeUInt32LE(0, offset);
    offset += 4; // Reserved

    // Write cells with new optimized format
    for (let row = 0; row < cells.length; row++) {
      const rowCells = cells[row];

      // Check if this is an empty row
      if (
        rowCells.length === 0 ||
        (rowCells.length === 1 &&
          rowCells[0].char === ' ' &&
          !rowCells[0].fg &&
          !rowCells[0].bg &&
          !rowCells[0].attributes)
      ) {
        // Empty row marker
        buffer.writeUInt8(0xfe, offset++); // Empty row marker
        buffer.writeUInt8(1, offset++); // Count of empty rows (for now just 1)
      } else {
        // Row with content
        buffer.writeUInt8(0xfd, offset++); // Row marker
        buffer.writeUInt16LE(rowCells.length, offset); // Number of cells in row
        offset += 2;

        // Write each cell
        for (const cell of rowCells) {
          offset = this.encodeCell(buffer, offset, cell);
        }
      }
    }

    // Return exact size buffer
    const result = buffer.subarray(0, offset);

    const duration = Date.now() - startTime;
    if (duration > 5) {
      logger.debug(`Encoded snapshot: ${result.length} bytes in ${duration}ms (${rows} rows)`);
    }

    return result;
  }

  /**
   * Calculate the size needed to encode a cell
   */
  private calculateCellSize(cell: BufferCell): number {
    // Optimized encoding:
    // - Simple space with default colors: 1 byte
    // - ASCII char with default colors: 2 bytes
    // - ASCII char with colors/attrs: 2-8 bytes
    // - Unicode char: variable

    const isSpace = cell.char === ' ';
    const hasAttrs = cell.attributes && cell.attributes !== 0;
    const hasFg = cell.fg !== undefined;
    const hasBg = cell.bg !== undefined;
    const isAscii = cell.char.charCodeAt(0) <= 127;

    if (isSpace && !hasAttrs && !hasFg && !hasBg) {
      return 1; // Just a space marker
    }

    let size = 1; // Type byte

    if (isAscii) {
      size += 1; // ASCII character
    } else {
      const charBytes = Buffer.byteLength(cell.char, 'utf8');
      size += 1 + charBytes; // Length byte + UTF-8 bytes
    }

    // Attributes/colors byte
    if (hasAttrs || hasFg || hasBg) {
      size += 1; // Flags byte

      if (hasFg && cell.fg !== undefined) {
        size += cell.fg > 255 ? 3 : 1; // RGB or palette
      }

      if (hasBg && cell.bg !== undefined) {
        size += cell.bg > 255 ? 3 : 1; // RGB or palette
      }
    }

    return size;
  }

  /**
   * Encode a single cell into the buffer
   */
  private encodeCell(buffer: Buffer, offset: number, cell: BufferCell): number {
    const isSpace = cell.char === ' ';
    const hasAttrs = cell.attributes && cell.attributes !== 0;
    const hasFg = cell.fg !== undefined;
    const hasBg = cell.bg !== undefined;
    const isAscii = cell.char.charCodeAt(0) <= 127;

    // Type byte format:
    // Bit 7: Has extended data (attrs/colors)
    // Bit 6: Is Unicode (vs ASCII)
    // Bit 5: Has foreground color
    // Bit 4: Has background color
    // Bit 3: Is RGB foreground (vs palette)
    // Bit 2: Is RGB background (vs palette)
    // Bits 1-0: Character type (00=space, 01=ASCII, 10=Unicode)

    if (isSpace && !hasAttrs && !hasFg && !hasBg) {
      // Simple space - 1 byte
      buffer.writeUInt8(0x00, offset++); // Type: space, no extended data
      return offset;
    }

    let typeByte = 0;

    if (hasAttrs || hasFg || hasBg) {
      typeByte |= 0x80; // Has extended data
    }

    if (!isAscii) {
      typeByte |= 0x40; // Is Unicode
      typeByte |= 0x02; // Character type: Unicode
    } else if (!isSpace) {
      typeByte |= 0x01; // Character type: ASCII
    }

    if (hasFg && cell.fg !== undefined) {
      typeByte |= 0x20; // Has foreground
      if (cell.fg > 255) typeByte |= 0x08; // Is RGB
    }

    if (hasBg && cell.bg !== undefined) {
      typeByte |= 0x10; // Has background
      if (cell.bg > 255) typeByte |= 0x04; // Is RGB
    }

    buffer.writeUInt8(typeByte, offset++);

    // Write character
    if (!isAscii) {
      const charBytes = Buffer.from(cell.char, 'utf8');
      buffer.writeUInt8(charBytes.length, offset++);
      charBytes.copy(buffer, offset);
      offset += charBytes.length;
    } else if (!isSpace) {
      buffer.writeUInt8(cell.char.charCodeAt(0), offset++);
    }

    // Write extended data if present
    if (typeByte & 0x80) {
      // Attributes byte (if any)
      if (hasAttrs && cell.attributes !== undefined) {
        buffer.writeUInt8(cell.attributes, offset++);
      } else if (hasFg || hasBg) {
        buffer.writeUInt8(0, offset++); // No attributes but need the byte
      }

      // Foreground color
      if (hasFg && cell.fg !== undefined) {
        if (cell.fg > 255) {
          // RGB
          buffer.writeUInt8((cell.fg >> 16) & 0xff, offset++);
          buffer.writeUInt8((cell.fg >> 8) & 0xff, offset++);
          buffer.writeUInt8(cell.fg & 0xff, offset++);
        } else {
          // Palette
          buffer.writeUInt8(cell.fg, offset++);
        }
      }

      // Background color
      if (hasBg && cell.bg !== undefined) {
        if (cell.bg > 255) {
          // RGB
          buffer.writeUInt8((cell.bg >> 16) & 0xff, offset++);
          buffer.writeUInt8((cell.bg >> 8) & 0xff, offset++);
          buffer.writeUInt8(cell.bg & 0xff, offset++);
        } else {
          // Palette
          buffer.writeUInt8(cell.bg, offset++);
        }
      }
    }

    return offset;
  }

  /**
   * Close a terminal session
   */
  closeTerminal(sessionId: string): void {
    const sessionTerminal = this.terminals.get(sessionId);
    if (sessionTerminal) {
      if (sessionTerminal.watcher) {
        sessionTerminal.watcher.close();
      }
      sessionTerminal.terminal.dispose();
      this.terminals.delete(sessionId);

      // Clear write timer if exists
      const writeTimer = this.writeTimers.get(sessionId);
      if (writeTimer) {
        clearTimeout(writeTimer);
        this.writeTimers.delete(sessionId);
      }

      // Clear write queue
      this.writeQueues.delete(sessionId);

      logger.log(chalk.yellow(`Terminal closed for session ${truncateForLog(sessionId)}`));
    }
  }

  /**
   * Clean up old terminals
   */
  cleanup(maxAge: number = 30 * 60 * 1000): void {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [sessionId, sessionTerminal] of this.terminals) {
      if (now - sessionTerminal.lastUpdate > maxAge) {
        toRemove.push(sessionId);
      }
    }

    for (const sessionId of toRemove) {
      logger.log(
        chalk.yellow(`Cleaning up stale terminal for session ${truncateForLog(sessionId)}`)
      );
      this.closeTerminal(sessionId);
    }

    if (toRemove.length > 0) {
      logger.log(chalk.gray(`Cleaned up ${toRemove.length} stale terminals`));
    }
  }

  /**
   * Queue terminal write with rate limiting to prevent flow control issues
   */
  private queueTerminalWrite(sessionId: string, sessionTerminal: SessionTerminal, data: string) {
    // Get or create write queue for this session
    let queue = this.writeQueues.get(sessionId);
    if (!queue) {
      queue = [];
      this.writeQueues.set(sessionId, queue);
    }

    // Add data to queue
    queue.push(data);

    // If no write timer is active, start processing the queue
    if (!this.writeTimers.has(sessionId)) {
      this.processWriteQueue(sessionId, sessionTerminal);
    }
  }

  /**
   * Process write queue with rate limiting
   */
  private processWriteQueue(sessionId: string, sessionTerminal: SessionTerminal) {
    const queue = this.writeQueues.get(sessionId);
    if (!queue || queue.length === 0) {
      this.writeTimers.delete(sessionId);
      return;
    }

    // Process a batch of writes (limit batch size to prevent overwhelming the terminal)
    const batchSize = 10;
    const batch = queue.splice(0, batchSize);
    const combinedData = batch.join('');

    try {
      sessionTerminal.terminal.write(combinedData);
    } catch (error) {
      // Use error deduplicator to prevent log spam
      const contextKey = `${sessionId}:terminal-write`;

      if (this.errorDeduplicator.shouldLog(error, contextKey)) {
        const stats = this.errorDeduplicator.getErrorStats(error, contextKey);

        if (stats && stats.count > 1) {
          // Log summary for repeated errors
          logger.warn(
            formatErrorSummary(
              error,
              stats,
              `terminal write for session ${truncateForLog(sessionId)}`
            )
          );
        } else {
          // First occurrence - log with more detail
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.warn(
            `Terminal write error for session ${truncateForLog(sessionId)}: ${errorMessage}`
          );
          if (error instanceof Error && error.stack) {
            logger.debug(`Write error stack: ${error.stack}`);
          }
        }
      }
    }

    // Schedule next batch processing
    if (queue.length > 0) {
      const timer = setTimeout(() => {
        this.processWriteQueue(sessionId, sessionTerminal);
      }, 10); // 10ms delay between batches
      this.writeTimers.set(sessionId, timer);
    } else {
      this.writeTimers.delete(sessionId);
    }
  }

  /**
   * Get all active terminals
   */
  getActiveTerminals(): string[] {
    return Array.from(this.terminals.keys());
  }

  /**
   * Subscribe to buffer changes for a session
   */
  async subscribeToBufferChanges(
    sessionId: string,
    listener: BufferChangeListener
  ): Promise<() => void> {
    // Ensure terminal exists and is watching
    await this.getTerminal(sessionId);

    if (!this.bufferListeners.has(sessionId)) {
      this.bufferListeners.set(sessionId, new Set());
    }

    const listeners = this.bufferListeners.get(sessionId);
    if (listeners) {
      listeners.add(listener);
      logger.log(
        chalk.blue(`Buffer listener subscribed for session ${sessionId} (${listeners.size} total)`)
      );
    }

    // Return unsubscribe function
    return () => {
      const listeners = this.bufferListeners.get(sessionId);
      if (listeners) {
        listeners.delete(listener);
        logger.log(
          chalk.yellow(
            `Buffer listener unsubscribed for session ${sessionId} (${listeners.size} remaining)`
          )
        );
        if (listeners.size === 0) {
          this.bufferListeners.delete(sessionId);
        }
      }
    };
  }

  /**
   * Schedule buffer change notification (debounced)
   */
  private scheduleBufferChangeNotification(sessionId: string) {
    // Cancel existing timer
    const existingTimer = this.changeTimers.get(sessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule new notification in 50ms
    const timer = setTimeout(() => {
      this.changeTimers.delete(sessionId);
      this.notifyBufferChange(sessionId);
    }, 50);

    this.changeTimers.set(sessionId, timer);
  }

  /**
   * Notify listeners of buffer change
   */
  private async notifyBufferChange(sessionId: string) {
    const listeners = this.bufferListeners.get(sessionId);
    if (!listeners || listeners.size === 0) return;

    logger.debug(
      `Notifying ${listeners.size} buffer change listeners for session ${truncateForLog(sessionId)}`
    );

    try {
      // Get full buffer snapshot
      const snapshot = await this.getBufferSnapshot(sessionId);

      // Notify all listeners
      listeners.forEach((listener) => {
        try {
          listener(sessionId, snapshot);
        } catch (error) {
          logger.error(
            `Error notifying buffer change listener for ${truncateForLog(sessionId)}:`,
            error
          );
        }
      });
    } catch (error) {
      logger.error(
        `Error getting buffer snapshot for notification ${truncateForLog(sessionId)}:`,
        error
      );
    }
  }

  /**
   * Resume file watching for a paused session
   */
  private async resumeFileWatcher(sessionId: string): Promise<void> {
    const sessionTerminal = this.terminals.get(sessionId);
    if (!sessionTerminal || sessionTerminal.watcher) {
      return; // Already watching or session doesn't exist
    }

    await this.watchStreamFile(sessionId);
  }

  /**
   * Destroy the terminal manager and restore console overrides
   */
  destroy(): void {
    // Close all terminals
    for (const sessionId of this.terminals.keys()) {
      this.closeTerminal(sessionId);
    }

    // Clear all timers
    for (const timer of this.changeTimers.values()) {
      clearTimeout(timer);
    }
    this.changeTimers.clear();

    // Clear write timers
    for (const timer of this.writeTimers.values()) {
      clearTimeout(timer);
    }
    this.writeTimers.clear();

    // Clear write queues
    this.writeQueues.clear();

    // Clear flow control timer
    if (this.flowControlTimer) {
      clearInterval(this.flowControlTimer);
      this.flowControlTimer = undefined;
    }

    // Restore original console.warn
    console.warn = this.originalConsoleWarn;
  }
}
