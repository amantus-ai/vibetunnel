import Combine
import CoreMedia
import Foundation
import Network
import OSLog
import VideoToolbox

@preconcurrency import WebRTC

/// Manages WebRTC connections for screen sharing
@MainActor
final class WebRTCManager: NSObject {
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "WebRTCManager")

    /// Reference to screencap service for API operations
    private let screencapService: ScreencapService?

    // MARK: - Properties

    private var peerConnectionFactory: RTCPeerConnectionFactory?
    private var peerConnection: RTCPeerConnection?
    private var localVideoTrack: RTCVideoTrack?
    private var videoSource: RTCVideoSource?
    private var videoCapturer: RTCVideoCapturer?

    /// UNIX socket for signaling
    private var unixSocket: UnixSocketConnection?

    /// Server URL (kept for reference)
    private let serverURL: URL

    /// Local auth token (no longer needed for UNIX socket)
    let localAuthToken: String?

    // Session management for security
    private var activeSessionId: String?
    private var sessionStartTime: Date?

    // Adaptive bitrate control
    private var statsTimer: Timer?
    private var currentBitrate: Int = 40_000_000 // Start at 40 Mbps
    private var targetBitrate: Int = 40_000_000
    private let minBitrate: Int = 5_000_000 // 5 Mbps minimum for better quality
    private let maxBitrate: Int = 50_000_000 // 50 Mbps maximum
    private var lastPacketLoss: Double = 0.0
    private var lastRtt: Double = 0.0

    // MARK: - Published Properties

    @Published private(set) var connectionState: RTCPeerConnectionState = .new
    @Published private(set) var isConnected = false
    @Published private(set) var use8k = false

    // MARK: - Initialization

    init(serverURL: URL, screencapService: ScreencapService, localAuthToken: String? = nil) {
        self.serverURL = serverURL
        self.screencapService = screencapService
        self.localAuthToken = localAuthToken

        super.init()

        // Initialize WebRTC
        RTCInitializeSSL()

        let videoEncoderFactory = createVideoEncoderFactory()
        let videoDecoderFactory = RTCDefaultVideoDecoderFactory()
        peerConnectionFactory = RTCPeerConnectionFactory(
            encoderFactory: videoEncoderFactory,
            decoderFactory: videoDecoderFactory
        )

        // Get the shared socket and register our handler.
        // The connection itself is managed by the AppDelegate and SharedUnixSocketManager.
        let sharedManager = SharedUnixSocketManager.shared
        self.unixSocket = sharedManager.getConnection()
        sharedManager.registerControlHandler(for: .screencap) { [weak self] message in
            guard let self else { return nil }
            return await self.handleControlMessage(message)
        }

        // Set up a listener for state changes on the shared socket.
        self.unixSocket?.onStateChange = { [weak self] state in
            Task { @MainActor [weak self] in
                self?.handleSocketStateChange(state)
            }
        }

        // If the socket is already connected, sync our state.
        if sharedManager.isConnected {
            handleSocketStateChange(.ready)
        }

        logger.info("✅ WebRTC Manager initialized and handler registered.")
    }

    deinit {
        // Clean up synchronously
        localVideoTrack = nil
        videoSource = nil
        peerConnection = nil

        // Unregister control handler
        Task { @MainActor in
            SharedUnixSocketManager.shared.unregisterControlHandler(for: .screencap)
        }

        RTCCleanupSSL()
    }

    // MARK: - Public Methods

    func setQuality(use8k: Bool) {
        self.use8k = use8k
        logger.info("📺 Quality set to \(use8k ? "8K" : "4K")")
    }

    /// Start WebRTC capture for the given mode
    func startCapture(mode: String) async throws {
        logger.info("🚀 Starting WebRTC capture")

        // Create video track first
        createLocalVideoTrack()

        // Create peer connection (will add the video track)
        try createPeerConnection()

        // Ensure we have a UNIX socket connection
        if unixSocket == nil || !isConnected {
            try await screencapService?.connectForApiHandling()
        }

        // The server will now determine when the Mac is ready based on the socket connection.
        // No longer need to send an explicit mac-ready message here.
    }

    /// Stop WebRTC capture
    func stopCapture() async {
        logger.info("🛑 Stopping WebRTC capture")

        // Clear session information for the capture
        if let sessionId = activeSessionId {
            logger.info("🔒 [SECURITY] Capture session ended: \(sessionId)")
            activeSessionId = nil
            sessionStartTime = nil
        }

        // Stop stats monitoring
        stopStatsMonitoring()

        // Stop video track
        localVideoTrack?.isEnabled = false

        // Close peer connection but keep WebSocket for API
        if let pc = peerConnection {
            // Remove all transceivers properly
            for transceiver in pc.transceivers {
                pc.removeTrack(transceiver.sender)
            }
            pc.close()
        }
        peerConnection = nil

        // Clean up video tracks and sources
        localVideoTrack = nil
        videoSource = nil
        videoCapturer = nil

        logger.info("✅ Stopped WebRTC capture (keeping WebSocket for API)")
    }

    /// Disconnect from signaling server
    func disconnect() async {
        logger.info("🔌 Disconnecting from UNIX socket")
        await cleanupResources()
        logger.info("Disconnected WebRTC and UNIX socket")
    }

    /// Clean up all resources - called from deinit and disconnect
    private func cleanupResources() async {
        // Clear session information
        if let sessionId = activeSessionId {
            logger.info("🔒 [SECURITY] Session terminated: \(sessionId)")
            activeSessionId = nil
            sessionStartTime = nil
        }

        // Stop video track if active
        localVideoTrack?.isEnabled = false

        // Close peer connection properly
        if let pc = peerConnection {
            // Remove all transceivers
            for transceiver in pc.transceivers {
                pc.removeTrack(transceiver.sender)
            }
            pc.close()
        }
        peerConnection = nil

        // Unregister our control handler from shared manager
        SharedUnixSocketManager.shared.unregisterControlHandler(for: .screencap)

        // Clear socket reference (but don't disconnect - it's shared)
        unixSocket = nil
        isConnected = false

        // Clean up video resources
        localVideoTrack = nil
        videoSource = nil
        videoCapturer = nil

        isConnected = false
    }

    /// Process a video frame from ScreenCaptureKit synchronously
    /// This method extracts the data synchronously to avoid data race warnings
    nonisolated func processVideoFrameSync(_ sampleBuffer: CMSampleBuffer) {
        // Track first frame - using nonisolated struct
        enum FrameTracker {
            nonisolated(unsafe) static var frameCount = 0
            nonisolated(unsafe) static var firstFrameLogged = false
        }
        FrameTracker.frameCount += 1
        let isFirstFrame = FrameTracker.frameCount == 1

        // Extract all necessary data from the sample buffer synchronously
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            if isFirstFrame {
                Task { @MainActor in
                    self.logger.error("❌ First frame has no pixel buffer!")
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

        // Now we can safely create a task without capturing CMSampleBuffer
        // Capture necessary values
        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)

        // Use nonisolated async variant with sending parameter
        Task.detached {
            await self.sendVideoFrame(
                videoFrame,
                width: Int32(width),
                height: Int32(height),
                isFirstFrame: isFirstFrame,
                frameCount: FrameTracker.frameCount
            )
        }
    }

    @MainActor
    private func sendVideoFrame(
        _ videoFrame: RTCVideoFrame,
        width: Int32,
        height: Int32,
        isFirstFrame: Bool,
        frameCount: Int
    )
        async
    {
        // Check if we're connected before processing
        guard self.isConnected else {
            // Only log occasionally to avoid spam
            if Int.random(in: 0..<30) == 0 {
                self.logger.debug("Skipping frame - WebRTC not connected yet")
            }
            return
        }

        // Send the frame to WebRTC
        guard let videoCapturer = self.videoCapturer,
              let videoSource = self.videoSource else { return }

        // Log first frame or periodically
        if isFirstFrame || frameCount.isMultiple(of: 300) {
            self.logger.info("🎬 Sending frame \(frameCount) to WebRTC: \(width)x\(height)")
            self.logger
                .info(
                    "📊 Current bitrate: \(self.currentBitrate / 1_000_000) Mbps, target: \(self.targetBitrate / 1_000_000) Mbps"
                )
        }

        videoSource.capturer(videoCapturer, didCapture: videoFrame)

        if isFirstFrame {
            self.logger.info("✅ FIRST VIDEO FRAME SENT TO WEBRTC!")
            self.logger.info("🎥 Video source active: \(self.videoSource != nil)")
            self.logger.info("📡 Peer connection state: \(String(describing: self.connectionState))")
        }
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
        // Create encoder factory that supports H.264 and VP8
        // Use default factory which includes both codecs
        let encoderFactory = RTCDefaultVideoEncoderFactory()

        // Log what codecs the factory actually supports
        let supportedCodecs = encoderFactory.supportedCodecs()
        logger.info("📋 Factory supported codecs:")

        var hasH264 = false
        var hasVP8 = false

        for codec in supportedCodecs {
            logger.info("  - \(codec.name): \(codec.parameters)")
            if codec.name.uppercased() == "H264" {
                hasH264 = true
            } else if codec.name.uppercased() == "VP8" {
                hasVP8 = true
            }
        }

        logger.info("✅ Created encoder factory - H.264: \(hasH264), VP8: \(hasVP8)")
        return encoderFactory
    }

    private func logCodecCapabilities() {
        logger.info("🎬 WebRTC codec capabilities:")
        logger.info("  - Default encoder factory created")
        logger.info("  - H.264/AVC support: Available with hardware acceleration")
        logger.info("  - VP8 support: Available as software codec")
        logger.info("  - Codec priority: H.264 > VP8 > Others")
        logger.info("  - Hardware acceleration: Automatic when available")
    }

    private func setInitialBitrateParameters(for peerConnection: RTCPeerConnection) {
        // Set initial encoder parameters with proper bitrate
        guard let transceiver = peerConnection.transceivers.first(where: { $0.mediaType == .video }) else {
            logger.warning("⚠️ No video transceiver found to set initial bitrate")
            return
        }

        let sender = transceiver.sender

        let parameters = sender.parameters

        // Configure initial encoding parameters
        if parameters.encodings.isEmpty {
            // Create a new encoding if none exist
            let encoding = RTCRtpEncodingParameters()
            encoding.maxBitrateBps = NSNumber(value: currentBitrate)
            encoding.isActive = true
            parameters.encodings = [encoding]
        } else {
            // Update existing encodings
            for encoding in parameters.encodings {
                encoding.maxBitrateBps = NSNumber(value: currentBitrate)
                encoding.isActive = true
            }
        }

        sender.parameters = parameters

        logger.info("📊 Set initial bitrate parameters:")
        logger.info("  - Initial bitrate: \(self.currentBitrate / 1_000_000) Mbps")
        logger.info("  - Encodings count: \(parameters.encodings.count)")
    }

    private func configureCodecPreferences(for peerConnection: RTCPeerConnection) {
        // Get the transceivers to configure codec preferences
        let transceivers = peerConnection.transceivers

        for transceiver in transceivers where transceiver.mediaType == .video {
            let sender = transceiver.sender
            _ = transceiver.receiver

            // Get current parameters
            let params = sender.parameters
            logger.info("📋 Current sender codec parameters:")

            // Find H.264 and VP8 codecs
            var h264Codecs: [RTCRtpCodecParameters] = []
            var vp8Codecs: [RTCRtpCodecParameters] = []
            var otherCodecs: [RTCRtpCodecParameters] = []

            for codec in params.codecs {
                logger.info("  - \(codec.name): \(codec.parameters)")

                if codec.name.uppercased() == "H264" {
                    h264Codecs.append(codec)
                } else if codec.name.uppercased() == "VP8" {
                    vp8Codecs.append(codec)
                } else {
                    otherCodecs.append(codec)
                }
            }

            // Reorder codecs: VP8 first, then H.264, then others
            var orderedCodecs: [RTCRtpCodecParameters] = []
            orderedCodecs.append(contentsOf: vp8Codecs)
            orderedCodecs.append(contentsOf: h264Codecs)
            orderedCodecs.append(contentsOf: otherCodecs)

            // Update parameters with reordered codecs
            params.codecs = orderedCodecs
            sender.parameters = params

            logger.info("📝 Configured codec preferences: VP8 first, H.264 second")
            logger.info("  - VP8 codecs: \(vp8Codecs.count)")
            logger.info("  - H.264 codecs: \(h264Codecs.count)")
            logger.info("  - Other codecs: \(otherCodecs.count)")
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
            logger.info("🎥 Adding local video track to peer connection")
            logger.info("  - Track ID: \(localVideoTrack.trackId)")
            logger.info("  - Track enabled: \(localVideoTrack.isEnabled)")
            logger.info("  - Video source exists: \(self.videoSource != nil)")

            // Add the track to the peer connection. This will create a transceiver.
            peerConnection.add(localVideoTrack, streamIds: ["screen-share"])
            logger.info("✅ Video track added to peer connection")

            // Now that the transceiver is created, we can configure it.
            setInitialBitrateParameters(for: peerConnection)
            configureCodecPreferences(for: peerConnection)

            logger.info("📡 Transceivers count: \(peerConnection.transceivers.count)")

            // Log transceiver details
            for (index, transceiver) in peerConnection.transceivers.enumerated() {
                let mediaTypeString = transceiver.mediaType == .video ? "video" : "audio"
                let directionString = String(describing: transceiver.direction)
                logger.info("  Transceiver \(index): type=\(mediaTypeString), direction=\(directionString)")
            }
        } else {
            logger.error("❌ No local video track to add!")
        }

        logger.info("✅ Created peer connection")
    }

    private func createLocalVideoTrack() {
        logger.info("🎥 Creating local video track...")

        guard let peerConnectionFactory = self.peerConnectionFactory else {
            logger.error("❌ Peer connection factory is nil!")
            return
        }

        let videoSource = peerConnectionFactory.videoSource()
        logger.info("🎥 Created video source")

        // Configure video source for 4K or 8K quality at 60 FPS
        let width = use8k ? 7_680 : 3_840
        let height = use8k ? 4_320 : 2_160

        videoSource.adaptOutputFormat(
            toWidth: Int32(width),
            height: Int32(height),
            fps: 60
        )

        self.videoSource = videoSource

        // Create video capturer
        let videoCapturer = RTCVideoCapturer(delegate: videoSource)
        self.videoCapturer = videoCapturer

        logger.info("📹 Created video capturer")

        // Create video track
        let videoTrack = peerConnectionFactory.videoTrack(
            with: videoSource,
            trackId: "screen-video-track"
        )
        videoTrack.isEnabled = true

        self.localVideoTrack = videoTrack

        logger
            .info(
                "✅ Created local video track with \(self.use8k ? "8K" : "4K") quality settings: \(width)x\(height)@60fps"
            )
        logger.info("📦 Video components created:")
        logger.info("  - Video source: \(self.videoSource != nil)")
        logger.info("  - Video capturer: \(self.videoCapturer != nil)")
        logger.info("  - Local video track: \(self.localVideoTrack != nil)")
        logger.info("  - Track enabled: \(videoTrack.isEnabled)")
    }

    private func handleControlMessage(_ data: Data) async -> Data? {
        // First decode the raw JSON to understand what kind of message it is
        guard let json = try? JSONSerialization.jsonObject(with: data, options: []) as? [String: Any],
              let action = json["action"] as? String
        else {
            logger.error("Failed to decode control message")
            return nil
        }

        logger.info("📥 Received control message with action: \(action)")

        // Log detailed info for api-request messages
        if action == "api-request" {
            logger.info("📥 API Request details:")
            if let id = json["id"] as? String {
                logger.info("  - Message ID: \(id)")
            }
            if let type = json["type"] as? String {
                logger.info("  - Message Type: \(type)")
            }
            if let payload = json["payload"] as? [String: Any] {
                logger.info("  - Payload: \(payload)")
            }
        }

        // The JSON is already in the format expected by handleSignalMessage
        // Just update the "type" field to be the action
        var signalJson = json
        signalJson["type"] = action

        // For api-request messages, merge the payload into the top level
        if action == "api-request", let payload = json["payload"] as? [String: Any] {
            signalJson.merge(payload) { _, new in new }
        }

        await handleSignalMessage(signalJson)

        // No synchronous response needed for most messages
        return nil
    }

    private func handleSocketStateChange(_ state: UnixSocketConnection.ConnectionState) {
        switch state {
        case .ready:
            logger.info("✅ UNIX socket connected")
            isConnected = true
            // Notify ScreencapService that connection is ready
            screencapService?.notifyConnectionReady()
        // The server now knows we are connected and will manage the ready state.
        // No longer need to send mac-ready from here.
        case .failed(let error):
            logger.error("❌ UNIX socket failed: \(error)")
            isConnected = false
        case .cancelled:
            logger.info("UNIX socket cancelled")
            isConnected = false
        case .setup:
            logger.info("🔧 UNIX socket setting up")
        case .preparing:
            logger.info("🔄 UNIX socket preparing")
        case .waiting(let error):
            logger.warning("⏳ UNIX socket waiting: \(error)")
        }
    }

    // Old WebSocket methods removed - now using UNIX socket

    private func handleSignalMessage(_ json: [String: Any]) async {
        guard let type = json["type"] as? String else {
            logger.error("Invalid signal message - no type")
            return
        }

        logger.info("📥 Processing message type: \(type)")

        switch type {
        case "start-capture":
            // Browser wants to start capture, create offer
            // Always update session for this capture
            if let sessionId = json["sessionId"] as? String {
                let previousSession = self.activeSessionId
                if previousSession != sessionId {
                    logger.info("""
                    🔄 [SECURITY] Session update for start-capture
                      Previous session: \(previousSession ?? "nil")
                      New session: \(sessionId)
                      Time since last session: \(
                          self.sessionStartTime.map { Date().timeIntervalSince($0) }?
                              .description ?? "N/A"
                    ) seconds
                    """)
                }
                activeSessionId = sessionId
                sessionStartTime = Date()
                logger.info("🔐 [SECURITY] Session activated for start-capture: \(sessionId)")
            } else {
                logger.warning("⚠️ No session ID provided in start-capture message!")
            }

            // Ensure video track and peer connection are created before sending offer
            if localVideoTrack == nil {
                logger.info("📹 Creating video track for start-capture")
                createLocalVideoTrack()
            }

            if peerConnection == nil {
                logger.info("🔌 Creating peer connection for start-capture")
                do {
                    try createPeerConnection()
                } catch {
                    logger.error("❌ Failed to create peer connection: \(error)")
                    // Send error back to browser
                    let message = ControlProtocol.screencapErrorEvent(
                        error: "Failed to create peer connection: \(error.localizedDescription)",
                        sessionId: activeSessionId
                    )
                    if let messageData = try? ControlProtocol.encode(message) {
                        await sendControlMessage(messageData)
                    }
                    return
                }
            }

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

        case "api-request":
            // Handle API request from browser
            await handleApiRequest(json)

        case "ready":
            // Server acknowledging connection - no action needed
            logger.debug("Server acknowledged connection")

        case "bitrate-adjustment":
            // Bitrate adjustment is handled by the data channel, not signaling
            // This message is forwarded from the browser but can be safely ignored here
            logger.debug("Received bitrate adjustment notification (handled via data channel)")

        case "get-initial-data":
            logger.info("📥 Received get-initial-data request")
            // This request asks for displays and processes data
            await handleGetInitialData(json)

        case "initial-data":
            logger.info("📥 Processing initial-data message")
            // This is the response message that gets forwarded to the browser
            // It's already been sent, so we can safely ignore it here

        case "initial-data-error":
            logger.info("📥 Processing initial-data-error message")
            // This is an error response that gets forwarded to the browser
            // It's already been sent, so we can safely ignore it here

        default:
            logger.warning("⚠️ Unknown signal type: \(type)")
            logger.warning("  Full message: \(json)")
            // Log the unhandled message details for debugging
            if let jsonData = try? JSONSerialization.data(withJSONObject: json, options: .prettyPrinted),
               let jsonString = String(data: jsonData, encoding: .utf8)
            {
                logger.warning("  Unhandled message JSON:\n\(jsonString)")
            }
        }
    }

    private func handleGetInitialData(_ json: [String: Any]) async {
        logger.info("🔍 Processing get-initial-data request")

        // Extract request ID if present
        let requestId = json["requestId"] as? String

        guard let service = screencapService else {
            logger.error("❌ No screencapService available for initial data")
            return
        }

        // Check screen recording permission first
        let hasPermission = await MainActor.run {
            SystemPermissionManager.shared.hasPermission(.screenRecording)
        }

        if !hasPermission {
            logger.warning("⚠️ Screen recording permission not granted for initial data fetch")
            // Send permission required response
            if let messageData = try? ControlProtocol.encodeWithDictionaryPayload(
                type: .response,
                category: .screencap,
                action: "sources-error",
                payload: [
                    "error": "Screen recording permission required",
                    "code": "permission_denied"
                ]
            ) {
                await sendControlMessage(messageData)
            }
            return
        }

        do {
            logger.info("📊 Fetching displays and processes...")

            // Fetch displays
            let displays = try await service.getDisplays()
            let displayList = try displays.map { display in
                let encoder = JSONEncoder()
                let data = try encoder.encode(display)
                return try JSONSerialization.jsonObject(with: data, options: [])
            }
            logger.info("✅ Got \(displays.count) displays")

            // Fetch processes
            let processGroups = try await service.getProcessGroups()
            let processes = try processGroups.map { group in
                let encoder = JSONEncoder()
                let data = try encoder.encode(group)
                return try JSONSerialization.jsonObject(with: data, options: [])
            }
            logger.info("✅ Got \(processGroups.count) process groups")

            // Send response with both displays and processes
            let responseData: [String: Any] = [
                "displays": displayList,
                "processes": processes
            ]

            let messageData: Data = if let requestId {
                // If there's a request ID, create a response
                try ControlProtocol.screencapApiResponse(
                    requestId: requestId,
                    action: "initial-data",
                    payload: responseData
                )
            } else {
                // Otherwise create an event - use the flexible encoder for events with dictionary payloads
                try ControlProtocol.encodeWithDictionaryPayload(
                    type: .event,
                    category: .screencap,
                    action: "initial-data",
                    payload: responseData
                )
            }

            await sendControlMessage(messageData)
            logger.info("📤 Sent initial data response")
        } catch {
            logger.error("❌ Failed to get initial data: \(error)")

            // Send error response if we have a request ID
            if let requestId {
                let errorResponse = ScreencapErrorResponse.from(error)
                let messageData = try? ControlProtocol.screencapApiResponse(
                    requestId: requestId,
                    action: "initial-data-error",
                    error: errorResponse.message
                )
                if let messageData {
                    await sendControlMessage(messageData)
                }
            }
        }
    }

    private func handleApiRequest(_ json: [String: Any]) async {
        logger.info("🔍 Starting handleApiRequest...")
        logger.info("  📋 JSON data: \(json)")

        guard let requestId = json["requestId"] as? String,
              let method = json["method"] as? String,
              let endpoint = json["endpoint"] as? String
        else {
            logger.error("Invalid API request format")
            logger
                .error(
                    "  📋 Missing fields - requestId: \(json["requestId"] != nil), method: \(json["method"] != nil), endpoint: \(json["endpoint"] != nil)"
                )
            return
        }

        logger.info("📨 Received API request: \(method) \(endpoint)")
        logger.info("  📋 Request ID: \(requestId)")
        logger.info("  📋 Full request data: \(json)")

        // Extract session ID from request
        let sessionId = json["sessionId"] as? String
        logger.info("  📋 Request session ID: \(sessionId ?? "nil")")
        logger.info("  📋 Current active session: \(self.activeSessionId ?? "nil")")

        // For capture operations, always update the session ID first before validation
        if (endpoint == "/capture" || endpoint == "/capture-window" || endpoint == "/stop") && sessionId != nil {
            let previousSession = self.activeSessionId
            if previousSession != sessionId {
                logger.info("""
                🔄 [SECURITY] Session update for \(endpoint) (pre-validation)
                  Previous session: \(previousSession ?? "nil")
                  New session: \(sessionId ?? "unknown")
                """)
            }
            activeSessionId = sessionId
            sessionStartTime = Date()
            logger.info("🔐 [SECURITY] Session pre-activated for \(endpoint): \(sessionId ?? "unknown")")
        }

        // Validate session only for control operations
        if isControlOperation(method: method, endpoint: endpoint) {
            logger.info("🔐 Validating session for control operation: \(method) \(endpoint)")
            logger.info("  📋 Request session ID: \(sessionId ?? "nil")")
            logger.info("  📋 Active session ID: \(self.activeSessionId ?? "nil")")

            guard let sessionId,
                  let activeSessionId,
                  sessionId == activeSessionId
            else {
                let errorDetails = """
                🚫 [SECURITY] Unauthorized control attempt
                Method: \(method) \(endpoint)
                Request ID: \(requestId)
                Request session: \(sessionId ?? "nil")
                Active session: \(self.activeSessionId ?? "nil")
                Session match: \(sessionId == self.activeSessionId ? "YES" : "NO")
                Session age: \(
                    self.sessionStartTime.map { Date().timeIntervalSince($0) }?
                        .description ?? "N/A"
                ) seconds
                """
                logger.error("\(errorDetails)")

                let errorMessage =
                    "Unauthorized: Invalid session (request: \(sessionId ?? "nil"), active: \(self.activeSessionId ?? "nil"))"
                if let messageData = try? ControlProtocol.screencapApiResponse(
                    requestId: requestId,
                    action: "api-response",
                    error: errorMessage
                ) {
                    await sendControlMessage(messageData)
                }
                return
            }

            logger.info("✅ Session validation passed for \(method) \(endpoint)")
        }

        logger.info("🔧 API request: \(method) \(endpoint) from session: \(sessionId ?? "unknown")")

        // Process API request on background queue to avoid blocking main thread
        Task {
            logger.info("🔄 Starting Task for API request: \(requestId)")
            logger.info("📋 About to extract params from json")
            logger.info("📋 json keys: \(json.keys.sorted())")
            logger.info("📋 json[\"params\"] exists: \(json["params"] != nil)")
            logger.info("📋 json[\"params\"] type: \(type(of: json["params"]))")

            do {
                logger.info("🔄 About to call processApiRequest")
                let result = try await processApiRequest(
                    method: method,
                    endpoint: endpoint,
                    params: json["params"],
                    sessionId: sessionId
                )
                logger.info("📤 Sending API response for request \(requestId)")
                // Convert result to dictionary if needed
                let payloadData: [String: Any] = if let dictResult = result as? [String: Any] {
                    dictResult
                } else {
                    // For non-dictionary results, wrap in a simple structure
                    ["data": result]
                }

                if let messageData = try? ControlProtocol.screencapApiResponse(
                    requestId: requestId,
                    action: "api-response",
                    payload: payloadData
                ) {
                    await sendControlMessage(messageData)
                }
            } catch {
                logger.error("❌ API request failed for \(requestId): \(error)")
                let screencapError = ScreencapErrorResponse.from(error)
                if let messageData = try? ControlProtocol.screencapApiResponse(
                    requestId: requestId,
                    action: "api-response",
                    payload: ["error": screencapError.toDictionary()]
                ) {
                    await sendControlMessage(messageData)
                }
            }
            logger.info("🔄 Task completed for API request: \(requestId)")
        }
    }

    private func isControlOperation(method: String, endpoint: String) -> Bool {
        // Define which operations require session validation
        let controlEndpoints = [
            "/click", "/mousedown", "/mousemove", "/mouseup", "/key",
            "/capture", "/capture-window", "/stop"
        ]
        return method == "POST" && controlEndpoints.contains(endpoint)
    }

    private func processApiRequest(
        method: String,
        endpoint: String,
        params: Any?,
        sessionId: String?
    )
        async throws -> Any
    {
        // Get reference to screencapService while on main actor
        let service = screencapService
        guard let service else {
            throw WebRTCError.invalidConfiguration
        }

        // Check screen recording permission first for endpoints that need it
        if endpoint == "/processes" || endpoint == "/displays" {
            let hasPermission = await MainActor.run {
                SystemPermissionManager.shared.hasPermission(.screenRecording)
            }

            if !hasPermission {
                logger.warning("⚠️ Screen recording permission not granted for \(endpoint)")
                throw ScreencapError.permissionDenied
            }
        }

        switch (method, endpoint) {
        case ("GET", "/processes"):
            logger.info("📊 Starting process groups fetch on background thread")
            do {
                logger.info("📊 About to call getProcessGroups")
                let processGroups = try await service.getProcessGroups()
                logger.info("📊 Received process groups count: \(processGroups.count)")

                // Convert to dictionaries for JSON serialization
                let processes = try processGroups.map { group in
                    let encoder = JSONEncoder()
                    let data = try encoder.encode(group)
                    return try JSONSerialization.jsonObject(with: data, options: [])
                }
                logger.info("📊 Converted to dictionaries successfully")
                return ["processes": processes]
            } catch {
                logger.error("❌ Failed to get process groups: \(error)")
                throw error
            }

        case ("GET", "/displays"):
            do {
                let displays = try await service.getDisplays()
                // Convert to dictionaries for JSON serialization
                let displayList = try displays.map { display in
                    let encoder = JSONEncoder()
                    let data = try encoder.encode(display)
                    return try JSONSerialization.jsonObject(with: data, options: [])
                }
                return ["displays": displayList]
            } catch {
                // Run diagnostic test when getDisplays fails
                logger.error("❌ getDisplays failed, running diagnostic test...")
                await service.testShareableContent()
                throw error
            }

        case ("POST", "/capture"):
            logger.info("📋 /capture params type: \(type(of: params))")
            logger.info("📋 /capture params value: \(String(describing: params))")

            guard let params = params as? [String: Any],
                  let type = params["type"] as? String,
                  let index = params["index"] as? Int
            else {
                logger.error("❌ Invalid capture params - params: \(String(describing: params))")
                if let params = params as? [String: Any] {
                    logger
                        .error(
                            "  - type present: \(params["type"] != nil), value: \(String(describing: params["type"]))"
                        )
                    logger
                        .error(
                            "  - index present: \(params["index"] != nil), value: \(String(describing: params["index"]))"
                        )
                }
                throw WebRTCError.invalidConfiguration
            }
            let useWebRTC = params["webrtc"] as? Bool ?? false
            let use8k = params["use8k"] as? Bool ?? false
            logger.info("📋 Extracted params - use8k: \(use8k), webrtc: \(useWebRTC)")

            // Session is already updated in handleApiRequest for capture operations
            if sessionId == nil {
                logger.warning("⚠️ No session ID provided for /capture request!")
            }

            try await service.startCapture(type: type, index: index, useWebRTC: useWebRTC, use8k: use8k)
            return ["status": "started", "type": type, "webrtc": useWebRTC, "sessionId": sessionId ?? ""]

        case ("POST", "/capture-window"):
            guard let params = params as? [String: Any],
                  let cgWindowID = params["cgWindowID"] as? Int
            else {
                throw WebRTCError.invalidConfiguration
            }
            let useWebRTC = params["webrtc"] as? Bool ?? false
            let use8k = params["use8k"] as? Bool ?? false
            logger.info("📋 Window capture params - use8k: \(use8k), webrtc: \(useWebRTC)")

            // Session is already updated in handleApiRequest for capture operations
            if sessionId == nil {
                logger.warning("⚠️ No session ID provided for /capture-window request!")
            }

            try await service.startCaptureWindow(cgWindowID: cgWindowID, useWebRTC: useWebRTC, use8k: use8k)
            return ["status": "started", "cgWindowID": cgWindowID, "webrtc": useWebRTC, "sessionId": sessionId ?? ""]

        case ("POST", "/stop"):
            // The session validation is now handled in handleApiRequest.
            // If we reach here, the session is valid.
            await service.stopCapture()
            return ["status": "stopped"]

        case ("POST", "/click"):
            guard let params = params as? [String: Any],
                  let x = params["x"] as? NSNumber,
                  let y = params["y"] as? NSNumber
            else {
                throw WebRTCError.invalidConfiguration
            }
            try await service.sendClick(x: x.doubleValue, y: y.doubleValue)
            return ["status": "clicked"]

        case ("POST", "/mousedown"):
            guard let params = params as? [String: Any],
                  let x = params["x"] as? NSNumber,
                  let y = params["y"] as? NSNumber
            else {
                throw WebRTCError.invalidConfiguration
            }
            try await service.sendMouseDown(x: x.doubleValue, y: y.doubleValue)
            return ["status": "mousedown"]

        case ("POST", "/mousemove"):
            guard let params = params as? [String: Any],
                  let x = params["x"] as? NSNumber,
                  let y = params["y"] as? NSNumber
            else {
                throw WebRTCError.invalidConfiguration
            }
            try await service.sendMouseMove(x: x.doubleValue, y: y.doubleValue)
            return ["status": "mousemove"]

        case ("POST", "/mouseup"):
            guard let params = params as? [String: Any],
                  let x = params["x"] as? NSNumber,
                  let y = params["y"] as? NSNumber
            else {
                throw WebRTCError.invalidConfiguration
            }
            try await service.sendMouseUp(x: x.doubleValue, y: y.doubleValue)
            return ["status": "mouseup"]

        case ("POST", "/key"):
            guard let params = params as? [String: Any],
                  let key = params["key"] as? String
            else {
                throw WebRTCError.invalidConfiguration
            }
            let metaKey = params["metaKey"] as? Bool ?? false
            let ctrlKey = params["ctrlKey"] as? Bool ?? false
            let altKey = params["altKey"] as? Bool ?? false
            let shiftKey = params["shiftKey"] as? Bool ?? false
            try await service.sendKey(
                key: key,
                metaKey: metaKey,
                ctrlKey: ctrlKey,
                altKey: altKey,
                shiftKey: shiftKey
            )
            return ["status": "key sent"]

        case ("GET", "/frame"):
            guard let frameData = service.getCurrentFrame() else {
                return ["frame": ""]
            }
            return ["frame": frameData.base64EncodedString()]

        default:
            throw WebRTCError.invalidConfiguration
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
            let offer = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<
                RTCSessionDescription,
                Error
            >) in
                peerConnection.offer(for: constraints) { offer, error in
                    if let error {
                        continuation.resume(throwing: error)
                    } else if let offer {
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
                    if let error {
                        continuation.resume(throwing: error)
                    } else {
                        continuation.resume()
                    }
                }
            }

            // Send offer through signaling
            let message = ControlProtocol.screencapOfferEvent(
                sdp: modifiedOffer.sdp,
                sessionId: activeSessionId
            )
            if let messageData = try? ControlProtocol.encode(message) {
                await sendControlMessage(messageData)
            }

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

    /// Send control protocol message
    func sendControlMessage(_ data: Data) async {
        logger.info("📤 Sending control message...")

        do {
            guard let socket = unixSocket else {
                logger.error("❌ Cannot send message - UNIX socket is nil")
                return
            }

            try await socket.sendRawData(data)
            logger.info("✅ Control message sent via shared socket")
        } catch {
            logger.error("Failed to send control message: \(error)")
        }
    }

    /// Deprecated - use sendControlMessage instead
    @available(*, deprecated, message: "Use sendControlMessage with ControlProtocol instead")
    func sendSignalMessage(_ message: [String: Any]) async {
        logger.info("📤 Sending signal message...")
        logger.info("  📋 Message type: \(message["type"] as? String ?? "unknown")")

        guard let socket = unixSocket else {
            logger.error("❌ Cannot send message - UNIX socket is nil")
            return
        }

        // IMPORTANT: Await the async sendMessage to ensure proper sequencing
        await socket.sendMessage(message)
        logger.info("✅ Message sent via UNIX socket")
    }

    private func addBandwidthToSdp(_ sdp: String) -> String {
        let lines = sdp.components(separatedBy: "\n")
        var modifiedLines: [String] = []
        var inVideoSection = false
        var h264PayloadTypes: [String] = []
        var vp8PayloadTypes: [String] = []
        var otherPayloadTypes: [String] = []

        for line in lines {
            var modifiedLine = line

            // Check if we're entering video m-line
            if line.starts(with: "m=video") {
                inVideoSection = true

                // Extract existing payload types
                let components = line.components(separatedBy: " ")
                if components.count > 3 {
                    let existingPayloadTypes = Array(components[3...])

                    // Find H.264 and VP8 payload types from the rtpmap lines we've seen
                    var reorderedPayloadTypes: [String] = []

                    // Add H.264 first
                    for pt in h264PayloadTypes where existingPayloadTypes.contains(pt) {
                        reorderedPayloadTypes.append(pt)
                    }

                    // Then VP8
                    for pt in vp8PayloadTypes {
                        if existingPayloadTypes.contains(pt) && !reorderedPayloadTypes.contains(pt) {
                            reorderedPayloadTypes.append(pt)
                        }
                    }

                    // Then others
                    for pt in existingPayloadTypes where !reorderedPayloadTypes.contains(pt) {
                        reorderedPayloadTypes.append(pt)
                    }

                    // Reconstruct the m=video line with reordered codecs
                    if !reorderedPayloadTypes.isEmpty {
                        modifiedLine = components[0...2].joined(separator: " ") + " " + reorderedPayloadTypes
                            .joined(separator: " ")
                        logger.info("📝 Reordered video codecs: H.264 first, VP8 second")
                    }
                }
            } else if line.starts(with: "m=") {
                inVideoSection = false
            }

            // Look for codecs in rtpmap before processing m=video line
            if line.contains("rtpmap") {
                let components = line.components(separatedBy: " ")
                guard !components.isEmpty else { continue }
                let payloadType = components[0]
                    .replacingOccurrences(of: "a=rtpmap:", with: "")

                if line.uppercased().contains("H264/90000") {
                    h264PayloadTypes.append(payloadType)
                    logger.info("🎥 Found H.264 codec with payload type: \(payloadType)")
                } else if line.uppercased().contains("VP8/90000") {
                    vp8PayloadTypes.append(payloadType)
                    logger.info("🎥 Found VP8 codec with payload type: \(payloadType)")
                } else if inVideoSection {
                    otherPayloadTypes.append(payloadType)
                }
            }

            modifiedLines.append(modifiedLine)

            // Add bandwidth constraint after video m-line
            if inVideoSection && line.starts(with: "m=video") {
                let bitrate = currentBitrate / 1_000 // Convert to kbps for SDP
                modifiedLines.append("b=AS:\(bitrate)")
                logger.info("📈 Added bandwidth constraint to SDP: \(bitrate / 1_000) Mbps (adaptive) for 4K@60fps")
            }
        }

        // Log codec detection results
        logger
            .info(
                "📊 SDP Codec Analysis - H.264: \(h264PayloadTypes.count), VP8: \(vp8PayloadTypes.count), Others: \(otherPayloadTypes.count)"
            )

        return modifiedLines.joined(separator: "\n")
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
            logger.info("Should negotiate - creating and sending offer")
            await createAndSendOffer()
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
            let message = ControlProtocol.screencapIceCandidateEvent(
                candidate: candidateSdp,
                sdpMLineIndex: sdpMLineIndex,
                sdpMid: sdpMid,
                sessionId: activeSessionId
            )
            if let messageData = try? ControlProtocol.encode(message) {
                await sendControlMessage(messageData)
            }
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

            // Start adaptive bitrate monitoring when connected
            if connectionState == .connected {
                startStatsMonitoring()
            } else if connectionState == .disconnected || connectionState == .failed {
                stopStatsMonitoring()
            }
        }
    }
}

// MARK: - Adaptive Bitrate Control

extension WebRTCManager {
    /// Start monitoring connection stats for adaptive bitrate
    private func startStatsMonitoring() {
        stopStatsMonitoring() // Ensure no duplicate timers

        statsTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                await self?.updateConnectionStats()
            }
        }

        logger.info("📊 Started adaptive bitrate monitoring")
    }

    /// Stop monitoring connection stats
    private func stopStatsMonitoring() {
        statsTimer?.invalidate()
        statsTimer = nil
        logger.info("📊 Stopped adaptive bitrate monitoring")
    }

    /// Update connection stats and adjust bitrate if needed
    private func updateConnectionStats() async {
        guard let peerConnection else { return }

        let stats = await peerConnection.statistics()

        // Process stats to find outbound RTP stats
        var currentPacketLoss: Double = 0.0
        var currentRtt: Double = 0.0
        var bytesSent: Int64 = 0

        // Find the outbound-rtp report for video
        for report in stats.statistics.values {
            if report.type == "outbound-rtp", report.values["mediaType"] as? String == "video" {
                bytesSent = report.values["bytesSent"] as? Int64 ?? 0

                // Find the corresponding remote-inbound-rtp report for packet loss and RTT
                if let remoteId = report.values["remoteId"] as? String,
                   let remoteReport = stats.statistics[remoteId],
                   remoteReport.type == "remote-inbound-rtp"
                {
                    currentPacketLoss = remoteReport.values["fractionLost"] as? Double ?? 0
                    currentRtt = remoteReport.values["roundTripTime"] as? Double ?? 0
                }
                break // Found the main video stream report
            }
        }

        // Adjust bitrate based on network conditions
        adjustBitrate(packetLoss: currentPacketLoss, rtt: currentRtt)

        // Log stats periodically
        if Int.random(in: 0..<5) == 0 { // Log every ~10 seconds
            logger.info("""
                📊 Network stats:
                - Packet loss: \(String(format: "%.2f%%", currentPacketLoss * 100))
                - RTT: \(String(format: "%.0f ms", currentRtt * 1_000))
                - Current bitrate: \(self.currentBitrate / 1_000_000) Mbps
                - Bytes sent: \(bytesSent / 1_024 / 1_024) MB
            """)
        }

        lastPacketLoss = currentPacketLoss
        lastRtt = currentRtt
    }

    /// Adjust bitrate based on network conditions
    private func adjustBitrate(packetLoss: Double, rtt: Double) {
        // Determine if we need to adjust bitrate
        var adjustment: Double = 1.0

        // High packet loss (> 2%) - reduce bitrate
        if packetLoss > 0.02 {
            adjustment = 0.8 // Reduce by 20%
            logger.warning("📉 High packet loss (\(String(format: "%.2f%%", packetLoss * 100))), reducing bitrate")
        }
        // Medium packet loss (1-2%) - slightly reduce
        else if packetLoss > 0.01 {
            adjustment = 0.95 // Reduce by 5%
        }
        // High RTT (> 150ms) - reduce bitrate
        else if rtt > 0.15 {
            adjustment = 0.9 // Reduce by 10%
            logger.warning("📉 High RTT (\(String(format: "%.0f ms", rtt * 1_000))), reducing bitrate")
        }
        // Good conditions - try to increase
        else if packetLoss < 0.005 && rtt < 0.05 {
            adjustment = 1.1 // Increase by 10%
        }

        // Calculate new target bitrate
        let newBitrate = Int(Double(currentBitrate) * adjustment)
        targetBitrate = max(minBitrate, min(maxBitrate, newBitrate))

        // Apply bitrate change if significant (> 5% change)
        if abs(Float(targetBitrate - currentBitrate)) > Float(currentBitrate) * 0.05 {
            applyBitrateChange(targetBitrate)
        }
    }

    /// Apply bitrate change to the video encoder
    private func applyBitrateChange(_ newBitrate: Int) {
        guard let peerConnection,
              let sender = peerConnection.transceivers.first(where: { $0.mediaType == .video })?.sender
        else {
            return
        }

        // Update encoder parameters
        let parameters = sender.parameters
        for encoding in parameters.encodings {
            encoding.maxBitrateBps = NSNumber(value: newBitrate)
        }

        sender.parameters = parameters

        currentBitrate = newBitrate
        logger.info("🎯 Adjusted video bitrate to \(newBitrate / 1_000_000) Mbps")
    }
}

// MARK: - Network Extension

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
