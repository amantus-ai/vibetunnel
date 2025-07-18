import { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';
import type { CaptureSession } from '../capture/desktop-capture-service.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('linux-webrtc-handler');

// WebRTC types for TypeScript
interface RTCSessionDescription {
  type: 'offer' | 'answer';
  sdp: string;
}

interface RTCIceCandidate {
  candidate: string;
  sdpMLineIndex?: number;
  sdpMid?: string;
}

export class LinuxWebRTCHandler extends EventEmitter {
  private streamUrl: string | null = null;
  private isStreaming = false;
  private frameInterval?: NodeJS.Timeout;
  private ffmpegStream: Readable | null = null;
  private streamBuffer: Buffer[] = [];

  constructor(
    private captureSession: CaptureSession,
    private sessionId: string
  ) {
    super();
    logger.log(`Created WebRTC handler for session ${sessionId}`);
  }

  async initialize(): Promise<void> {
    logger.log('Initializing Linux WebRTC handler for WebSocket streaming');
    logger.log(`Capture session ID: ${this.captureSession.id}`);
    logger.log(`Capture stream available: ${!!this.captureSession.captureStream}`);

    // Get the FFmpeg stream from capture session
    if (this.captureSession.captureStream) {
      this.ffmpegStream = this.captureSession.captureStream.stream;
      this.streamUrl = `/api/screencap/stream/${this.sessionId}`;
      logger.log(`Stream URL: ${this.streamUrl}`);
      logger.log(
        `FFmpeg stream available: ${!!this.ffmpegStream}, readable: ${this.ffmpegStream?.readable}`
      );

      // Check if stream is already ended
      if (this.ffmpegStream.readableEnded) {
        logger.error('FFmpeg stream is already ended!');
        return;
      }

      // IMPORTANT: Resume the stream to ensure data flows
      // Node.js streams might be paused by default
      if (typeof this.ffmpegStream.pause === 'function') {
        logger.log('Stream appears to be pausable, resuming...');
        this.ffmpegStream.resume();
      }

      // Set up stream buffering
      this.setupStreamBuffering();

      // Check if there's buffered data from the capture service
      const extendedSession = this.captureSession as CaptureSession & {
        _tempDataHandler?: (chunk: Buffer) => void;
        _tempBuffer?: Buffer[];
      };
      const tempHandler = extendedSession._tempDataHandler;
      const tempBuffer = extendedSession._tempBuffer;

      if (tempHandler) {
        logger.log('Removing temporary data handler from capture service');
        this.ffmpegStream.removeListener('data', tempHandler);
        delete extendedSession._tempDataHandler;
      }

      if (tempBuffer && tempBuffer.length > 0) {
        logger.log(`Replaying ${tempBuffer.length} buffered chunks`);
        // Replay buffered data
        for (const chunk of tempBuffer) {
          this.emit('video-frame', chunk);
        }
        delete extendedSession._tempBuffer;
      }
    } else {
      logger.error('No capture stream available from session');
      logger.error('Session details:', {
        id: this.captureSession.id,
        hasStream: !!this.captureSession.captureStream,
        startTime: this.captureSession.startTime,
      });
    }
  }

  private setupStreamBuffering(): void {
    if (!this.ffmpegStream) return;

    let frameCount = 0;
    let totalBytes = 0;

    // Buffer incoming video data
    this.ffmpegStream.on('data', (chunk: Buffer) => {
      frameCount++;
      totalBytes += chunk.length;
      if (frameCount <= 5 || frameCount % 100 === 1) {
        logger.log(
          `FFmpeg data: frame ${frameCount}, chunk size: ${chunk.length}, total: ${totalBytes} bytes`
        );
      }
      // For WebSocket streaming, we'll emit video frames directly
      this.emit('video-frame', chunk);

      // Log if we have any listeners
      if (frameCount === 1) {
        logger.log(`video-frame event listeners: ${this.listenerCount('video-frame')}`);
      }
    });

    this.ffmpegStream.on('error', (error) => {
      logger.error('FFmpeg stream error:', error);
      this.emit('stream-error', error);
    });

    this.ffmpegStream.on('end', () => {
      logger.log(`FFmpeg stream ended. Total frames: ${frameCount}, bytes: ${totalBytes}`);
      this.emit('stream-ended');
    });
  }

  async createOffer(): Promise<void> {
    // For Linux, we create a simplified offer that indicates WebSocket streaming
    // The actual video data will be sent as binary frames over the WebSocket
    const offer: RTCSessionDescription = {
      type: 'offer',
      sdp: this.generateWebSocketStreamingSDP(),
    };

    logger.log('Created WebSocket streaming offer for Linux');
    logger.log(`Emitting offer, listeners: ${this.listenerCount('offer')}`);
    this.emit('offer', offer);
    logger.log('Offer emitted');
  }

  private generateWebSocketStreamingSDP(): string {
    // Generate SDP that indicates WebSocket-based streaming
    // This tells the client to expect video frames over WebSocket instead of WebRTC
    const sessionId = Date.now();
    const sdp =
      `v=0\r\n` +
      `o=- ${sessionId} 2 IN IP4 127.0.0.1\r\n` +
      `s=WebSocket Video Stream\r\n` +
      `t=0 0\r\n` +
      `a=x-websocket-stream:${this.streamUrl}\r\n` +
      `m=video 0 RTP/AVP 96\r\n` +
      `c=IN IP4 0.0.0.0\r\n` +
      `a=inactive\r\n` +
      `a=rtpmap:96 VP8/90000\r\n` +
      `a=x-stream-type:websocket\r\n`;

    return sdp;
  }

  async handleAnswer(answer: RTCSessionDescription): Promise<void> {
    logger.log('Received answer from client, starting WebSocket streaming');

    // Parse the answer to check if client accepts WebSocket streaming
    if (answer.sdp.includes('x-stream-type:websocket')) {
      this.isStreaming = true;
      this.emit('connected');
      logger.log('Client accepted WebSocket streaming mode');
    } else {
      logger.warn('Client did not accept WebSocket streaming mode');
    }
  }

  async handleIceCandidate(_candidate: RTCIceCandidate): Promise<void> {
    // For WebSocket streaming, we don't need ICE candidates
    logger.log('Received ICE candidate (ignored for WebSocket streaming)');
  }

  getStreamInfo(): { url: string; protocol: 'websocket' | 'http' } | null {
    if (!this.streamUrl) return null;

    return {
      url: this.streamUrl,
      protocol: 'websocket',
    };
  }

  isStreamingActive(): boolean {
    return this.isStreaming;
  }

  close(): void {
    this.isStreaming = false;
    if (this.frameInterval) {
      clearInterval(this.frameInterval);
      this.frameInterval = undefined;
    }
    this.streamBuffer = [];
    this.streamUrl = null;
    this.removeAllListeners();
    logger.log('WebRTC handler closed');
  }
}
