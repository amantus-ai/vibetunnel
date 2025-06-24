# Large Paste Terminal Hang Investigation

## Problem Description
When pasting large amounts of text into the terminal via VibeTunnel proxy (Node binary), the terminal becomes completely unresponsive. This does not happen when running Claude app directly.

## Investigation Summary

### Root Cause Analysis
1. **No flow control or backpressure handling** when forwarding large amounts of data from stdin to the PTY process
2. All data arrives at once via stdin and is immediately written to PTY without checking if it can handle it
3. PTY buffer overflows causing the process to hang or crash
4. No error recovery mechanism if writes fail

### Additional Issues Found
1. **No buffering or flow control** for PTY output - all data is processed synchronously
2. **No WebSocket/SSE backpressure** - messages are sent without checking if clients can handle them
3. **Synchronous operations** in data processing pipeline that could block event loop
4. **Large terminal scrollback** (10,000 lines) could cause memory issues

## Solution Implemented

### 1. PTY Write Queue (Input Flow Control)
Created `/Users/steipete/Projects/vibetunnel/web/src/server/utils/pty-write-queue.ts`:

```typescript
import type { IPty } from '@homebridge/node-pty-prebuilt-multiarch';
import { EventEmitter } from 'events';

interface QueuedWrite {
  data: string;
  callback?: (error?: Error) => void;
}

export class PTYWriteQueue extends EventEmitter {
  private queue: QueuedWrite[] = [];
  private writing = false;
  private paused = false;
  private chunkSize = 4096; // 4KB chunks
  private maxQueueSize = 1000; // Maximum number of queued writes

  constructor(private pty: IPty) {
    super();
  }

  write(data: string, callback?: (error?: Error) => void): boolean {
    if (this.queue.length >= this.maxQueueSize) {
      const error = new Error('Write queue full');
      if (callback) callback(error);
      this.emit('error', error);
      return false;
    }

    // Split large data into chunks
    if (data.length > this.chunkSize) {
      const chunks = this.splitIntoChunks(data, this.chunkSize);
      chunks.forEach((chunk, index) => {
        // Only attach callback to the last chunk
        const cb = index === chunks.length - 1 ? callback : undefined;
        this.queue.push({ data: chunk, callback: cb });
      });
    } else {
      this.queue.push({ data, callback });
    }

    if (!this.writing && !this.paused) {
      this.processQueue();
    }

    // Return false if queue is getting full (backpressure signal)
    return this.queue.length < this.maxQueueSize / 2;
  }

  private splitIntoChunks(data: string, size: number): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < data.length; i += size) {
      chunks.push(data.slice(i, i + size));
    }
    return chunks;
  }

  private async processQueue(): Promise<void> {
    if (this.writing || this.paused || this.queue.length === 0) {
      return;
    }

    this.writing = true;

    while (this.queue.length > 0 && !this.paused) {
      const item = this.queue.shift();
      if (!item) continue; // This should never happen but satisfies the linter
      const { data, callback } = item;

      try {
        // node-pty write doesn't return a value indicating backpressure
        // We'll rely on error handling and our chunking mechanism
        this.pty.write(data);

        if (callback) callback();

        // Small delay between chunks to prevent overwhelming the PTY
        if (this.queue.length > 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }
      } catch (error) {
        if (callback) callback(error as Error);
        this.emit('error', error);
      }
    }

    this.writing = false;

    // Emit drain event when queue is empty
    if (this.queue.length === 0) {
      this.emit('drain');
    }
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.processQueue();
  }

  get queueLength(): number {
    return this.queue.length;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  destroy(): void {
    this.queue = [];
    this.removeAllListeners();
  }
}
```

### 2. PTY Output Queue (Output Flow Control)
Created `/Users/steipete/Projects/vibetunnel/web/src/server/utils/pty-output-queue.ts`:

```typescript
import type { IPty } from '@homebridge/node-pty-prebuilt-multiarch';
import { EventEmitter } from 'events';

interface QueuedOutput {
  data: string;
  timestamp: number;
}

interface OutputConsumer {
  id: string;
  canAccept: () => boolean;
  write: (data: string) => Promise<void>;
  onError?: (error: Error) => void;
}

export class PTYOutputQueue extends EventEmitter {
  private queue: QueuedOutput[] = [];
  private processing = false;
  private paused = false;
  private consumers: Map<string, OutputConsumer> = new Map();

  // Configuration
  private maxQueueSize = 1000; // Maximum number of queued outputs
  private maxQueueBytes = 10 * 1024 * 1024; // 10MB max queue size
  private processDelay = 1; // ms between processing chunks
  private chunkSize = 16384; // 16KB chunks for output
  private pauseThreshold = 0.8; // Pause PTY at 80% capacity
  private resumeThreshold = 0.5; // Resume PTY at 50% capacity

  // Metrics
  private currentQueueBytes = 0;
  private droppedCount = 0;

  constructor(private pty: IPty) {
    super();

    // Set up PTY output handler
    this.pty.onData((data: string) => {
      this.enqueue(data);
    });
  }

  /**
   * Add a consumer that will receive PTY output
   */
  addConsumer(consumer: OutputConsumer): void {
    this.consumers.set(consumer.id, consumer);
    this.emit('consumer-added', consumer.id);

    // Start processing if we have data
    if (this.queue.length > 0 && !this.processing) {
      this.processQueue();
    }
  }

  /**
   * Remove a consumer
   */
  removeConsumer(id: string): void {
    this.consumers.delete(id);
    this.emit('consumer-removed', id);
  }

  /**
   * Enqueue output data from PTY
   */
  private enqueue(data: string): void {
    const dataSize = Buffer.byteLength(data, 'utf8');

    // Check if we need to drop data due to queue limits
    if (
      this.queue.length >= this.maxQueueSize ||
      this.currentQueueBytes + dataSize > this.maxQueueBytes
    ) {
      // Drop oldest data if queue is full
      while (
        (this.queue.length >= this.maxQueueSize ||
          this.currentQueueBytes + dataSize > this.maxQueueBytes) &&
        this.queue.length > 0
      ) {
        const dropped = this.queue.shift();
        if (dropped) {
          this.currentQueueBytes -= Buffer.byteLength(dropped.data, 'utf8');
          this.droppedCount++;
        }
      }

      this.emit('data-dropped', this.droppedCount);
    }

    // Split large data into chunks
    if (data.length > this.chunkSize) {
      const chunks = this.splitIntoChunks(data, this.chunkSize);
      chunks.forEach((chunk) => {
        this.queue.push({ data: chunk, timestamp: Date.now() });
        this.currentQueueBytes += Buffer.byteLength(chunk, 'utf8');
      });
    } else {
      this.queue.push({ data, timestamp: Date.now() });
      this.currentQueueBytes += dataSize;
    }

    // Check if we should pause the PTY
    const queueRatio = this.currentQueueBytes / this.maxQueueBytes;
    if (!this.paused && queueRatio > this.pauseThreshold) {
      this.pausePTY();
    }

    // Start processing if not already running
    if (!this.processing && this.hasReadyConsumers()) {
      this.processQueue();
    }
  }

  /**
   * Split data into chunks
   */
  private splitIntoChunks(data: string, size: number): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < data.length; i += size) {
      chunks.push(data.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Check if any consumer is ready to accept data
   */
  private hasReadyConsumers(): boolean {
    for (const consumer of this.consumers.values()) {
      if (consumer.canAccept()) {
        return true;
      }
    }
    return false;
  }

  /**
   * Process queued output data
   */
  private async processQueue(): Promise<void> {
    if (this.processing) return;

    this.processing = true;

    while (this.queue.length > 0 && this.consumers.size > 0) {
      // Check if any consumer can accept data
      if (!this.hasReadyConsumers()) {
        // All consumers are busy, wait a bit
        await new Promise((resolve) => setTimeout(resolve, 10));
        continue;
      }

      const item = this.queue.shift();
      if (!item) continue;

      this.currentQueueBytes -= Buffer.byteLength(item.data, 'utf8');

      // Send to all ready consumers
      const promises: Promise<void>[] = [];
      for (const consumer of this.consumers.values()) {
        if (consumer.canAccept()) {
          promises.push(
            consumer.write(item.data).catch((error) => {
              if (consumer.onError) {
                consumer.onError(error);
              }
              this.emit('consumer-error', consumer.id, error);
            })
          );
        }
      }

      // Wait for all writes to complete
      await Promise.all(promises);

      // Add delay to prevent overwhelming the event loop
      if (this.queue.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.processDelay));
      }

      // Check if we should resume the PTY
      const queueRatio = this.currentQueueBytes / this.maxQueueBytes;
      if (this.paused && queueRatio < this.resumeThreshold) {
        this.resumePTY();
      }
    }

    this.processing = false;

    // Emit drain event when queue is empty
    if (this.queue.length === 0) {
      this.emit('drain');
    }
  }

  /**
   * Pause PTY output
   */
  private pausePTY(): void {
    if (!this.paused && this.pty.pause) {
      this.pty.pause();
      this.paused = true;
      this.emit('pty-paused', {
        queueSize: this.queue.length,
        queueBytes: this.currentQueueBytes,
      });
    }
  }

  /**
   * Resume PTY output
   */
  private resumePTY(): void {
    if (this.paused && this.pty.resume) {
      this.pty.resume();
      this.paused = false;
      this.emit('pty-resumed', {
        queueSize: this.queue.length,
        queueBytes: this.currentQueueBytes,
      });

      // Restart processing in case there's more data
      if (this.queue.length > 0 && !this.processing) {
        this.processQueue();
      }
    }
  }

  /**
   * Force resume (used when consumers become available)
   */
  forceResume(): void {
    if (this.paused) {
      this.resumePTY();
    }
    if (this.queue.length > 0 && !this.processing) {
      this.processQueue();
    }
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      queueLength: this.queue.length,
      queueBytes: this.currentQueueBytes,
      droppedCount: this.droppedCount,
      isPaused: this.paused,
      isProcessing: this.processing,
      consumerCount: this.consumers.size,
    };
  }

  /**
   * Clear the queue
   */
  clear(): void {
    this.queue = [];
    this.currentQueueBytes = 0;
    this.droppedCount = 0;
  }

  /**
   * Destroy the queue
   */
  destroy(): void {
    this.clear();
    this.consumers.clear();
    this.removeAllListeners();
    if (this.paused && this.pty.resume) {
      this.pty.resume();
    }
  }
}
```

### 3. Output Consumers
Created `/Users/steipete/Projects/vibetunnel/web/src/server/utils/output-consumers.ts`:

```typescript
import type { Writable } from 'stream';
import * as ws from 'ws';
import { createLogger } from './logger.js';

const logger = createLogger('output-consumers');

/**
 * Consumer for stdout forwarding
 */
export class StdoutConsumer {
  id = 'stdout';
  private lastWrite = 0;
  private minInterval = 1; // Minimum ms between writes

  canAccept(): boolean {
    // Rate limit stdout writes
    return Date.now() - this.lastWrite >= this.minInterval;
  }

  async write(data: string): Promise<void> {
    this.lastWrite = Date.now();
    process.stdout.write(data);
  }
}

/**
 * Consumer for file writing (AsciinemaWriter)
 */
export class FileConsumer {
  id: string;
  private writeQueue: string[] = [];
  private writing = false;
  private maxQueueSize = 100;

  constructor(
    private writer: { write: (data: string) => Promise<void> },
    id = 'file'
  ) {
    this.id = id;
  }

  canAccept(): boolean {
    return this.writeQueue.length < this.maxQueueSize;
  }

  async write(data: string): Promise<void> {
    this.writeQueue.push(data);
    if (!this.writing) {
      this.processWrites();
    }
  }

  private async processWrites(): Promise<void> {
    if (this.writing || this.writeQueue.length === 0) return;

    this.writing = true;

    while (this.writeQueue.length > 0) {
      const data = this.writeQueue.shift();
      if (data) {
        try {
          await this.writer.write(data);
        } catch (error) {
          logger.error('File write error:', error);
        }
      }
    }

    this.writing = false;
  }
}

/**
 * Consumer for WebSocket clients
 */
export class WebSocketConsumer {
  id: string;
  private maxBufferedAmount = 1024 * 1024; // 1MB max WebSocket buffer

  constructor(
    private ws: ws.WebSocket,
    private sessionId: string
  ) {
    this.id = `ws-${sessionId}`;
  }

  canAccept(): boolean {
    return this.ws.readyState === ws.OPEN && this.ws.bufferedAmount < this.maxBufferedAmount;
  }

  async write(data: string): Promise<void> {
    if (this.ws.readyState !== ws.OPEN) {
      throw new Error('WebSocket not open');
    }

    // For WebSocket, we might need to encode the data into a specific format
    // This is a placeholder - actual implementation depends on protocol
    this.ws.send(data);
  }

  onError(error: Error): void {
    logger.error(`WebSocket error for session ${this.sessionId}:`, error);
  }
}

/**
 * Consumer for SSE streams
 */
export class SSEConsumer {
  id: string;
  private buffer: string[] = [];
  private sending = false;
  private maxBufferSize = 50;

  constructor(
    private stream: Writable,
    private sessionId: string
  ) {
    this.id = `sse-${sessionId}`;
  }

  canAccept(): boolean {
    return !this.stream.destroyed && this.buffer.length < this.maxBufferSize;
  }

  async write(data: string): Promise<void> {
    if (this.stream.destroyed) {
      throw new Error('SSE stream destroyed');
    }

    this.buffer.push(data);
    if (!this.sending) {
      this.sendBuffer();
    }
  }

  private async sendBuffer(): Promise<void> {
    if (this.sending || this.buffer.length === 0) return;

    this.sending = true;

    while (this.buffer.length > 0 && !this.stream.destroyed) {
      const data = this.buffer.shift();
      if (data) {
        // Format as SSE event
        const event = `data: ${JSON.stringify({
          type: 'output',
          data,
          timestamp: Date.now(),
        })}\n\n`;

        // Write to stream with backpressure handling
        const canContinue = this.stream.write(event);
        if (!canContinue) {
          // Wait for drain event
          await new Promise<void>((resolve) => {
            this.stream.once('drain', resolve);
          });
        }
      }
    }

    this.sending = false;
  }

  onError(error: Error): void {
    logger.error(`SSE error for session ${this.sessionId}:`, error);
  }
}

/**
 * Consumer that batches data before sending
 */
export class BatchingConsumer {
  id: string;
  private batch: string[] = [];
  private batchTimeout?: NodeJS.Timeout;
  private batchSize = 10;
  private batchDelay = 50; // ms

  constructor(
    private target: {
      canAccept: () => boolean;
      write: (data: string) => Promise<void>;
    },
    id: string
  ) {
    this.id = id;
  }

  canAccept(): boolean {
    return this.batch.length < this.batchSize * 2 && this.target.canAccept();
  }

  async write(data: string): Promise<void> {
    this.batch.push(data);

    if (this.batch.length >= this.batchSize) {
      this.flush();
    } else if (!this.batchTimeout) {
      this.batchTimeout = setTimeout(() => this.flush(), this.batchDelay);
    }
  }

  private async flush(): Promise<void> {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = undefined;
    }

    if (this.batch.length === 0) return;

    const combined = this.batch.join('');
    this.batch = [];

    await this.target.write(combined);
  }

  async destroy(): Promise<void> {
    await this.flush();
  }
}

/**
 * Consumer for terminal manager
 */
export class TerminalConsumer {
  id: string;

  constructor(
    private terminalManager: {
      writeToTerminal: (sessionId: string, data: string) => Promise<void>;
      canAcceptData: (sessionId: string) => boolean;
    },
    private sessionId: string
  ) {
    this.id = `terminal-${sessionId}`;
  }

  canAccept(): boolean {
    return this.terminalManager.canAcceptData(this.sessionId);
  }

  async write(data: string): Promise<void> {
    await this.terminalManager.writeToTerminal(this.sessionId, data);
  }

  onError(error: Error): void {
    logger.error(`Terminal error for session ${this.sessionId}:`, error);
  }
}
```

### 4. Modified Files

#### `/Users/steipete/Projects/vibetunnel/web/src/server/pty/types.ts`
Added fields to PtySession interface:
```typescript
  writeQueue?: import('../utils/pty-write-queue.js').PTYWriteQueue;
  outputQueue?: import('../utils/pty-output-queue.js').PTYOutputQueue;
```

#### `/Users/steipete/Projects/vibetunnel/web/src/server/pty/pty-manager.ts`
Key changes:
1. Added imports for queue classes and consumers
2. Added `terminalManager` field for direct output mode
3. Created write queue and output queue for each session
4. Updated `setupStdinForwarding` to use write queue with flow control
5. Replaced `onData` handler with output queue consumers
6. Added `processBellCharacter` method
7. Added `setTerminalManager` method
8. Updated cleanup to destroy queues

#### `/Users/steipete/Projects/vibetunnel/web/src/server/services/terminal-manager.ts`
Added direct mode support:
1. Added `directMode` parameter to constructor
2. Added `writeToTerminal` method for direct data feed
3. Added `canAcceptData` method for backpressure

#### `/Users/steipete/Projects/vibetunnel/web/src/server/fwd.ts`
Added terminal manager initialization:
```typescript
// Initialize terminal manager in direct mode for output processing
const terminalManager = new TerminalManager(controlPath, true);
ptyManager.setTerminalManager(terminalManager);
```

#### `/Users/steipete/Projects/vibetunnel/web/src/server/services/buffer-aggregator.ts`
Added WebSocket backpressure check:
```typescript
// Check WebSocket buffer amount for backpressure
if (clientWs.bufferedAmount > 1024 * 1024) {
  // 1MB threshold
  logger.warn(`WebSocket buffered amount high: ${clientWs.bufferedAmount} bytes`);
}
```

#### `/Users/steipete/Projects/vibetunnel/web/src/server/services/stream-watcher.ts`
Added SSE backpressure detection:
```typescript
// Check if response can accept more data
const canWrite = client.response.write(clientData);
if (!canWrite) {
  logger.debug(`SSE stream backpressure detected for session ${sessionId}`);
}
```

## Why It Still Crashes

Despite comprehensive flow control implementation, the terminal still crashes. Possible reasons:

1. **Memory explosion** from multiple buffer copies
2. **Event loop starvation** from heavy processing
3. **Native node-pty crash** with large writes
4. **Resource exhaustion** (file descriptors, OS buffers)
5. **Cascading failure** where one component failing causes others to fail

## Next Steps

1. **Quick Fix**: Brutal simplification - disable features, reduce buffers
2. **Medium Fix**: True streaming architecture with Node.js streams
3. **Long Fix**: Architecture redesign with shared memory or domain sockets

The current solution may be over-engineered. A simpler approach focusing on the specific bottleneck might be more effective.