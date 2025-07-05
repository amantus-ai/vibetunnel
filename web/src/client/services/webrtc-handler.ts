import { getWebRTCConfig } from '../../shared/webrtc-config.js';
import { createLogger } from '../utils/logger.js';
import type { ScreencapWebSocketClient } from './screencap-websocket-client.js';

const logger = createLogger('webrtc-handler');

export interface StreamStats {
  codec: string;
  codecImplementation: string;
  resolution: string;
  fps: number;
  bitrate: number;
  latency: number;
  packetsLost: number;
  packetLossRate: number;
  jitter: number;
  timestamp: number;
}

export class WebRTCHandler {
  private peerConnection: RTCPeerConnection | null = null;
  private remoteStream: MediaStream | null = null;
  private statsInterval: number | null = null;
  private wsClient: ScreencapWebSocketClient;
  private onStreamReady?: (stream: MediaStream) => void;
  private onStatsUpdate?: (stats: StreamStats) => void;
  private onError?: (error: Error) => void;
  private customConfig?: RTCConfiguration;

  constructor(wsClient: ScreencapWebSocketClient) {
    this.wsClient = wsClient;
  }

  /**
   * Set custom WebRTC configuration
   */
  setConfiguration(config: RTCConfiguration): void {
    this.customConfig = config;
  }

  async startCapture(
    captureMode: 'desktop' | 'window',
    displayIndex?: number,
    windowId?: number,
    callbacks?: {
      onStreamReady?: (stream: MediaStream) => void;
      onStatsUpdate?: (stats: StreamStats) => void;
      onError?: (error: Error) => void;
    }
  ): Promise<void> {
    logger.log('Starting WebRTC capture...');

    if (callbacks) {
      this.onStreamReady = callbacks.onStreamReady;
      this.onStatsUpdate = callbacks.onStatsUpdate;
      this.onError = callbacks.onError;
    }

    // Generate session ID if not already present
    if (!this.wsClient.sessionId) {
      this.wsClient.sessionId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      logger.log(`Generated session ID: ${this.wsClient.sessionId}`);
    }

    // Send start-capture message to Mac app
    if (captureMode === 'desktop') {
      await this.wsClient.sendSignal({
        type: 'start-capture',
        mode: 'desktop',
        displayIndex: displayIndex ?? 0,
        sessionId: this.wsClient.sessionId,
      });
    } else if (captureMode === 'window' && windowId !== undefined) {
      await this.wsClient.sendSignal({
        type: 'start-capture',
        mode: 'window',
        windowId: windowId,
        sessionId: this.wsClient.sessionId,
      });
    }

    await this.setupWebRTCSignaling();
  }

  async stopCapture(): Promise<void> {
    logger.log('Stopping WebRTC capture...');

    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.remoteStream = null;
  }

  private async setupWebRTCSignaling(): Promise<void> {
    logger.log('Setting up WebRTC signaling...');

    let configuration: RTCConfiguration;

    if (this.customConfig) {
      // Use custom configuration if provided
      configuration = this.customConfig;
      logger.log('Using custom WebRTC configuration');
    } else {
      // Get WebRTC configuration
      const webrtcConfig = getWebRTCConfig();
      logger.log('Using default WebRTC configuration:', webrtcConfig);

      // Configure STUN/TURN servers
      configuration = {
        iceServers: webrtcConfig.iceServers,
        iceTransportPolicy: webrtcConfig.iceTransportPolicy,
        bundlePolicy: webrtcConfig.bundlePolicy || 'max-bundle',
        rtcpMuxPolicy: webrtcConfig.rtcpMuxPolicy === 'negotiate' ? undefined : 'require',
        iceCandidatePoolSize: webrtcConfig.iceCandidatePoolSize,
      };
    }

    this.peerConnection = new RTCPeerConnection(configuration);

    // Set up event handlers
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        logger.log('Sending ICE candidate to Mac');
        this.wsClient.sendSignal({
          type: 'ice-candidate',
          data: event.candidate,
        });
      }
    };

    this.peerConnection.ontrack = (event) => {
      logger.log('Received remote track:', event.track.kind);
      if (event.streams?.[0]) {
        this.remoteStream = event.streams[0];
        this.onStreamReady?.(this.remoteStream);

        // Start collecting statistics
        this.startStatsCollection();
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      logger.log('Connection state:', this.peerConnection?.connectionState);
      if (this.peerConnection?.connectionState === 'failed') {
        this.onError?.(new Error('WebRTC connection failed'));
      }
    };

    // Set up WebRTC signaling callbacks
    this.wsClient.onOffer = async (data) => {
      await this.handleSignalingMessage({ type: 'offer', data });
    };

    this.wsClient.onAnswer = async (data) => {
      await this.handleSignalingMessage({ type: 'answer', data });
    };

    this.wsClient.onIceCandidate = async (data) => {
      await this.handleSignalingMessage({ type: 'ice-candidate', data });
    };

    this.wsClient.onError = (error) => {
      logger.error('WebRTC signaling error:', error);
      this.onError?.(new Error(error));
    };

    // Don't create offer - wait for Mac app to send offer after start-capture
    // The Mac app will create the offer when it receives the start-capture signal
    logger.log('Waiting for offer from Mac app...');
  }

  // Removed createAndSendOffer - Mac app creates the offer now

  private async handleSignalingMessage(message: { type: string; data?: unknown }): Promise<void> {
    if (!this.peerConnection) return;

    switch (message.type) {
      case 'offer':
        logger.log('Received offer from Mac');
        try {
          await this.peerConnection.setRemoteDescription(
            new RTCSessionDescription(message.data as RTCSessionDescriptionInit)
          );
          logger.log('Remote description set successfully');

          // Create and send answer
          const answer = await this.peerConnection.createAnswer();
          await this.peerConnection.setLocalDescription(answer);

          logger.log('Sending answer to Mac');
          this.wsClient.sendSignal({
            type: 'answer',
            data: answer,
          });

          // Configure bitrate after connection is established
          await this.configureBitrateParameters();
        } catch (error) {
          logger.error('Failed to handle offer:', error);
          this.onError?.(error as Error);
        }
        break;

      case 'answer':
        logger.log('Received answer from Mac');
        try {
          await this.peerConnection.setRemoteDescription(
            new RTCSessionDescription(message.data as RTCSessionDescriptionInit)
          );
          logger.log('Remote description set successfully');

          // Configure bitrate after connection is established
          await this.configureBitrateParameters();
        } catch (error) {
          logger.error('Failed to set remote description:', error);
          this.onError?.(error as Error);
        }
        break;

      case 'ice-candidate':
        logger.log('Received ICE candidate from Mac');
        try {
          if (message.data) {
            await this.peerConnection.addIceCandidate(
              new RTCIceCandidate(message.data as RTCIceCandidateInit)
            );
          }
        } catch (error) {
          logger.error('Failed to add ICE candidate:', error);
        }
        break;
    }
  }

  private async configureBitrateParameters(): Promise<void> {
    if (!this.peerConnection) return;

    const transceivers = this.peerConnection.getTransceivers();
    for (const transceiver of transceivers) {
      if (transceiver.receiver.track?.kind === 'video') {
        const params = transceiver.receiver.getParameters();

        // Log current parameters
        logger.log('Current receiver parameters:', JSON.stringify(params, null, 2));

        // Note: Receiver parameters are typically read-only
        // Bitrate control is usually done on the sender side
      }
    }
  }

  private startStatsCollection(): void {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }

    this.statsInterval = window.setInterval(() => {
      this.collectStats();
    }, 1000); // Collect stats every second
  }

  private async collectStats(): Promise<void> {
    if (!this.peerConnection || !this.remoteStream) return;

    try {
      const stats = await this.peerConnection.getStats();
      let inboundVideoStats: RTCInboundRtpStreamStats | null = null;
      let _remoteOutboundStats: RTCOutboundRtpStreamStats | null = null;
      let candidatePairStats: RTCIceCandidatePairStats | null = null;
      let codecStats: any | null = null;

      stats.forEach((report) => {
        if (report.type === 'inbound-rtp' && (report as any).kind === 'video') {
          inboundVideoStats = report as RTCInboundRtpStreamStats;
        } else if (report.type === 'remote-outbound-rtp' && (report as any).kind === 'video') {
          _remoteOutboundStats = report as RTCOutboundRtpStreamStats;
        } else if (report.type === 'candidate-pair' && (report as any).state === 'succeeded') {
          candidatePairStats = report as RTCIceCandidatePairStats;
        } else if (report.type === 'codec' && (report as any).mimeType?.includes('video')) {
          codecStats = report;
        }
      });

      if (inboundVideoStats) {
        const videoTrack = this.remoteStream.getVideoTracks()[0];
        const settings = videoTrack?.getSettings();

        // Calculate bitrate
        const now = Date.now();
        const timeDiff = now - (this.lastStatsTime || now);
        const bytesReceived = (inboundVideoStats as any).bytesReceived || 0;
        const bytesDiff = bytesReceived - (this.lastBytesReceived || 0);
        const bitrate = timeDiff > 0 ? (bytesDiff * 8 * 1000) / timeDiff : 0;

        this.lastStatsTime = now;
        this.lastBytesReceived = bytesReceived;

        // Calculate latency
        const latency = (candidatePairStats as any)?.currentRoundTripTime
          ? Math.round((candidatePairStats as any).currentRoundTripTime * 1000)
          : 0;

        // Get codec info
        const codecName = codecStats?.mimeType?.split('/')[1] || 'unknown';
        const codecImplementation = (inboundVideoStats as any).decoderImplementation || 'unknown';

        const streamStats: StreamStats = {
          codec: codecName.toUpperCase(),
          codecImplementation: codecImplementation,
          resolution: `${settings?.width || 0}×${settings?.height || 0}`,
          fps: Math.round((inboundVideoStats as any).framesPerSecond || 0),
          bitrate: Math.round(bitrate),
          latency: latency,
          packetsLost: (inboundVideoStats as any).packetsLost || 0,
          packetLossRate: this.calculatePacketLossRate(inboundVideoStats),
          jitter: Math.round(((inboundVideoStats as any).jitter || 0) * 1000),
          timestamp: now,
        };

        this.onStatsUpdate?.(streamStats);

        // Adjust bitrate based on quality
        await this.adjustBitrateBasedOnQuality(streamStats);
      }
    } catch (error) {
      logger.error('Failed to collect stats:', error);
    }
  }

  private lastStatsTime?: number;
  private lastBytesReceived?: number;
  private lastPacketsReceived?: number;
  private lastPacketsLost?: number;

  private calculatePacketLossRate(stats: RTCInboundRtpStreamStats): number {
    const packetsReceived = (stats as any).packetsReceived || 0;
    const packetsLost = (stats as any).packetsLost || 0;

    if (this.lastPacketsReceived !== undefined && this.lastPacketsLost !== undefined) {
      const receivedDiff = packetsReceived - this.lastPacketsReceived;
      const lostDiff = packetsLost - this.lastPacketsLost;
      const totalPackets = receivedDiff + lostDiff;

      this.lastPacketsReceived = packetsReceived;
      this.lastPacketsLost = packetsLost;

      if (totalPackets > 0) {
        return (lostDiff / totalPackets) * 100;
      }
    } else {
      this.lastPacketsReceived = packetsReceived;
      this.lastPacketsLost = packetsLost;
    }

    return 0;
  }

  private async adjustBitrateBasedOnQuality(stats: StreamStats): Promise<void> {
    // Determine if we need to adjust bitrate
    const shouldReduceBitrate = stats.packetLossRate > 2 || stats.latency > 200;
    const shouldIncreaseBitrate = stats.packetLossRate < 0.5 && stats.latency < 50;

    if (shouldReduceBitrate || shouldIncreaseBitrate) {
      const adjustment = shouldReduceBitrate ? 0.8 : 1.2; // 20% adjustment
      const newBitrate = Math.round(stats.bitrate * adjustment);

      logger.log(
        `Adjusting bitrate: ${stats.bitrate} -> ${newBitrate} (${shouldReduceBitrate ? 'reduce' : 'increase'})`
      );

      // Send bitrate adjustment to Mac app
      this.wsClient.sendSignal({
        type: 'bitrate-adjustment',
        data: {
          targetBitrate: newBitrate,
          reason: shouldReduceBitrate ? 'quality-degradation' : 'quality-improvement',
        },
      });
    }
  }
}
