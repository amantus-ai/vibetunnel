import { EventEmitter } from 'node:events';
import { type Readable, Transform } from 'node:stream';
import { createLogger } from '../utils/logger.js';
import type { CaptureStream } from './capture-providers/ffmpeg-capture.js';

const logger = createLogger('stream-converter');

export interface WebRTCMediaStream extends EventEmitter {
  id: string;
  active: boolean;
  tracks: MediaStreamTrack[];

  addTrack(track: MediaStreamTrack): void;
  removeTrack(track: MediaStreamTrack): void;
  getTracks(): MediaStreamTrack[];
  getVideoTracks(): MediaStreamTrack[];
  stop(): void;
}

export interface MediaStreamTrack extends EventEmitter {
  id: string;
  kind: 'video' | 'audio';
  label: string;
  enabled: boolean;
  muted: boolean;
  readyState: 'live' | 'ended';

  stop(): void;
}

export interface ServerMediaStream {
  stream: WebRTCMediaStream;
  stop(): void;
}

/**
 * Converts FFmpeg output stream to a format suitable for WebRTC
 * This creates a virtual MediaStream that can be added to RTCPeerConnection
 */
export class StreamConverter {
  /**
   * Convert FFmpeg capture stream to WebRTC-compatible format
   */
  static async convertToWebRTC(captureStream: CaptureStream): Promise<ServerMediaStream> {
    logger.log('Converting capture stream to WebRTC format');

    // Create virtual MediaStream
    const mediaStream = new ServerMediaStreamImpl();

    // Create video track from FFmpeg stream
    const videoTrack = new ServerVideoTrack(captureStream.stream);
    mediaStream.addTrack(videoTrack);

    // Handle capture stream events
    // Since CaptureStream doesn't extend EventEmitter anymore,
    // we'll need to handle cleanup differently
    // TODO: Consider adding event handling back to CaptureStream interface

    return {
      stream: mediaStream,
      stop: () => {
        captureStream.stop();
        mediaStream.stop();
      },
    };
  }

  /**
   * Create a transform stream that can process video data
   * This can be used to add overlays, timestamps, etc.
   */
  static createProcessingPipeline(): Transform {
    return new Transform({
      transform(chunk, encoding, callback) {
        // Pass through for now - could add processing here
        callback(null, chunk);
      },
    });
  }
}

/**
 * Server-side implementation of MediaStream API
 */
class ServerMediaStreamImpl extends EventEmitter implements WebRTCMediaStream {
  id: string;
  active: boolean = true;
  tracks: MediaStreamTrack[] = [];

  constructor() {
    super();
    this.id = generateStreamId();
  }

  addTrack(track: MediaStreamTrack): void {
    if (!this.tracks.includes(track)) {
      this.tracks.push(track);
      this.emit('addtrack', { track });

      // Listen for track end
      track.once('ended', () => {
        this.removeTrack(track);
      });
    }
  }

  removeTrack(track: MediaStreamTrack): void {
    const index = this.tracks.indexOf(track);
    if (index !== -1) {
      this.tracks.splice(index, 1);
      this.emit('removetrack', { track });

      if (this.tracks.length === 0) {
        this.active = false;
        this.emit('inactive');
      }
    }
  }

  getTracks(): MediaStreamTrack[] {
    return [...this.tracks];
  }

  getVideoTracks(): MediaStreamTrack[] {
    return this.tracks.filter((t) => t.kind === 'video');
  }

  stop(): void {
    logger.log('Stopping media stream');
    this.tracks.forEach((track) => track.stop());
    this.tracks = [];
    this.active = false;
    this.emit('inactive');
  }
}

/**
 * Server-side implementation of MediaStreamTrack for video
 */
class ServerVideoTrack extends EventEmitter implements MediaStreamTrack {
  id: string;
  kind: 'video' = 'video';
  label: string = 'Desktop Capture';
  enabled: boolean = true;
  muted: boolean = false;
  readyState: 'live' | 'ended' = 'live';

  private sourceStream: Readable;
  private chunks: Buffer[] = [];
  private chunkHandlers: Set<(chunk: Buffer) => void> = new Set();

  constructor(sourceStream: Readable) {
    super();
    this.id = generateTrackId();
    this.sourceStream = sourceStream;

    // Handle incoming data
    this.sourceStream.on('data', (chunk) => {
      if (this.readyState === 'live' && this.enabled) {
        this.chunks.push(chunk);

        // Emit to handlers (for WebRTC transmission)
        this.chunkHandlers.forEach((handler) => handler(chunk));

        // Keep buffer size reasonable (last 10MB)
        while (this.chunks.length > 100) {
          this.chunks.shift();
        }
      }
    });

    this.sourceStream.on('end', () => {
      this.stop();
    });

    this.sourceStream.on('error', (error) => {
      logger.error('Source stream error:', error);
      this.emit('error', error);
      this.stop();
    });
  }

  stop(): void {
    if (this.readyState === 'ended') return;

    logger.log('Stopping video track');
    this.readyState = 'ended';
    this.emit('ended');

    // Clean up
    this.chunks = [];
    this.chunkHandlers.clear();
  }

  /**
   * Internal method to get video data chunks
   * Used by the RTC integration
   */
  onChunk(handler: (chunk: Buffer) => void): () => void {
    this.chunkHandlers.add(handler);

    // Return unsubscribe function
    return () => {
      this.chunkHandlers.delete(handler);
    };
  }

  /**
   * Get recent video data (for late joiners)
   */
  getRecentChunks(): Buffer[] {
    return [...this.chunks];
  }
}

/**
 * Utility functions
 */
function generateStreamId(): string {
  return `stream-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function generateTrackId(): string {
  return `track-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Parse WebM/Matroska container to extract frames
 * This would be used for more advanced processing
 */
export class WebMParser extends Transform {
  private buffer = Buffer.alloc(0);

  _transform(chunk: Buffer, encoding: string, callback: () => void): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    // Simple passthrough for now
    // Real implementation would parse WebM structure
    this.push(chunk);

    callback();
  }
}
