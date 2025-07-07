import { getWebRTCConfig } from '../../shared/webrtc-config.js';
import { createLogger } from '../utils/logger.js';
import type { ScreencapWebSocketClient } from './screencap-websocket-client.js';

// Type definitions for WebRTC stats that TypeScript doesn't have
interface CodecStats extends RTCStats {
  payloadType?: number;
  mimeType?: string;
  clockRate?: number;
  channels?: number;
  sdpFmtpLine?: string;
}

interface ExtendedRTCInboundRtpStreamStats extends RTCInboundRtpStreamStats {
  bytesReceived?: number;
  framesPerSecond?: number;
  packetsLost?: number;
  jitter?: number;
  decoderImplementation?: string;
}

interface ExtendedRTCIceCandidatePairStats extends RTCIceCandidatePairStats {
  currentRoundTripTime?: number;
}

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
  private onStatusUpdate?: (
    type: 'info' | 'success' | 'warning' | 'error',
    message: string
  ) => void;
  private customConfig?: RTCConfiguration;
  private hasTriggeredVP8Upgrade = false;
  private vp8UpgradeTimeout?: number;

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
      onStatusUpdate?: (type: 'info' | 'success' | 'warning' | 'error', message: string) => void;
    }
  ): Promise<void> {
    logger.log('Starting WebRTC capture...');

    if (callbacks) {
      this.onStreamReady = callbacks.onStreamReady;
      this.onStatsUpdate = callbacks.onStatsUpdate;
      this.onError = callbacks.onError;
      this.onStatusUpdate = callbacks.onStatusUpdate;
    }

    // Generate session ID if not already present
    if (!this.wsClient.sessionId) {
      this.wsClient.sessionId = crypto.randomUUID();
      logger.log(`Generated session ID: ${this.wsClient.sessionId}`);
      this.onStatusUpdate?.(
        'info',
        `Created session: ${this.wsClient.sessionId.substring(0, 8)}...`
      );
    }

    // Send start-capture message to Mac app
    if (captureMode === 'desktop') {
      await this.wsClient.sendSignal('start-capture', {
        mode: 'desktop',
        displayIndex: displayIndex ?? 0,
        sessionId: this.wsClient.sessionId,
      });
    } else if (captureMode === 'window' && windowId !== undefined) {
      await this.wsClient.sendSignal('start-capture', {
        mode: 'window',
        windowId: windowId,
        sessionId: this.wsClient.sessionId,
      });
    }

    await this.setupWebRTCSignaling();
  }

  async stopCapture(): Promise<void> {
    // Commenting out log to reduce test noise
    // logger.log('Stopping WebRTC capture...');

    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    if (this.vp8UpgradeTimeout) {
      clearTimeout(this.vp8UpgradeTimeout);
      this.vp8UpgradeTimeout = undefined;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.remoteStream = null;
    this.hasTriggeredVP8Upgrade = false;
  }

  private async setupWebRTCSignaling(): Promise<void> {
    logger.log('Setting up WebRTC signaling...');
    this.onStatusUpdate?.('info', 'Setting up WebRTC connection...');

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

    this.onStatusUpdate?.('info', 'Creating peer connection...');
    this.peerConnection = new RTCPeerConnection(configuration);

    // Configure codec preferences for VP8 (preferred) and H.264 (fallback)
    this.peerConnection.addEventListener('track', () => {
      this.configureCodecPreferences();
    });

    // Set up event handlers
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        logger.log('Sending ICE candidate to Mac');
        this.onStatusUpdate?.('info', 'Exchanging network connectivity information...');
        // Wrap the ICE candidate in a data object to match what the Mac app expects
        this.wsClient.sendSignal('ice-candidate', {
          data: {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
          },
        });
      }
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection?.iceConnectionState;
      logger.log(`ICE connection state changed to: ${state}`);

      switch (state) {
        case 'checking':
          this.onStatusUpdate?.('info', 'Checking network connectivity...');
          break;
        case 'connected':
          this.onStatusUpdate?.('success', 'Network connection established');
          // Schedule VP8 upgrade after initial connection stabilizes
          if (!this.hasTriggeredVP8Upgrade && !this.vp8UpgradeTimeout) {
            logger.log('📅 Scheduling VP8 codec upgrade in 2 seconds...');
            this.vp8UpgradeTimeout = window.setTimeout(() => {
              this.triggerVP8UpgradeIfNeeded();
            }, 2000);
          }
          break;
        case 'completed':
          this.onStatusUpdate?.('success', 'Network connection optimized');
          break;
        case 'failed':
          this.onStatusUpdate?.('error', 'Network connection failed');
          logger.error(
            'ICE connection failed. This may be due to firewall restrictions or network configuration issues.'
          );
          break;
        case 'disconnected':
          this.onStatusUpdate?.('warning', 'Network connection lost');
          logger.warn('ICE connection disconnected. The connection may be temporarily lost.');
          break;
        case 'closed':
          this.onStatusUpdate?.('info', 'Network connection closed.');
          break;
      }
    };

    this.peerConnection.ontrack = (event) => {
      logger.log('Received remote track:', event.track.kind);
      logger.log('Event streams:', event.streams);
      logger.log('Event streams length:', event.streams?.length);
      this.onStatusUpdate?.('success', `Received ${event.track.kind} stream from Mac`);

      if (event.streams && event.streams.length > 0) {
        this.remoteStream = event.streams[0];
        logger.log('Setting remote stream from event.streams[0], calling onStreamReady');
        this.onStreamReady?.(this.remoteStream);
      } else {
        // Fallback for browsers that don't support event.streams
        const newStream = new MediaStream();
        newStream.addTrack(event.track);
        this.remoteStream = newStream;
        logger.log('Created new MediaStream with track, calling onStreamReady');
        this.onStreamReady?.(this.remoteStream);
      }

      // Start collecting statistics
      this.startStatsCollection();
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState;
      logger.log(`Connection state changed to: ${state}`);
      if (state === 'failed') {
        logger.error('WebRTC connection failed. Gathering more details...');
        this.peerConnection?.getStats().then((stats) => {
          logger.error(
            'WebRTC stats at time of failure:',
            JSON.stringify(Object.fromEntries(stats.entries()), null, 2)
          );
        });
        this.onError?.(new Error('WebRTC connection failed'));
      }
    };

    // Set up WebRTC signaling callbacks
    this.wsClient.onOffer = async (data) => {
      await this.handleOffer(data);
    };

    this.wsClient.onAnswer = async (data) => {
      await this.handleAnswer(data);
    };

    this.wsClient.onIceCandidate = async (data) => {
      await this.handleIceCandidate(data);
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

  private preferCodecsInSdp(sdp: string): string {
    const lines = sdp.split('\r\n');
    const modifiedLines: string[] = [];
    const h264PayloadTypes: string[] = [];
    const vp8PayloadTypes: string[] = [];
    const otherPayloadTypes: string[] = [];
    let inVideoSection = false;

    // First pass: find codec payload types
    for (const line of lines) {
      if (line.includes('rtpmap')) {
        const match = line.match(/a=rtpmap:(\d+) (\w+)\/\d+/);
        if (match) {
          const [, payloadType, codecName] = match;
          if (codecName.toUpperCase() === 'H264') {
            h264PayloadTypes.push(payloadType);
            logger.log(`Found H.264 codec with payload type: ${payloadType}`);
          } else if (codecName.toUpperCase() === 'VP8') {
            vp8PayloadTypes.push(payloadType);
            logger.log(`Found VP8 codec with payload type: ${payloadType}`);
          } else if (line.includes('video')) {
            otherPayloadTypes.push(payloadType);
          }
        }
      }
    }

    // Second pass: modify m=video line to reorder codecs and add bandwidth
    for (const line of lines) {
      let modifiedLine = line;

      // Track video section
      if (line.startsWith('m=audio')) {
        inVideoSection = false;
      } else if (line.startsWith('m=video')) {
        inVideoSection = true;
        const parts = line.split(' ');
        if (parts.length > 3) {
          const existingPayloadTypes = parts.slice(3);
          const reorderedPayloadTypes: string[] = [];

          // Add VP8 first for better quality
          for (const pt of vp8PayloadTypes) {
            if (existingPayloadTypes.includes(pt)) {
              reorderedPayloadTypes.push(pt);
            }
          }

          // Then H.264 as fallback
          for (const pt of h264PayloadTypes) {
            if (existingPayloadTypes.includes(pt) && !reorderedPayloadTypes.includes(pt)) {
              reorderedPayloadTypes.push(pt);
            }
          }

          // Then others
          for (const pt of existingPayloadTypes) {
            if (!reorderedPayloadTypes.includes(pt)) {
              reorderedPayloadTypes.push(pt);
            }
          }

          modifiedLine = `${parts.slice(0, 3).join(' ')} ${reorderedPayloadTypes.join(' ')}`;
          logger.log('Reordered video codecs: VP8 first (preferred), H.264 second (fallback)');
        }
      }

      modifiedLines.push(modifiedLine);

      // Add bandwidth constraint after video m-line to start with higher bitrate
      if (inVideoSection && line.startsWith('m=video')) {
        // Start with 5 Mbps instead of default 1 Mbps
        const initialBitrate = 5000; // 5000 kbps = 5 Mbps
        modifiedLines.push(`b=AS:${initialBitrate}`);
        logger.log(`📈 Added initial bandwidth constraint: ${initialBitrate / 1000} Mbps`);
      }
    }

    logger.log(
      `SDP Codec Analysis - VP8: ${vp8PayloadTypes.length} (preferred), H.264: ${h264PayloadTypes.length}`
    );
    return modifiedLines.join('\r\n');
  }

  private configureCodecPreferences(): void {
    if (!this.peerConnection) return;

    const transceivers = this.peerConnection.getTransceivers();
    for (const transceiver of transceivers) {
      if (transceiver.receiver.track?.kind === 'video' && 'setCodecPreferences' in transceiver) {
        // Get available codecs
        const codecs = RTCRtpReceiver.getCapabilities?.('video')?.codecs || [];

        // Sort codecs: VP8 first for better quality, then H.264, then others
        const vp8Codecs = codecs.filter((codec) => codec.mimeType.toLowerCase().includes('vp8'));
        const h264Codecs = codecs.filter((codec) => codec.mimeType.toLowerCase().includes('h264'));
        const otherCodecs = codecs.filter(
          (codec) =>
            !codec.mimeType.toLowerCase().includes('h264') &&
            !codec.mimeType.toLowerCase().includes('vp8')
        );

        const orderedCodecs = [...vp8Codecs, ...h264Codecs, ...otherCodecs];

        if (orderedCodecs.length > 0) {
          // TypeScript doesn't have setCodecPreferences in its types yet
          const transceiverWithCodecPref = transceiver as RTCRtpTransceiver & {
            setCodecPreferences(codecs: RTCRtpCodec[]): void;
          };
          transceiverWithCodecPref.setCodecPreferences(orderedCodecs);
          logger.log(
            `Configured codec preferences - VP8: ${vp8Codecs.length} (preferred), H.264: ${h264Codecs.length}`
          );
        }
      }
    }
  }

  private async handleOffer(offer: RTCSessionDescriptionInit) {
    if (!this.peerConnection) return;

    logger.log('Received offer from Mac');
    logger.log('Original offer SDP:', offer.sdp);
    this.onStatusUpdate?.('info', 'Received connection offer from Mac app');
    try {
      // Modify offer SDP to prefer VP8 for better quality
      const modifiedSdp = this.preferCodecsInSdp(offer.sdp || '');
      logger.log('Modified offer SDP:', modifiedSdp);
      const modifiedOffer = new RTCSessionDescription({
        type: offer.type,
        sdp: modifiedSdp,
      });

      await this.peerConnection.setRemoteDescription(modifiedOffer);
      logger.log('Remote description set successfully');

      // Create and send answer
      this.onStatusUpdate?.('info', 'Negotiating connection parameters...');
      const answer = await this.peerConnection.createAnswer();

      // Modify answer SDP to prefer VP8 for better quality
      const modifiedAnswerSdp = this.preferCodecsInSdp(answer.sdp || '');
      const modifiedAnswer = new RTCSessionDescription({
        type: answer.type,
        sdp: modifiedAnswerSdp,
      });

      await this.peerConnection.setLocalDescription(modifiedAnswer);

      logger.log('Sending answer to Mac');
      this.onStatusUpdate?.('info', 'Sending connection response...');
      // Wrap the answer in a data object to match what the Mac app expects
      this.wsClient.sendSignal('answer', {
        data: {
          type: modifiedAnswer.type,
          sdp: modifiedAnswer.sdp,
        },
      });

      // Configure bitrate after connection is established
      await this.configureBitrateParameters();
    } catch (error) {
      logger.error('Failed to handle offer:', error);
      this.onStatusUpdate?.('error', `Failed to establish connection: ${error}`);
      this.onError?.(error as Error);
    }
  }

  private async handleAnswer(answer: RTCSessionDescriptionInit) {
    if (!this.peerConnection) return;

    logger.log('Received answer from Mac');
    try {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      logger.log('Remote description set successfully');

      // Configure bitrate after connection is established
      await this.configureBitrateParameters();
    } catch (error) {
      logger.error('Failed to set remote description:', error);
      this.onError?.(error as Error);
    }
  }

  private async handleIceCandidate(candidate: RTCIceCandidateInit) {
    if (!this.peerConnection) return;

    logger.log('Received ICE candidate from Mac');
    try {
      if (candidate) {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (error) {
      logger.error('Failed to add ICE candidate:', error);
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
      let codecStats: CodecStats | null = null;

      stats.forEach((report) => {
        if (
          report.type === 'inbound-rtp' &&
          'kind' in report &&
          (report as RTCInboundRtpStreamStats).kind === 'video'
        ) {
          inboundVideoStats = report as RTCInboundRtpStreamStats;
        } else if (
          report.type === 'remote-outbound-rtp' &&
          'kind' in report &&
          (report as RTCOutboundRtpStreamStats).kind === 'video'
        ) {
          _remoteOutboundStats = report as RTCOutboundRtpStreamStats;
        } else if (
          report.type === 'candidate-pair' &&
          'state' in report &&
          (report as RTCIceCandidatePairStats).state === 'succeeded'
        ) {
          candidatePairStats = report as RTCIceCandidatePairStats;
        } else if (report.type === 'codec' && 'mimeType' in report) {
          const codec = report as CodecStats;
          if (codec.mimeType?.includes('video')) {
            codecStats = codec;
          }
        }
      });

      if (inboundVideoStats) {
        const videoTrack = this.remoteStream.getVideoTracks()[0];
        const settings = videoTrack?.getSettings();

        // Calculate bitrate
        const now = Date.now();
        const timeDiff = now - (this.lastStatsTime || now);
        const extendedStats = inboundVideoStats as ExtendedRTCInboundRtpStreamStats;
        const bytesReceived = extendedStats.bytesReceived || 0;
        const bytesDiff = bytesReceived - (this.lastBytesReceived || 0);
        const bitrate = timeDiff > 0 ? (bytesDiff * 8 * 1000) / timeDiff : 0;

        this.lastStatsTime = now;
        this.lastBytesReceived = bytesReceived;

        // Calculate latency
        const extendedPairStats = candidatePairStats
          ? (candidatePairStats as ExtendedRTCIceCandidatePairStats)
          : null;
        const latency = extendedPairStats?.currentRoundTripTime
          ? Math.round(extendedPairStats.currentRoundTripTime * 1000)
          : 0;

        // Get codec info
        const codecName = codecStats
          ? (codecStats as CodecStats).mimeType?.split('/')[1] || 'unknown'
          : 'unknown';

        // Check for hardware acceleration hint
        let codecImplementation = extendedStats.decoderImplementation || 'Software';
        if ((codecStats as CodecStats | null)?.id?.toLowerCase().includes('videotoolbox')) {
          codecImplementation = 'Hardware (VideoToolbox)';
        }

        const streamStats: StreamStats = {
          codec: codecName.toUpperCase(),
          codecImplementation: codecImplementation,
          resolution: `${settings?.width || 0}×${settings?.height || 0}`,
          fps: Math.round(extendedStats.framesPerSecond || 0),
          bitrate: Math.round(bitrate),
          latency: latency,
          packetsLost: extendedStats.packetsLost || 0,
          packetLossRate: this.calculatePacketLossRate(inboundVideoStats),
          jitter: Math.round((extendedStats.jitter || 0) * 1000),
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

  /**
   * Check current codec and trigger VP8 upgrade if needed
   */
  private async triggerVP8UpgradeIfNeeded(): Promise<void> {
    if (this.hasTriggeredVP8Upgrade) return;

    try {
      const stats = await this.peerConnection?.getStats();
      if (!stats) return;

      let currentCodec = 'unknown';

      // Find the current codec being used
      stats.forEach((report) => {
        if (report.type === 'inbound-rtp' && 'codecId' in report) {
          const codecReport = stats.get(report.codecId as string);
          if (codecReport && 'mimeType' in codecReport) {
            const mimeType = (codecReport as CodecStats).mimeType;
            if (mimeType?.includes('video')) {
              currentCodec = mimeType.split('/')[1]?.toUpperCase() || 'unknown';
            }
          }
        }
      });

      logger.log(`🎥 Current codec: ${currentCodec}`);

      // If not using VP8, force renegotiation
      if (currentCodec !== 'VP8' && currentCodec !== 'unknown') {
        logger.log('📈 Upgrading to VP8 codec for better quality...');
        this.hasTriggeredVP8Upgrade = true;
        await this.forceVP8Renegotiation();
      } else if (currentCodec === 'VP8') {
        logger.log('✅ Already using VP8 codec');
        this.hasTriggeredVP8Upgrade = true;
      }
    } catch (error) {
      logger.error('Failed to check codec status:', error);
    }
  }

  /**
   * Force renegotiation to immediately switch to VP8 codec
   * This can be called after initial connection to speed up codec upgrade
   */
  async forceVP8Renegotiation(): Promise<void> {
    if (!this.peerConnection || this.peerConnection.connectionState !== 'connected') {
      logger.warn('Cannot force renegotiation - peer connection not ready');
      return;
    }

    logger.log('🔄 Forcing VP8 codec renegotiation...');
    this.onStatusUpdate?.('info', 'Optimizing video quality with VP8 codec...');

    try {
      // Reconfigure codec preferences to strongly prefer VP8
      this.configureCodecPreferences();

      // Create a new offer to trigger renegotiation
      const offer = await this.peerConnection.createOffer();

      // Modify SDP to ensure VP8 is strongly preferred
      const modifiedSdp = this.preferCodecsInSdp(offer.sdp || '');
      const modifiedOffer = new RTCSessionDescription({
        type: offer.type,
        sdp: modifiedSdp,
      });

      await this.peerConnection.setLocalDescription(modifiedOffer);

      // Send the renegotiation offer to the Mac app
      logger.log('📤 Sending renegotiation offer to Mac');
      this.wsClient.sendSignal('renegotiate', {
        data: {
          type: modifiedOffer.type,
          sdp: modifiedOffer.sdp,
        },
      });

      this.onStatusUpdate?.('success', 'VP8 codec negotiation initiated');
    } catch (error) {
      logger.error('Failed to force VP8 renegotiation:', error);
      this.onStatusUpdate?.('error', 'Failed to optimize codec');
    }
  }

  private calculatePacketLossRate(stats: RTCInboundRtpStreamStats): number {
    const extStats = stats as ExtendedRTCInboundRtpStreamStats;
    const packetsReceived = extStats.packetsReceived || 0;
    const packetsLost = extStats.packetsLost || 0;

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
    // Skip adjustment if we don't have meaningful bitrate data yet
    if (stats.bitrate === 0) {
      return;
    }

    // Determine if we need to adjust bitrate
    const shouldReduceBitrate = stats.packetLossRate > 2 || stats.latency > 200;
    const shouldIncreaseBitrate = stats.packetLossRate < 0.5 && stats.latency < 50;

    if (shouldReduceBitrate || shouldIncreaseBitrate) {
      const adjustment = shouldReduceBitrate ? 0.8 : 1.2; // 20% adjustment
      const newBitrate = Math.round(stats.bitrate * adjustment);

      // Ensure we have a reasonable bitrate range (5 Mbps to 50 Mbps)
      // Increased minimum from 1 Mbps to 5 Mbps for better quality
      const clampedBitrate = Math.max(5_000_000, Math.min(50_000_000, newBitrate));

      logger.log(
        `Adjusting bitrate: ${stats.bitrate} -> ${clampedBitrate} (${shouldReduceBitrate ? 'reduce' : 'increase'})`
      );

      // Send bitrate adjustment to Mac app
      this.wsClient.sendSignal('bitrate-adjustment', {
        data: {
          targetBitrate: clampedBitrate,
          reason: shouldReduceBitrate ? 'quality-degradation' : 'quality-improvement',
        },
      });
    }
  }
}
