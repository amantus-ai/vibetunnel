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
  private streamBuffer: Buffer[] = [];
  private ffmpegStream: Readable | null = null;

  constructor(
    private captureSession: CaptureSession,
    private sessionId: string
  ) {
    super();
    logger.log(`Created WebRTC handler for session ${sessionId}`);
  }

  async initialize(): Promise<void> {
    logger.log('Initializing Linux WebRTC handler for WebSocket streaming');

    // Get the FFmpeg stream from capture session
    if (this.captureSession.captureStream) {
      this.ffmpegStream = this.captureSession.captureStream.stream;
      this.streamUrl = `/api/screencap/stream/${this.sessionId}`;
      logger.log(`Stream URL: ${this.streamUrl}`);

      // Set up stream buffering
      this.setupStreamBuffering();
    } else {
      logger.error('No capture stream available from session');
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
      if (frameCount % 100 === 1) {
        logger.log(`FFmpeg data: frame ${frameCount}, chunk size: ${chunk.length}, total: ${totalBytes} bytes`);
      }
      // For WebSocket streaming, we'll emit video frames directly
      this.emit('video-frame', chunk);
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
    this.emit('offer', offer);
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
