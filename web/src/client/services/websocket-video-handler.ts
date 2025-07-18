import { createLogger } from '../utils/logger.js';

const logger = createLogger('websocket-video-handler');

export class WebSocketVideoHandler {
  private mediaSource: MediaSource | null = null;
  private sourceBuffer: SourceBuffer | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private frameQueue: ArrayBuffer[] = [];
  private isProcessing = false;
  private stream: MediaStream | null = null;

  constructor() {
    logger.log('WebSocket video handler initialized');
  }

  /**
   * Initialize the video handler with a video element
   */
  async initialize(videoElement: HTMLVideoElement): Promise<MediaStream> {
    this.videoElement = videoElement;

    // For WebSocket streaming, we'll use MediaSource API to feed video data
    if ('MediaSource' in window) {
      this.mediaSource = new MediaSource();
      this.videoElement.src = URL.createObjectURL(this.mediaSource);

      return new Promise((resolve, reject) => {
        if (!this.mediaSource) {
          reject(new Error('MediaSource not initialized'));
          return;
        }

        this.mediaSource.addEventListener('sourceopen', async () => {
          try {
            logger.log('MediaSource opened, ready state:', this.mediaSource!.readyState);
            
            // Create source buffer for WebM/VP8
            this.sourceBuffer = this.mediaSource!.addSourceBuffer('video/webm; codecs="vp8"');
            logger.log('Created SourceBuffer for video/webm; codecs="vp8"');

            this.sourceBuffer.addEventListener('updateend', () => {
              logger.log('SourceBuffer updateend event, queue length:', this.frameQueue.length);
              this.processFrameQueue();
            });

            // Create a MediaStream from the video element
            // @ts-ignore - captureStream might not be in TypeScript definitions
            if (this.videoElement.captureStream) {
              // @ts-ignore
              this.stream = this.videoElement.captureStream();
              logger.log('Created MediaStream from video element');
              if (this.stream) {
                resolve(this.stream);
              } else {
                reject(new Error('Failed to create MediaStream from video element'));
              }
            } else {
              // Fallback: create empty MediaStream and add tracks later
              this.stream = new MediaStream();
              logger.log('Created empty MediaStream (captureStream not supported)');
              resolve(this.stream);
            }
          } catch (error) {
            logger.error('Error initializing MediaSource:', error);
            reject(error);
          }
        });

        this.mediaSource.addEventListener('error', (error) => {
          logger.error('MediaSource error:', error);
          reject(error);
        });
      });
    } else {
      // Fallback for browsers without MediaSource API
      logger.warn('MediaSource API not supported, using fallback');
      this.stream = new MediaStream();
      return Promise.resolve(this.stream);
    }
  }

  /**
   * Handle incoming video frame data from WebSocket
   */
  handleVideoFrame(data: ArrayBuffer): void {
    // Skip the 'VF' header (first 2 bytes)
    const frameData = data.slice(2);
    
    logger.log(`Received video frame: ${frameData.byteLength} bytes after header removal`);

    if (this.sourceBuffer && !this.sourceBuffer.updating) {
      try {
        logger.log(`Appending ${frameData.byteLength} bytes to source buffer`);
        this.sourceBuffer.appendBuffer(frameData);
      } catch (error) {
        logger.error('Error appending buffer:', error);
        // Queue the frame if we can't append immediately
        this.frameQueue.push(frameData);
      }
    } else {
      // Queue frames if source buffer is busy
      logger.log(`Queueing frame, sourceBuffer exists: ${!!this.sourceBuffer}, updating: ${this.sourceBuffer?.updating}`);
      this.frameQueue.push(frameData);
      if (this.frameQueue.length > 100) {
        // Drop old frames if queue is too large
        this.frameQueue.shift();
        logger.warn('Dropping old frame due to queue overflow');
      }
    }
  }

  /**
   * Process queued video frames
   */
  private processFrameQueue(): void {
    if (this.isProcessing || !this.sourceBuffer || this.sourceBuffer.updating) {
      return;
    }

    if (this.frameQueue.length > 0) {
      this.isProcessing = true;
      const frame = this.frameQueue.shift();

      if (frame) {
        try {
          this.sourceBuffer.appendBuffer(frame);
        } catch (error) {
          logger.error('Error processing queued frame:', error);
          // Re-queue the frame if there was an error
          this.frameQueue.unshift(frame);
        }
      }

      this.isProcessing = false;
    }
  }

  /**
   * Get the current MediaStream
   */
  getStream(): MediaStream | null {
    return this.stream;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.mediaSource && this.mediaSource.readyState === 'open') {
      try {
        this.mediaSource.endOfStream();
      } catch (error) {
        logger.error('Error ending stream:', error);
      }
    }

    if (this.videoElement && this.videoElement.src) {
      URL.revokeObjectURL(this.videoElement.src);
      this.videoElement.src = '';
    }

    this.frameQueue = [];
    this.sourceBuffer = null;
    this.mediaSource = null;
    this.videoElement = null;
    this.stream = null;
    this.isProcessing = false;

    logger.log('WebSocket video handler disposed');
  }
}
