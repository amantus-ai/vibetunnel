import { createLogger } from '../utils/logger.js';
import type { ScreencapWebSocketClient } from './screencap-websocket-client.js';
import { getWebRTCConfig } from '../../shared/webrtc-config.js';

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

    // Send start-capture message to Mac app
    if (captureMode === 'desktop') {
      await this.wsClient.sendStartCapture('desktop', displayIndex ?? 0);
    } else if (captureMode === 'window' && windowId !== undefined) {
      await this.wsClient.sendStartCaptureWindow(windowId);
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
        rtcpMuxPolicy: webrtcConfig.rtcpMuxPolicy || 'require',
        iceCandidatePoolSize: webrtcConfig.iceCandidatePoolSize
      };
    }

    this.peerConnection = new RTCPeerConnection(configuration);

    // Set up event handlers
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        logger.log('Sending ICE candidate to Mac');
        this.wsClient.sendSignal({
          type: 'ice-candidate',
          data: event.candidate
        });
      }
    };

    this.peerConnection.ontrack = (event) => {
      logger.log('Received remote track:', event.track.kind);
      if (event.streams && event.streams[0]) {
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

    // Listen for signaling messages
    this.wsClient.onSignal = async (message) => {
      await this.handleSignalingMessage(message);
    };

    // Create and send offer
    await this.createAndSendOffer();
  }

  private async createAndSendOffer(): Promise<void> {
    if (!this.peerConnection) return;

    try {
      // Add transceiver for video
      this.peerConnection.addTransceiver('video', {
        direction: 'recvonly',
        streams: []
      });

      const offer = await this.peerConnection.createOffer({
        offerToReceiveVideo: true,
        offerToReceiveAudio: false
      });

      await this.peerConnection.setLocalDescription(offer);

      logger.log('Sending offer to Mac');
      this.wsClient.sendSignal({
        type: 'offer',
        data: offer
      });
    } catch (error) {
      logger.error('Failed to create offer:', error);
      this.onError?.(error as Error);
    }
  }

  private async handleSignalingMessage(message: any): Promise<void> {
    if (!this.peerConnection) return;

    switch (message.type) {
      case 'answer':
        logger.log('Received answer from Mac');
        try {
          await this.peerConnection.setRemoteDescription(
            new RTCSessionDescription(message.data)
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
          await this.peerConnection.addIceCandidate(
            new RTCIceCandidate(message.data)
          );
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
      let inboundVideoStats: RTCInboundRTPStreamStats | null = null;
      let remoteOutboundStats: RTCRemoteOutboundRTPStreamStats | null = null;
      let candidatePairStats: RTCIceCandidatePairStats | null = null;
      let codecStats: RTCCodecStats | null = null;

      stats.forEach(report => {
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          inboundVideoStats = report as RTCInboundRTPStreamStats;
        } else if (report.type === 'remote-outbound-rtp' && report.kind === 'video') {
          remoteOutboundStats = report as RTCRemoteOutboundRTPStreamStats;
        } else if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          candidatePairStats = report as RTCIceCandidatePairStats;
        } else if (report.type === 'codec' && report.mimeType?.includes('video')) {
          codecStats = report as RTCCodecStats;
        }
      });

      if (inboundVideoStats) {
        const videoTrack = this.remoteStream.getVideoTracks()[0];
        const settings = videoTrack?.getSettings();
        
        // Calculate bitrate
        const now = Date.now();
        const timeDiff = now - (this.lastStatsTime || now);
        const bytesDiff = (inboundVideoStats.bytesReceived || 0) - (this.lastBytesReceived || 0);
        const bitrate = timeDiff > 0 ? (bytesDiff * 8 * 1000) / timeDiff : 0;
        
        this.lastStatsTime = now;
        this.lastBytesReceived = inboundVideoStats.bytesReceived || 0;

        // Calculate latency
        const latency = candidatePairStats?.currentRoundTripTime 
          ? Math.round(candidatePairStats.currentRoundTripTime * 1000)
          : 0;

        // Get codec info
        const codecName = codecStats?.mimeType?.split('/')[1] || 'unknown';
        const codecImplementation = (inboundVideoStats as any).decoderImplementation || 'unknown';

        const streamStats: StreamStats = {
          codec: codecName.toUpperCase(),
          codecImplementation: codecImplementation,
          resolution: `${settings?.width || 0}×${settings?.height || 0}`,
          fps: Math.round(inboundVideoStats.framesPerSecond || 0),
          bitrate: Math.round(bitrate),
          latency: latency,
          packetsLost: inboundVideoStats.packetsLost || 0,
          packetLossRate: this.calculatePacketLossRate(inboundVideoStats),
          jitter: Math.round((inboundVideoStats.jitter || 0) * 1000),
          timestamp: now
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

  private calculatePacketLossRate(stats: RTCInboundRTPStreamStats): number {
    const packetsReceived = stats.packetsReceived || 0;
    const packetsLost = stats.packetsLost || 0;
    
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
      
      logger.log(`Adjusting bitrate: ${stats.bitrate} -> ${newBitrate} (${shouldReduceBitrate ? 'reduce' : 'increase'})`);
      
      // Send bitrate adjustment to Mac app
      this.wsClient.sendSignal({
        type: 'bitrate-adjustment',
        data: {
          targetBitrate: newBitrate,
          reason: shouldReduceBitrate ? 'quality-degradation' : 'quality-improvement'
        }
      });
    }
  }
}