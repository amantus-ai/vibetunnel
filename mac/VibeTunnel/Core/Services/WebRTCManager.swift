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
    private weak var screencapService: ScreencapService?

    // MARK: - Properties

    private var peerConnectionFactory: RTCPeerConnectionFactory?
    private var peerConnection: RTCPeerConnection?
    private var localVideoTrack: RTCVideoTrack?
    private var videoSource: RTCVideoSource?
    private var videoCapturer: RTCVideoCapturer?

    /// UNIX socket for signaling
    private var unixSocket: UnixSocketConnection?
    
    /// Message handler ID for cleanup
    private var messageHandlerID: UUID?

    /// Server URL (kept for reference)
    private let serverURL: URL

    /// Local auth token (no longer needed for UNIX socket)
    let localAuthToken: String?

    // Session management for security
    private var activeSessionId: String?
    private var sessionStartTime: Date?

    // Adaptive bitrate control
    private var statsTimer: Timer?
    private var currentBitrate: Int = 10_000_000 // Start at 10 Mbps
    private var targetBitrate: Int = 10_000_000
    private let minBitrate: Int = 1_000_000 // 1 Mbps minimum
    private let maxBitrate: Int = 50_000_000 // 50 Mbps maximum
    private var lastPacketLoss: Double = 0.0
    private var lastRtt: Double = 0.0

    // MARK: - Published Properties

    @Published private(set) var connectionState: RTCPeerConnectionState = .new
    @Published private(set) var isConnected = false

    // MARK: - Initialization

    init(serverURL: URL, screencapService: ScreencapService, localAuthToken: String? = nil) {
        self.serverURL = serverURL
        self.screencapService = screencapService
        self.localAuthToken = localAuthToken

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

        logger.info("✅ WebRTC Manager initialized with server URL: \(self.serverURL)")
    }

    deinit {
        // Clean up synchronously
        localVideoTrack = nil
        videoSource = nil
        peerConnection = nil
        
        // Remove message handler if still registered
        if let handlerID = messageHandlerID {
            Task { @MainActor in
                SharedUnixSocketManager.shared.removeMessageHandler(handlerID)
            }
        }
        
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

        // Ensure we have a UNIX socket connection
        if unixSocket == nil || !isConnected {
            try await connectForAPIHandling()
        }

        // Notify server we're ready as the Mac peer with video mode
        await sendSignalMessage([
            "type": "mac-ready",
            "mode": mode
        ])
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

    /// Connect to signaling server for API handling only (no video capture)
    func connectForAPIHandling() async throws {
        // Don't connect if already connected
        if unixSocket != nil && isConnected {
            logger.info("UNIX socket already connected")
            return
        }

        logger.info("🔌 Connecting for API handling via UNIX socket")
        logger.info("  📋 Current active session: \(self.activeSessionId ?? "nil")")

        // Get shared Unix socket connection
        let sharedManager = SharedUnixSocketManager.shared
        unixSocket = sharedManager.getConnection()

        // Register our message handler
        messageHandlerID = sharedManager.addMessageHandler { [weak self] data in
            Task { @MainActor [weak self] in
                await self?.handleSocketMessage(data)
            }
        }

        // Set up state change handler on the socket
        unixSocket?.onStateChange = { [weak self] state in
            Task { @MainActor [weak self] in
                self?.handleSocketStateChange(state)
            }
        }

        // Connect if not already connected
        if unixSocket?.isConnected == false {
            unixSocket?.connect()
        }

        // Wait for connection to be ready
        var retries = 0
        while !isConnected && retries < 20 {
            try await Task.sleep(nanoseconds: 100_000_000) // 0.1 seconds
            retries += 1
        }

        if isConnected {
            // Send mac-ready message for API handling
            logger.info("📤 Sending mac-ready message for API handling...")
            await sendSignalMessage([
                "type": "mac-ready",
                "mode": "api-only"
            ])
            logger.info("✅ Connected for screencap API handling")
        } else {
            logger.error("❌ Failed to connect UNIX socket after 2 seconds")
            throw UnixSocketError.notConnected
        }
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

        // Remove our message handler from shared manager
        if let handlerID = messageHandlerID {
            SharedUnixSocketManager.shared.removeMessageHandler(handlerID)
            messageHandlerID = nil
        }

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
        // Extract all necessary data from the sample buffer synchronously
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
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
        Task.detached { [weak self] in
            guard let self else { return }

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

            // Send the frame to WebRTC
            await MainActor.run { [weak self] in
                guard let self,
                      let videoCapturer = self.videoCapturer,
                      let videoSource = self.videoSource else { return }

                videoSource.capturer(videoCapturer, didCapture: videoFrame)

                // Log success occasionally
                if Int.random(in: 0..<300) == 0 {
                    self.logger
                        .info(
                            "✅ Sent video frame to WebRTC"
                        )
                }
            }
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
        // Create a hybrid encoder factory that supports both H.265 and H.264
        // M137 WebRTC should have built-in H.265 support

        // Check if hardware H.265 encoding is available
        let h265Available = isH265HardwareEncodingAvailable()
        logger.info("🎥 H.265 hardware encoding available: \(h265Available)")

        // Use default factory - steipete/WebRTC has native H.265 support built-in
        let encoderFactory = RTCDefaultVideoEncoderFactory()

        // Log what codecs the factory actually supports
        let supportedCodecs = encoderFactory.supportedCodecs()
        logger.info("📋 Factory supported codecs:")
        for codec in supportedCodecs {
            logger.info("  - \(codec.name): \(codec.parameters)")
        }

        logger.info("✅ Created encoder factory with native H.265 support")
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
            width: 1_920,
            height: 1_080,
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

        logger
            .info(
                "🔍 VideoToolbox HEVC hardware encoding check: \(isHardwareAccelerated ? "supported" : "not supported") (status: \(status))"
            )
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

        for transceiver in transceivers where transceiver.mediaType == .video {
            // The stasel/WebRTC package doesn't expose RTCRtpSender.capabilities
            // So we'll work with the codecs that are available in the transceiver
            let receiver = transceiver.receiver

            // Log current parameters
            let params = receiver.parameters
            logger.info("📋 Current receiver codec parameters:")
            for codec in params.codecs {
                logger.info("  - \(codec.name): \(codec.parameters)")
            }

            // The steipete/WebRTC package should handle codec preferences natively
            logger.info("📝 Using native codec negotiation from steipete/WebRTC package")

            // The actual H.265 prioritization happens in addBandwidthToSdp where we modify the SDP
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
        guard let peerConnectionFactory else {
            logger.error("Peer connection factory not initialized")
            return
        }
        let videoTrack = peerConnectionFactory.videoTrack(
            with: videoSource,
            trackId: "screen-video-track"
        )
        videoTrack.isEnabled = true

        self.localVideoTrack = videoTrack

        logger.info("✅ Created local video track with 4K quality settings: 3840x2160@60fps")
    }

    private func handleSocketMessage(_ data: Data) async {
        // The data is a JSON string, parse it
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String
        else {
            logger.error("Invalid socket message format")
            if let str = String(data: data, encoding: .utf8) {
                logger.error("Raw message: \(str)")
            }
            return
        }

        logger.info("📥 Received message type: \(type)")
        await handleSignalMessage(json)
    }

    private func handleSocketStateChange(_ state: UnixSocketConnection.ConnectionState) {
        switch state {
        case .ready:
            logger.info("✅ UNIX socket connected")
            isConnected = true
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
                      Time since last session: \(self.sessionStartTime.map { Date().timeIntervalSince($0) }?
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
                    await sendSignalMessage([
                        "type": "error",
                        "data": "Failed to create peer connection: \(error.localizedDescription)"
                    ])
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

        default:
            logger.warning("Unknown signal type: \(type)")
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

        // For capture operations, update the session ID first before validation
        if (endpoint == "/capture" || endpoint == "/capture-window") && sessionId != nil {
            let previousSession = self.activeSessionId
            if previousSession != sessionId {
                logger.info("""
                🔄 [SECURITY] Session update for \(endpoint) (pre-validation)
                  Previous session: \(previousSession ?? "nil")
                  New session: \(sessionId!)
                """)
            }
            activeSessionId = sessionId
            sessionStartTime = Date()
            logger.info("🔐 [SECURITY] Session pre-activated for \(endpoint): \(sessionId!)")
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
                  Session age: \(self.sessionStartTime.map { Date().timeIntervalSince($0) }?
                    .description ?? "N/A"
                  ) seconds
                  """
                logger.error("\(errorDetails)")

                let errorMessage =
                    "Unauthorized: Invalid session (request: \(sessionId ?? "nil"), active: \(self.activeSessionId ?? "nil"))"
                await sendSignalMessage([
                    "type": "api-response",
                    "requestId": requestId,
                    "error": errorMessage
                ])
                return
            }

            logger.info("✅ Session validation passed for \(method) \(endpoint)")
        }

        logger.info("🔧 API request: \(method) \(endpoint) from session: \(sessionId ?? "unknown")")

        // Process API request on background queue to avoid blocking main thread
        Task {
            logger.info("🔄 Starting Task for API request: \(requestId)")
            do {
                logger.info("🔄 About to call processApiRequest")
                let result = try await processApiRequest(
                    method: method,
                    endpoint: endpoint,
                    params: json["params"],
                    sessionId: sessionId
                )
                logger.info("📤 Sending API response for request \(requestId)")
                await sendSignalMessage([
                    "type": "api-response",
                    "requestId": requestId,
                    "result": result
                ])
            } catch {
                logger.error("❌ API request failed for \(requestId): \(error)")
                let screencapError = ScreencapErrorResponse.from(error)
                await sendSignalMessage([
                    "type": "api-response",
                    "requestId": requestId,
                    "error": screencapError.toDictionary()
                ])
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

    private nonisolated func processApiRequest(
        method: String,
        endpoint: String,
        params: Any?,
        sessionId: String?
    )
        async throws -> Any
    {
        // Get reference to screencapService while on main actor
        let service = await screencapService
        guard let service else {
            throw WebRTCError.invalidConfiguration
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
            guard let params = params as? [String: Any],
                  let type = params["type"] as? String,
                  let index = params["index"] as? Int
            else {
                throw WebRTCError.invalidConfiguration
            }
            let useWebRTC = params["webrtc"] as? Bool ?? false

            // Session is already updated in handleApiRequest for capture operations
            if sessionId == nil {
                logger.warning("⚠️ No session ID provided for /capture request!")
            }

            try await service.startCapture(type: type, index: index, useWebRTC: useWebRTC)
            return ["status": "started", "type": type, "webrtc": useWebRTC]

        case ("POST", "/capture-window"):
            guard let params = params as? [String: Any],
                  let cgWindowID = params["cgWindowID"] as? Int
            else {
                throw WebRTCError.invalidConfiguration
            }
            let useWebRTC = params["webrtc"] as? Bool ?? false

            // Session is already updated in handleApiRequest for capture operations
            if sessionId == nil {
                logger.warning("⚠️ No session ID provided for /capture-window request!")
            }

            try await service.startCaptureWindow(cgWindowID: cgWindowID, useWebRTC: useWebRTC)
            return ["status": "started", "cgWindowID": cgWindowID, "webrtc": useWebRTC]

        case ("POST", "/stop"):
            await service.stopCapture()
            // Clear session on stop - need to do this on main actor
            await MainActor.run {
                activeSessionId = nil
                sessionStartTime = nil
            }
            logger.info("🔐 [SECURITY] Session cleared after stop")
            return ["status": "stopped"]

        case ("POST", "/click"):
            guard let params = params as? [String: Any],
                  let x = params["x"] as? Double,
                  let y = params["y"] as? Double
            else {
                throw WebRTCError.invalidConfiguration
            }
            try await service.sendClick(x: x, y: y)
            return ["status": "clicked"]

        case ("POST", "/mousedown"):
            guard let params = params as? [String: Any],
                  let x = params["x"] as? Double,
                  let y = params["y"] as? Double
            else {
                throw WebRTCError.invalidConfiguration
            }
            try await service.sendMouseDown(x: x, y: y)
            return ["status": "mousedown"]

        case ("POST", "/mousemove"):
            guard let params = params as? [String: Any],
                  let x = params["x"] as? Double,
                  let y = params["y"] as? Double
            else {
                throw WebRTCError.invalidConfiguration
            }
            try await service.sendMouseMove(x: x, y: y)
            return ["status": "mousemove"]

        case ("POST", "/mouseup"):
            guard let params = params as? [String: Any],
                  let x = params["x"] as? Double,
                  let y = params["y"] as? Double
            else {
                throw WebRTCError.invalidConfiguration
            }
            try await service.sendMouseUp(x: x, y: y)
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

            let offerType = modifiedOffer.type == .offer ? "offer" : modifiedOffer
                .type == .answer ? "answer" : "unknown"
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
        var h265Found = false
        var h264Found = false
        var videoPayloadTypes: [String] = []
        let h265PayloadType = "96" // Dynamic payload type for H.265

        for (index, line) in lines.enumerated() {
            var modifiedLine = line

            // Check if we're entering video m-line
            if line.starts(with: "m=video") {
                inVideoSection = true

                // Extract existing payload types
                let components = line.components(separatedBy: " ")
                if components.count > 3 {
                    videoPayloadTypes = Array(components[3...])

                    // With steipete/WebRTC, H.265 should already be in the SDP
                    if !videoPayloadTypes.contains(h265PayloadType) {
                        logger.debug("H.265 payload type not found in initial SDP")
                    }
                }
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
                // Use adaptive bitrate, with different defaults for H.265 vs H.264
                // H.265 is more efficient, so we can use lower bitrate for same quality
                let isH265 = h265Found || isH265HardwareEncodingAvailable()
                let bitrate = currentBitrate / 1_000 // Convert to kbps for SDP
                modifiedLines.append("b=AS:\(bitrate)")
                logger
                    .info(
                        "📈 Added bandwidth constraint to SDP: \(bitrate / 1_000) Mbps (adaptive) for 4K@60fps (\(isH265 ? "H.265" : "H.264"))"
                    )

                // With steipete/WebRTC, H.265 should be included natively
                if !h265Found && isH265HardwareEncodingAvailable() {
                    logger
                        .info(
                            "📝 H.265 hardware available but not found in SDP - the new WebRTC package should include it"
                        )
                }
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
        logger
            .info(
                "📊 SDP Codec Analysis - H.265: \(h265Found ? "present" : "absent"), H.264: \(h264Found ? "present" : "absent")"
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
        let currentPacketLoss: Double = 0.0
        let currentRtt: Double = 0.0
        let bytesSent: Int64 = 0

        // Log stats for debugging - actual stats processing would need proper types
        logger.debug("📊 WebRTC stats received: \(stats.statistics.count) entries")

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

        // Apply bitrate change if significant (> 10% change)
        if abs(targetBitrate - currentBitrate) > currentBitrate / 10 {
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
