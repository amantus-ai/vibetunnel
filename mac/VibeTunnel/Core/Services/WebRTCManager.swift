import Combine
import CoreMedia
import Foundation
import OSLog

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
        // Create a custom encoder factory that supports H.265/HEVC
        // WebRTC provides specific factories for H.264 and H.265
        
        // First, create the H.265 encoder factory if available
        if #available(macOS 11.0, *) {
            // Create an array of codec info to specify our preferences
            var supportedCodecs: [RTCVideoCodecInfo] = []
            
            // Add H.265/HEVC as the highest priority
            let h265Codec = RTCVideoCodecInfo(name: kRTCVideoCodecH265)
            h265Codec.parameters = [
                "profile-level-id": "640c1f", // Main profile, level 3.1 for 1080p@30fps
                "packetization-mode": "1"
            ]
            supportedCodecs.append(h265Codec)
            
            // Add H.264 as fallback
            let h264BaselineCodec = RTCVideoCodecInfo(name: kRTCVideoCodecH264)
            h264BaselineCodec.parameters = [
                "profile-level-id": "42e01f", // Baseline profile for compatibility
                "packetization-mode": "1"
            ]
            supportedCodecs.append(h264BaselineCodec)
            
            let h264HighCodec = RTCVideoCodecInfo(name: kRTCVideoCodecH264)
            h264HighCodec.parameters = [
                "profile-level-id": "640c1f", // High profile for better quality
                "packetization-mode": "1"
            ]
            supportedCodecs.append(h264HighCodec)
            
            // Add VP8 as final fallback
            supportedCodecs.append(RTCVideoCodecInfo(name: kRTCVideoCodecVp8))
            
            // Create encoder factory with our codec preferences
            let encoderFactory = RTCVideoEncoderFactorySimulcast(
                primary: RTCVideoEncoderFactoryH265(),
                fallback: RTCVideoEncoderFactoryH264()
            )
            
            logger.info("✅ Created custom encoder factory with H.265 support")
            return encoderFactory
        } else {
            // Fallback for older macOS versions
            logger.warning("H.265 not available on this macOS version, using H.264")
            return RTCDefaultVideoEncoderFactory()
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

        // Add local video track
        if let localVideoTrack {
            peerConnection.add(localVideoTrack, streamIds: ["screen-share"])
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

            // Create offer and set local description
            let (offerType, offerSdp) = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<
                (String, String),
                Error
            >) in
                peerConnection.offer(for: constraints) { offer, error in
                    if let error {
                        continuation.resume(throwing: error)
                    } else if let offer {
                        // Extract values before Task to avoid sendability issues
                        let offerType = offer.type
                        let offerSdp = offer.sdp

                        Task { @MainActor in
                            // Modify SDP to increase bandwidth before setting local description
                            var modifiedSdp = offerSdp
                            modifiedSdp = self.addBandwidthToSdp(modifiedSdp)
                            let modifiedOffer = RTCSessionDescription(type: offerType, sdp: modifiedSdp)

                            // Set local description using async wrapper
                            do {
                                try await withCheckedThrowingContinuation { (innerContinuation: CheckedContinuation<
                                    Void,
                                    Error
                                >) in
                                    peerConnection.setLocalDescription(modifiedOffer) { error in
                                        if let error {
                                            innerContinuation.resume(throwing: error)
                                        } else {
                                            innerContinuation.resume()
                                        }
                                    }
                                }
                                let typeString = modifiedOffer.type == .offer ? "offer" : modifiedOffer
                                    .type == .answer ? "answer" : "unknown"
                                continuation.resume(returning: (typeString, modifiedOffer.sdp))
                            } catch {
                                continuation.resume(throwing: error)
                            }
                        }
                    } else {
                        continuation.resume(throwing: WebRTCError.failedToCreatePeerConnection)
                    }
                }
            }

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

        for line in lines {
            modifiedLines.append(line)

            // Check if we're entering video m-line
            if line.starts(with: "m=video") {
                inVideoSection = true
            } else if line.starts(with: "m=") {
                inVideoSection = false
            }

            // Add bandwidth constraint after video m-line
            if inVideoSection && line.starts(with: "m=video") {
                // Add bandwidth constraint: 50 Mbps (50000 kbps) for 4K@60fps
                modifiedLines.append("b=AS:50000")
                logger.info("📈 Added bandwidth constraint to SDP: 50 Mbps for 4K@60fps")
            }
        }

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
