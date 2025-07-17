import { EventEmitter } from 'node:events';
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
  private iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  constructor(
    private captureSession: CaptureSession,
    private sessionId: string
  ) {
    super();
    logger.log(`Created WebRTC handler for session ${sessionId}`);
  }

  async initialize(): Promise<void> {
    // For Linux, we'll generate a simplified SDP that points to our stream
    // The client will handle the WebRTC connection
    logger.log('Initializing Linux WebRTC handler in compatibility mode');

    // Get stream URL from capture session if available
    if (this.captureSession.captureStream) {
      // In a real implementation, this would be the URL to the video stream
      this.streamUrl = `/api/screencap/stream/${this.sessionId}`;
      logger.log(`Stream URL: ${this.streamUrl}`);
    }
  }

  async createOffer(): Promise<void> {
    // Create a simplified SDP offer for Linux
    // This is a minimal SDP that indicates we have a video stream
    const offer: RTCSessionDescription = {
      type: 'offer',
      sdp: this.generateSimplifiedSDP(),
    };

    logger.log('Created simplified offer for Linux');
    this.emit('offer', offer);
  }

  private generateSimplifiedSDP(): string {
    // Generate a minimal SDP that indicates video streaming capability
    // The actual streaming will happen through WebSocket or HTTP
    const sessionId = Date.now();
    const sdp =
      `v=0
` +
      `o=- ${sessionId} 2 IN IP4 127.0.0.1\r\n` +
      `s=-\r\n` +
      `t=0 0\r\n` +
      `a=group:BUNDLE 0\r\n` +
      `a=msid-semantic: WMS stream\r\n` +
      `m=video 9 UDP/TLS/RTP/SAVPF 96\r\n` +
      `c=IN IP4 0.0.0.0\r\n` +
      `a=rtcp:9 IN IP4 0.0.0.0\r\n` +
      `a=ice-ufrag:4cXi\r\n` +
      `a=ice-pwd:by5GZGG1lw+040DWA6hXM5Bz\r\n` +
      `a=ice-options:trickle\r\n` +
      `a=fingerprint:sha-256 1B:09:0D:FF:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00\r\n` +
      `a=setup:actpass\r\n` +
      `a=mid:0\r\n` +
      `a=sendonly\r\n` +
      `a=rtcp-mux\r\n` +
      `a=rtpmap:96 VP8/90000\r\n`;

    return sdp;
  }

  async handleAnswer(_answer: RTCSessionDescription): Promise<void> {
    // In our simplified implementation, we just log the answer
    // The actual streaming happens through WebSocket
    logger.log('Received answer from client, streaming can begin');

    // Emit event to indicate connection is established
    this.emit('connected');
  }

  async handleIceCandidate(_candidate: RTCIceCandidate): Promise<void> {
    // In our simplified implementation, we don't need to handle ICE candidates
    // as we're not establishing a real peer connection
    logger.log('Received ICE candidate (ignored in compatibility mode)');
  }

  getStreamInfo(): { url: string; protocol: 'websocket' | 'http' } | null {
    if (!this.streamUrl) return null;

    return {
      url: this.streamUrl,
      protocol: 'websocket',
    };
  }

  close(): void {
    this.streamUrl = null;
    this.removeAllListeners();
    logger.log('WebRTC handler closed');
  }
}
