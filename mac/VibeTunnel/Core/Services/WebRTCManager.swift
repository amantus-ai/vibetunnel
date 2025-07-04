import Combine
import CoreMedia
import Foundation
import OSLog
import VideoToolbox

@preconcurrency import WebRTC

/// Manages WebRTC connections for screen sharing
@MainActor
final class WebRTCManager: NSObject {
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "WebRTCManager")

    // MARK: - Properties

    private var peerConnectionFactory: RTCPeerConnectionFactory?
    private var peerConnection: RTCPeerConnection?
    private var localVideoTrack: RTCVideoTrack?
    private var videoSource: RTCVideoSource?
    private var videoCapturer: RTCVideoCapturer?

    // WebSocket for signaling
    private var signalSocket: URLSessionWebSocketTask?
    private var signalSession: URLSession?

    /// Signaling server URL
    private let signalURL: URL

    // MARK: - Published Properties

    @Published private(set) var connectionState: RTCPeerConnectionState = .new
    @Published private(set) var isConnected = false

    // MARK: - Initialization

    init(serverURL: URL) {
        // Convert HTTP URL to WebSocket URL
        var components = URLComponents(url: serverURL, resolvingAgainstBaseURL: false)!
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        components.path = "/ws/screencap-signal"
        self.signalURL = components.url!

        super.init()

        // Initialize WebRTC
        RTCInitializeSSL()

        // Create peer connection factory with custom codec preferences
        let videoEncoderFactory = createVideoEncoderFactory()
        let videoDecoderFactory = RTCDefaultVideoDecoderFactory()

        peerConnectionFactory = RTCPeerConnectionFactory(
            encoderFactory: videoEncoderFactory,
            decoderFactory: videoDecoderFactory
        )

        logger.info("✅ WebRTC Manager initialized with signal URL: \(self.signalURL)")
    }

    deinit {
        RTCCleanupSSL()
    }

    // MARK: - Public Methods

    /// Start WebRTC capture for the given mode
    func startCapture(mode: String) async throws {
        logger.info("🚀 Starting WebRTC capture")

        // Create video track first
        createLocalVideoTrack()

        // Create peer connection (will add the video track)
        try createPeerConnection()

        // Connect to signaling server
        try await connectSignaling()

        // Notify server we're ready as the Mac peer
        await sendSignalMessage([
            "type": "mac-ready",
            "mode": mode
        ])
    }

    /// Stop WebRTC capture
    func stopCapture() async {
        logger.info("🛑 Stopping WebRTC capture")
        await disconnect()
    }

    /// Process a video frame from ScreenCaptureKit using sending parameter
    nonisolated func processVideoFrame(_ sampleBuffer: sending CMSampleBuffer) async {
        // Check if we're connected before processing
        let connected = await MainActor.run { self.isConnected }
        guard connected else {
            // Only log occasionally to avoid spam
            if Int.random(in: 0..<30) == 0 {
                await MainActor.run { [weak self] in
                    self?.logger.debug("Skipping frame - WebRTC not connected yet")
                }
            }
            return
        }
        
        // Log that we're processing frames
        if Int.random(in: 0..<60) == 0 {
            await MainActor.run { [weak self] in
                self?.logger.info("🎬 Processing video frame - WebRTC is connected")
            }
        }

        // Try to get pixel buffer first (for raw frames)
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            // This might be encoded data - for now just log it
            await MainActor.run { [weak self] in
                guard let self else { return }
                // Only log occasionally to avoid spam
                if Int.random(in: 0..<30) == 0 {
                    let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer)
                    let mediaType = formatDesc.flatMap { CMFormatDescriptionGetMediaType($0) }
                    let mediaSubType = formatDesc.flatMap { CMFormatDescriptionGetMediaSubType($0) }
                    self.logger
                        .debug(
                            "No pixel buffer - mediaType: \(mediaType.map { String(format: "0x%08X", $0) } ?? "nil"), subType: \(mediaSubType.map { String(format: "0x%08X", $0) } ?? "nil")"
                        )
                }
            }
            return
        }

        // Extract timestamp
        let timestamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let timeStampNs = Int64(CMTimeGetSeconds(timestamp) * Double(NSEC_PER_SEC))

        // Create RTCCVPixelBuffer with the pixel buffer
        let rtcPixelBuffer = RTCCVPixelBuffer(pixelBuffer: pixelBuffer)

        // Create the video frame with the buffer
        let videoFrame = RTCVideoFrame(
            buffer: rtcPixelBuffer,
            rotation: ._0,
            timeStampNs: timeStampNs
        )

        // Now we can safely cross to MainActor with the video frame
        await MainActor.run { [weak self] in
            guard let self,
                  let videoCapturer = self.videoCapturer,
                  let videoSource = self.videoSource else { return }

            videoSource.capturer(videoCapturer, didCapture: videoFrame)

            // Log success occasionally
            if Int.random(in: 0..<300) == 0 {
                self.logger
                    .info(
                        "✅ Sent video frame to WebRTC - size: \(CVPixelBufferGetWidth(pixelBuffer))x\(CVPixelBufferGetHeight(pixelBuffer))"
                    )
            }
        }
    }

    // MARK: - Private Methods

    private func createVideoEncoderFactory() -> RTCVideoEncoderFactory {
        // Create a hybrid encoder factory that supports both H.265 and H.264
        // The default factory should automatically support available codecs
        
        // Check if hardware H.265 encoding is available
        let h265Available = isH265HardwareEncodingAvailable()
        logger.info("🎥 H.265 hardware encoding available: \(h265Available)")
        
        // Use default factory which includes all available codecs
        // It will automatically use hardware acceleration when available
        let encoderFactory = RTCDefaultVideoEncoderFactory()
        
        logger.info("✅ Created default encoder factory with H.265/H.264 support")
        return encoderFactory
    }
    
    private func isH265HardwareEncodingAvailable() -> Bool {
        // Check if the system supports hardware H.265 encoding
        // macOS 14+ on Apple Silicon or Intel with T2 chip should support it
        
        // Check for hardware support using VideoToolbox
        var isHardwareAccelerated = false
        
        // Create a test encoding session to check HEVC support
        let encoderSpecification = [
            kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder: true,
            kVTVideoEncoderSpecification_RequireHardwareAcceleratedVideoEncoder: true
        ] as CFDictionary
        
        var compressionSession: VTCompressionSession?
        let status = VTCompressionSessionCreate(
            allocator: nil,
            width: 1920,
            height: 1080,
            codecType: kCMVideoCodecType_HEVC,
            encoderSpecification: encoderSpecification,
            imageBufferAttributes: nil,
            compressedDataAllocator: nil,
            outputCallback: nil,
            refcon: nil,
            compressionSessionOut: &compressionSession
        )
        
        if status == noErr, let session = compressionSession {
            isHardwareAccelerated = true
            VTCompressionSessionInvalidate(session)
        }
        
        logger.info("🔍 VideoToolbox HEVC hardware encoding check: \(isHardwareAccelerated ? "supported" : "not supported") (status: \(status))")
        return isHardwareAccelerated
    }
    
    private func logCodecCapabilities() {
        let h265Available = isH265HardwareEncodingAvailable()
        logger.info("🎬 WebRTC codec capabilities:")
        logger.info("  - Default encoder factory created")
        logger.info("  - H.265/HEVC support: \(h265Available ? "Available" : "Not available")")
        logger.info("  - H.264/AVC support: Always available")
        logger.info("  - Hardware acceleration: Automatic when available")
        
        // The WebRTC library version we're using doesn't expose getCapabilities
        // But the default factory will automatically use the best available codec
    }
    
    private func configureCodecPreferences(for peerConnection: RTCPeerConnection) {
        // Get the transceivers to configure codec preferences
        let transceivers = peerConnection.transceivers
        
        for transceiver in transceivers {
            if transceiver.mediaType == .video {
                // Get all available codecs
                let allCodecs = RTCRtpSender.capabilities(for: .video).codecs
                
                // Log available codecs
                logger.info("📋 Available video codecs:")
                for codec in allCodecs {
                    logger.info("  - \(codec.mimeType) (\(codec.name))")
                }
                
                // Filter and prioritize H.264 codecs
                let h264Codecs = allCodecs.filter { codec in
                    codec.mimeType.lowercased() == "video/h264"
                }
                
                // Also get H.265 codecs if available
                let h265Codecs = allCodecs.filter { codec in
                    codec.mimeType.lowercased() == "video/h265" || 
                    codec.name.lowercased().contains("hevc")
                }
                
                // Get other codecs (VP8, VP9, etc)
                let otherCodecs = allCodecs.filter { codec in
                    !h264Codecs.contains(codec) && !h265Codecs.contains(codec)
                }
                
                // Set codec preference order: H.264 first, then H.265, then others
                var preferredCodecs: [RTCRtpCodecCapability] = []
                preferredCodecs.append(contentsOf: h264Codecs)
                preferredCodecs.append(contentsOf: h265Codecs)
                preferredCodecs.append(contentsOf: otherCodecs)
                
                // Apply the codec preferences
                do {
                    try transceiver.setCodecPreferences(preferredCodecs)
                    logger.info("✅ Configured codec preferences with H.264 priority")
                    logger.info("  Preference order: \(preferredCodecs.map { $0.name }.joined(separator: ", "))")
                } catch {
                    logger.error("❌ Failed to set codec preferences: \(error)")
                }
            }
        }
    }

    private func createPeerConnection() throws {
        let config = RTCConfiguration()
        config.iceServers = [
            RTCIceServer(urlStrings: ["stun:stun.l.google.com:19302"])
        ]
        config.sdpSemantics = .unifiedPlan
        config.continualGatheringPolicy = .gatherContinually

        // Set codec preferences for H.264/H.265
        let constraints = RTCMediaConstraints(
            mandatoryConstraints: nil,
            optionalConstraints: ["DtlsSrtpKeyAgreement": "true"]
        )

        guard let peerConnection = peerConnectionFactory?.peerConnection(
            with: config,
            constraints: constraints,
            delegate: self
        ) else {
            throw WebRTCError.failedToCreatePeerConnection
        }

        self.peerConnection = peerConnection
        
        // Log available codec capabilities
        logCodecCapabilities()

        // Add local video track
        if let localVideoTrack {
            peerConnection.add(localVideoTrack, streamIds: ["screen-share"])
            
            // Configure codec preferences after adding the track
            configureCodecPreferences(for: peerConnection)
        }

        logger.info("✅ Created peer connection")
    }

    private func createLocalVideoTrack() {
        guard let videoSource = peerConnectionFactory?.videoSource() else {
            logger.error("Failed to create video source")
            return
        }

        // Configure video source for 4K quality at 60 FPS
        videoSource.adaptOutputFormat(
            toWidth: 3_840, // 4K width
            height: 2_160, // 4K height
            fps: 60 // 60 FPS for smooth motion
        )

        self.videoSource = videoSource

        // Create video capturer
        let videoCapturer = RTCVideoCapturer(delegate: videoSource)
        self.videoCapturer = videoCapturer
        
        logger.info("📹 Created video capturer")

        // Create video track
        let videoTrack = peerConnectionFactory!.videoTrack(
            with: videoSource,
            trackId: "screen-video-track"
        )
        videoTrack.isEnabled = true

        self.localVideoTrack = videoTrack

        logger.info("✅ Created local video track with 4K quality settings: 3840x2160@60fps")
    }

    private func connectSignaling() async throws {
        logger.info("📡 Connecting to signaling server: \(self.signalURL)")

        let session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        self.signalSession = session

        let request = URLRequest(url: signalURL)
        let socketTask = session.webSocketTask(with: request)
        self.signalSocket = socketTask

        socketTask.resume()

        // Start receiving messages
        Task {
            await receiveSignalMessages()
        }

        // Wait for connection
        try await withCheckedThrowingContinuation { continuation in
            Task {
                // Give it 5 seconds to connect
                try await Task.sleep(nanoseconds: 5_000_000_000)
                if self.signalSocket?.state == .running {
                    continuation.resume()
                } else {
                    continuation.resume(throwing: WebRTCError.signalConnectionFailed)
                }
            }
        }
    }

    private func receiveSignalMessages() async {
        guard let socket = signalSocket else { return }

        do {
            while socket.state == .running {
                let message = try await socket.receive()

                switch message {
                case .string(let text):
                    await handleSignalMessage(text)
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        await handleSignalMessage(text)
                    }
                @unknown default:
                    break
                }
            }
        } catch {
            logger.error("WebSocket receive error: \(error)")
        }
    }

    private func handleSignalMessage(_ text: String) async {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String
        else {
            logger.error("Invalid signal message format")
            return
        }

        logger.info("📥 Received signal: \(type)")

        switch type {
        case "start-capture":
            // Browser wants to start capture, create offer
            await createAndSendOffer()

        case "answer":
            // Received answer from browser
            if let answerData = json["data"] as? [String: Any],
               let sdp = answerData["sdp"] as? String
            {
                let answer = RTCSessionDescription(type: .answer, sdp: sdp)
                await setRemoteDescription(answer)
            }

        case "ice-candidate":
            // Received ICE candidate
            if let candidateData = json["data"] as? [String: Any],
               let sdpMid = candidateData["sdpMid"] as? String,
               let sdpMLineIndex = candidateData["sdpMLineIndex"] as? Int32,
               let candidate = candidateData["candidate"] as? String
            {
                let iceCandidate = RTCIceCandidate(
                    sdp: candidate,
                    sdpMLineIndex: sdpMLineIndex,
                    sdpMid: sdpMid
                )
                await addIceCandidate(iceCandidate)
            }

        case "error":
            if let error = json["data"] as? String {
                logger.error("Signal error: \(error)")
            }

        default:
            logger.warning("Unknown signal type: \(type)")
        }
    }

    private func createAndSendOffer() async {
        guard let peerConnection else { return }

        do {
            let constraints = RTCMediaConstraints(
                mandatoryConstraints: [
                    "OfferToReceiveVideo": "false",
                    "OfferToReceiveAudio": "false"
                ],
                optionalConstraints: nil
            )

            // Create offer first
            let offer = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<RTCSessionDescription, Error>) in
                peerConnection.offer(for: constraints) { offer, error in
                    if let error = error {
                        continuation.resume(throwing: error)
                    } else if let offer = offer {
                        continuation.resume(returning: offer)
                    } else {
                        continuation.resume(throwing: WebRTCError.failedToCreatePeerConnection)
                    }
                }
            }
            
            // Modify SDP on MainActor
            var modifiedSdp = offer.sdp
            modifiedSdp = self.addBandwidthToSdp(modifiedSdp)
            let modifiedOffer = RTCSessionDescription(type: offer.type, sdp: modifiedSdp)
            
            // Set local description
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                peerConnection.setLocalDescription(modifiedOffer) { error in
                    if let error = error {
                        continuation.resume(throwing: error)
                    } else {
                        continuation.resume()
                    }
                }
            }
            
            let offerType = modifiedOffer.type == .offer ? "offer" : modifiedOffer.type == .answer ? "answer" : "unknown"
            let offerSdp = modifiedOffer.sdp

            // Send offer through signaling
            await sendSignalMessage([
                "type": "offer",
                "data": [
                    "type": offerType,
                    "sdp": offerSdp
                ]
            ])

            logger.info("📤 Sent offer")
        } catch {
            logger.error("Failed to create offer: \(error)")
        }
    }

    private func setRemoteDescription(_ description: RTCSessionDescription) async {
        guard let peerConnection else { return }

        do {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                peerConnection.setRemoteDescription(description) { error in
                    if let error {
                        continuation.resume(throwing: error)
                    } else {
                        continuation.resume()
                    }
                }
            }
            logger.info("✅ Set remote description")
        } catch {
            logger.error("Failed to set remote description: \(error)")
        }
    }

    private func addIceCandidate(_ candidate: RTCIceCandidate) async {
        guard let peerConnection else { return }

        do {
            try await peerConnection.add(candidate)
            logger.debug("Added ICE candidate")
        } catch {
            logger.error("Failed to add ICE candidate: \(error)")
        }
    }

    private func sendSignalMessage(_ message: [String: Any]) async {
        guard let socket = signalSocket,
              socket.state == .running,
              let data = try? JSONSerialization.data(withJSONObject: message),
              let text = String(data: data, encoding: .utf8)
        else {
            logger.error("Failed to send signal message")
            return
        }

        do {
            try await socket.send(.string(text))
        } catch {
            logger.error("Failed to send message: \(error)")
        }
    }

    private func addBandwidthToSdp(_ sdp: String) -> String {
        let lines = sdp.components(separatedBy: "\n")
        var modifiedLines: [String] = []
        var inVideoSection = false
        var h265Found = false
        var h264Found = false

        for (index, line) in lines.enumerated() {
            var modifiedLine = line
            
            // Check if we're entering video m-line
            if line.starts(with: "m=video") {
                inVideoSection = true
            } else if line.starts(with: "m=") {
                inVideoSection = false
            }
            
            // Look for H.265/HEVC codec in rtpmap
            if inVideoSection && line.contains("rtpmap") {
                if line.contains("H265") || line.contains("HEVC") {
                    h265Found = true
                    logger.info("🎥 Found H.265 codec in SDP: \(line)")
                } else if line.contains("H264") {
                    h264Found = true
                }
            }
            
            // Add Safari-specific H.265 parameters if needed
            if inVideoSection && line.starts(with: "a=fmtp:") && (line.contains("H265") || line.contains("HEVC")) {
                // Add Safari-specific parameters for H.265
                if !line.contains("level-asymmetry-allowed") {
                    modifiedLine += ";level-asymmetry-allowed=1"
                }
                if !line.contains("packetization-mode") {
                    modifiedLine += ";packetization-mode=1"
                }
                logger.info("📝 Modified H.265 fmtp line for Safari: \(modifiedLine)")
            }
            
            modifiedLines.append(modifiedLine)

            // Add bandwidth constraint after video m-line
            if inVideoSection && line.starts(with: "m=video") {
                // Use different bitrates for H.265 vs H.264
                // H.265 is more efficient, so we can use lower bitrate for same quality
                let bitrate = h265Found ? 30000 : 50000 // 30 Mbps for H.265, 50 Mbps for H.264
                modifiedLines.append("b=AS:\(bitrate)")
                logger.info("📈 Added bandwidth constraint to SDP: \(bitrate / 1000) Mbps for 4K@60fps (\(h265Found ? "H.265" : "H.264"))")
            }
            
            // Add codec preference if we're at the end of video section
            if inVideoSection && index + 1 < lines.count && lines[index + 1].starts(with: "m=") {
                // If we have both codecs, ensure H.265 is preferred for Safari
                if h265Found && h264Found {
                    modifiedLines.append("a=x-google-flag:conference")
                    logger.info("🎯 Added codec preference flag for Safari H.265 priority")
                }
            }
        }
        
        // Log codec detection results
        logger.info("📊 SDP Codec Analysis - H.265: \(h265Found ? "present" : "absent"), H.264: \(h264Found ? "present" : "absent")")

        return modifiedLines.joined(separator: "\n")
    }

    private func disconnect() async {
        // Close peer connection
        peerConnection?.close()
        peerConnection = nil

        // Close WebSocket
        if let socket = signalSocket {
            socket.cancel(with: .normalClosure, reason: nil)
            signalSocket = nil
        }

        // Clean up tracks and sources
        localVideoTrack = nil
        videoSource = nil
        videoCapturer = nil

        isConnected = false

        logger.info("Disconnected WebRTC")
    }
}

// MARK: - RTCPeerConnectionDelegate

extension WebRTCManager: RTCPeerConnectionDelegate {
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {
        Task { @MainActor in
            logger.info("Signaling state: \(stateChanged.rawValue)")
        }
    }

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {
        // Not used for sending
    }

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {
        // Not used for sending
    }

    nonisolated func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {
        Task { @MainActor in
            logger.info("Should negotiate")
        }
    }

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
        Task { @MainActor in
            let stateString = switch newState {
            case .new: "new"
            case .checking: "checking"
            case .connected: "connected"
            case .completed: "completed"
            case .failed: "failed"
            case .disconnected: "disconnected"
            case .closed: "closed"
            case .count: "count"
            @unknown default: "unknown"
            }
            logger.info("ICE connection state: \(stateString)")
            isConnected = newState == .connected || newState == .completed
        }
    }

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {
        Task { @MainActor in
            logger.info("ICE gathering state: \(newState.rawValue)")
        }
    }

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        // Extract values before entering the Task to avoid sendability issues
        let candidateSdp = candidate.sdp
        let sdpMid = candidate.sdpMid ?? ""
        let sdpMLineIndex = candidate.sdpMLineIndex

        Task { @MainActor in
            logger.info("🧊 Generated ICE candidate: \(candidateSdp)")
            // Send ICE candidate through signaling
            await sendSignalMessage([
                "type": "ice-candidate",
                "data": [
                    "candidate": candidateSdp,
                    "sdpMid": sdpMid,
                    "sdpMLineIndex": sdpMLineIndex
                ]
            ])
        }
    }

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {
        // Not needed
    }

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {
        // Not using data channels
    }

    nonisolated func peerConnection(
        _ peerConnection: RTCPeerConnection,
        didChange connectionState: RTCPeerConnectionState
    ) {
        Task { @MainActor in
            logger.info("Connection state: \(connectionState.rawValue)")
            self.connectionState = connectionState
        }
    }
}

// MARK: - URLSessionWebSocketDelegate

extension WebRTCManager: URLSessionWebSocketDelegate {
    nonisolated func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        Task { @MainActor in
            logger.info("✅ WebSocket connected")
        }
    }

    nonisolated func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?
    ) {
        Task { @MainActor in
            logger.info("WebSocket closed: \(closeCode.rawValue)")
        }
    }
}

// MARK: - Supporting Types

enum WebRTCError: LocalizedError {
    case failedToCreatePeerConnection
    case signalConnectionFailed
    case invalidConfiguration

    var errorDescription: String? {
        switch self {
        case .failedToCreatePeerConnection:
            "Failed to create WebRTC peer connection"
        case .signalConnectionFailed:
            "Failed to connect to signaling server"
        case .invalidConfiguration:
            "Invalid WebRTC configuration"
        }
    }
}
