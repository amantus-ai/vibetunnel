/**
 * Enhanced write queue with flow control and backpressure support
 */
import { EventEmitter } from 'events';
import { createLogger } from './logger.js';

const logger = createLogger('write-queue-flow-control');

export interface FlowControlOptions {
  /** Maximum queue size in bytes before applying backpressure */
  highWatermark?: number;
  /** Queue size in bytes to resume after backpressure */
  lowWatermark?: number;
  /** Maximum number of pending operations */
  maxOperations?: number;
  /** Enable debug logging */
  debug?: boolean;
}

export interface QueueMetrics {
  queuedBytes: number;
  queuedOperations: number;
  isPaused: boolean;
  totalBytesProcessed: number;
  totalOperationsProcessed: number;
  droppedBytes: number;
  droppedOperations: number;
}

interface QueuedOperation {
  data: Buffer | string;
  size: number;
  writeFn: () => Promise<void> | void;
  timestamp: number;
}

export class WriteQueueWithFlowControl extends EventEmitter {
  private queue: QueuedOperation[] = [];
  private processing = false;
  private queuedBytes = 0;
  private isPaused = false;
  private totalBytesProcessed = 0;
  private totalOperationsProcessed = 0;
  private droppedBytes = 0;
  private droppedOperations = 0;
  
  // Default flow control settings
  private readonly highWatermark: number;
  private readonly lowWatermark: number;
  private readonly maxOperations: number;
  private readonly debug: boolean;

  constructor(options: FlowControlOptions = {}) {
    super();
    
    // Set defaults with reasonable values for terminal output
    this.highWatermark = options.highWatermark ?? 10 * 1024 * 1024; // 10MB
    this.lowWatermark = options.lowWatermark ?? 5 * 1024 * 1024; // 5MB
    this.maxOperations = options.maxOperations ?? 1000;
    this.debug = options.debug ?? false;
    
    // Validate watermarks
    if (this.lowWatermark >= this.highWatermark) {
      throw new Error('lowWatermark must be less than highWatermark');
    }
  }

  /**
   * Enqueue a write operation with data size tracking
   * @returns true if enqueued, false if dropped due to backpressure
   */
  enqueue(data: Buffer | string, writeFn: () => Promise<void> | void): boolean {
    const size = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data, 'utf8');
    
    // Check if we should drop this data due to extreme backpressure
    if (this.isPaused && this.queue.length >= this.maxOperations) {
      this.droppedBytes += size;
      this.droppedOperations++;
      
      if (this.debug) {
        logger.warn(`Dropping data: ${size} bytes (queue full with ${this.queue.length} operations)`);
      }
      
      this.emit('drop', { size, queueLength: this.queue.length });
      return false;
    }
    
    // Add to queue
    this.queue.push({
      data,
      size,
      writeFn,
      timestamp: Date.now()
    });
    
    this.queuedBytes += size;
    
    // Check if we should pause
    if (!this.isPaused && this.queuedBytes >= this.highWatermark) {
      this.pause();
    }
    
    // Process queue if not already processing
    if (!this.processing) {
      this.processQueue();
    }
    
    return true;
  }

  /**
   * Process queued operations
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }
    
    this.processing = true;
    
    while (this.queue.length > 0) {
      const operation = this.queue.shift()!;
      this.queuedBytes -= operation.size;
      
      try {
        await operation.writeFn();
        
        this.totalBytesProcessed += operation.size;
        this.totalOperationsProcessed++;
        
        // Check if we should resume
        if (this.isPaused && this.queuedBytes <= this.lowWatermark) {
          this.resume();
        }
        
        // Emit progress for monitoring
        if (this.debug && this.totalOperationsProcessed % 100 === 0) {
          logger.debug(`Processed ${this.totalOperationsProcessed} operations, ${this.totalBytesProcessed} bytes`);
        }
      } catch (error) {
        logger.error('WriteQueue operation error:', error);
        this.emit('error', error);
      }
    }
    
    this.processing = false;
    
    // Emit drain event when queue is empty
    if (this.queue.length === 0) {
      this.emit('drain');
    }
  }

  /**
   * Pause the queue (emit pause event for upstream flow control)
   */
  private pause(): void {
    if (this.isPaused) return;
    
    this.isPaused = true;
    
    if (this.debug) {
      logger.warn(`Queue paused: ${this.queuedBytes} bytes queued (high watermark: ${this.highWatermark})`);
    }
    
    this.emit('pause');
  }

  /**
   * Resume the queue (emit resume event for upstream flow control)
   */
  private resume(): void {
    if (!this.isPaused) return;
    
    this.isPaused = false;
    
    if (this.debug) {
      logger.info(`Queue resumed: ${this.queuedBytes} bytes queued (low watermark: ${this.lowWatermark})`);
    }
    
    this.emit('resume');
  }

  /**
   * Wait for all queued operations to complete
   */
  async drain(): Promise<void> {
    if (this.queue.length === 0) return;
    
    return new Promise((resolve) => {
      this.once('drain', resolve);
    });
  }

  /**
   * Get current queue metrics
   */
  getMetrics(): QueueMetrics {
    return {
      queuedBytes: this.queuedBytes,
      queuedOperations: this.queue.length,
      isPaused: this.isPaused,
      totalBytesProcessed: this.totalBytesProcessed,
      totalOperationsProcessed: this.totalOperationsProcessed,
      droppedBytes: this.droppedBytes,
      droppedOperations: this.droppedOperations
    };
  }

  /**
   * Clear the queue (emergency use only)
   */
  clear(): void {
    const clearedBytes = this.queuedBytes;
    const clearedOps = this.queue.length;
    
    this.queue = [];
    this.queuedBytes = 0;
    
    if (this.isPaused) {
      this.resume();
    }
    
    logger.warn(`Queue cleared: dropped ${clearedOps} operations (${clearedBytes} bytes)`);
  }
}