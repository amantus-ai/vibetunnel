import AppKit
import CoreGraphics
import CoreImage
@preconcurrency import CoreMedia
import Foundation
import OSLog
@preconcurrency import ScreenCaptureKit
import VideoToolbox

/// Service that provides screen capture functionality with HTTP API
@preconcurrency
@MainActor
public final class ScreencapService: NSObject {
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "ScreencapService")

    // MARK: - Singleton

    static let shared = ScreencapService()
    
    // MARK: - WebSocket Connection State
    
    private var isWebSocketConnecting = false
    private var isWebSocketConnected = false
    private var webSocketConnectionContinuations: [CheckedContinuation<Void, Error>] = []

    // MARK: - Properties

    private var captureStream: SCStream?
    private var captureFilter: SCContentFilter?
    private var isCapturing = false
    private var captureMode: CaptureMode = .desktop(displayIndex: 0)
    private var selectedWindow: SCWindow?
    private var currentDisplayIndex: Int = 0
    private var currentFrame: CGImage?
    private let frameQueue = DispatchQueue(label: "sh.vibetunnel.screencap.frame", qos: .userInitiated)
    private let sampleHandlerQueue = DispatchQueue(label: "sh.vibetunnel.screencap.sampleHandler", qos: .userInitiated)
    private var frameCounter: Int = 0

    // WebRTC support
    // These properties need to be nonisolated so they can be accessed from the stream output handler
    private nonisolated(unsafe) var webRTCManager: WebRTCManager?
    private nonisolated(unsafe) var useWebRTC = false
    private var decompressionSession: VTDecompressionSession?

    // MARK: - Types
    
    enum ScreencapError: LocalizedError {
        case invalidServerURL
        case webSocketNotConnected
        case windowNotFound(Int)
        case noDisplay
        case notCapturing
        case failedToStartCapture(Error)
        case failedToCreateEvent
        case invalidCoordinates(x: Double, y: Double)
        case invalidKeyInput(String)
        case failedToGetContent(Error)
        case invalidWindowIndex
        case invalidApplicationIndex
        case invalidCaptureType
        case invalidConfiguration
        
        var errorDescription: String? {
            switch self {
            case .invalidServerURL:
                return "Invalid server URL for WebSocket connection"
            case .webSocketNotConnected:
                return "WebSocket connection not established"
            case .windowNotFound(let id):
                return "Window with ID \(id) not found"
            case .noDisplay:
                return "No display available"
            case .notCapturing:
                return "Screen capture is not active"
            case .failedToStartCapture(let error):
                return "Failed to start capture: \(error.localizedDescription)"
            case .failedToCreateEvent:
                return "Failed to create system event"
            case .invalidCoordinates(let x, let y):
                return "Invalid coordinates: (\(x), \(y))"
            case .invalidKeyInput(let key):
                return "Invalid key input: \(key)"
            case .failedToGetContent(let error):
                return "Failed to get shareable content: \(error.localizedDescription)"
            case .invalidWindowIndex:
                return "Invalid window index"
            case .invalidApplicationIndex:
                return "Invalid application index"
            case .invalidCaptureType:
                return "Invalid capture type"
            case .invalidConfiguration:
                return "Invalid capture configuration"
            }
        }
    }

    enum CaptureMode {
        case desktop(displayIndex: Int = 0)
        case allDisplays
        case window(SCWindow)
        case application(SCRunningApplication)
    }

    struct DisplayInfo: Codable {
        let id: String
        let width: Int
        let height: Int
        let scaleFactor: Double
        let refreshRate: Double
        let x: Double
        let y: Double
        let name: String?
    }

    struct WindowInfo: Codable {
        let cgWindowID: Int
        let title: String?
        let ownerName: String?
        let ownerPID: Int32
        let x: Double
        let y: Double
        let width: Double
        let height: Double
        let isOnScreen: Bool
    }

    // MARK: - Initialization

    override init() {
        super.init()
        // Connect to WebSocket for API handling when service is created
        Task {
            await setupWebSocketForAPIHandling()
        }
    }

    /// Setup WebSocket connection for handling API requests
    private func setupWebSocketForAPIHandling() async {
        // Check if already connected or connecting
        if isWebSocketConnected {
            logger.debug("WebSocket already connected")
            return
        }
        
        if isWebSocketConnecting {
            logger.debug("WebSocket connection already in progress, waiting...")
            // Wait for existing connection attempt
            try? await withCheckedThrowingContinuation { continuation in
                webSocketConnectionContinuations.append(continuation)
            }
            return
        }
        
        isWebSocketConnecting = true
        
        // Get server URL from environment or use default
        let serverURLString = ProcessInfo.processInfo
            .environment["VIBETUNNEL_SERVER_URL"] ?? "http://localhost:4020"
        guard let serverURL = URL(string: serverURLString) else {
            logger.error("Invalid server URL: \(serverURLString)")
            isWebSocketConnecting = false
            // Fail all waiting continuations
            for continuation in webSocketConnectionContinuations {
                continuation.resume(throwing: ScreencapError.invalidServerURL)
            }
            webSocketConnectionContinuations.removeAll()
            return
        }

        // Create WebRTC manager which handles WebSocket API requests
        if webRTCManager == nil {
            webRTCManager = WebRTCManager(serverURL: serverURL, screencapService: self)
        }

        // Connect to signaling server for API handling
        // This allows the browser to make API requests immediately
        do {
            try await webRTCManager?.connectForAPIHandling()
            logger.info("✅ Connected to WebSocket for screencap API handling")
            isWebSocketConnected = true
            isWebSocketConnecting = false
            
            // Resume all waiting continuations
            for continuation in webSocketConnectionContinuations {
                continuation.resume()
            }
            webSocketConnectionContinuations.removeAll()
        } catch {
            logger.error("Failed to connect WebSocket for API: \(error)")
            isWebSocketConnecting = false
            isWebSocketConnected = false
            
            // Fail all waiting continuations
            for continuation in webSocketConnectionContinuations {
                continuation.resume(throwing: error)
            }
            webSocketConnectionContinuations.removeAll()
        }
    }

    // MARK: - Public Methods
    
    /// Ensure WebSocket connection is established
    public func ensureWebSocketConnected() async throws {
        if !isWebSocketConnected && !isWebSocketConnecting {
            await setupWebSocketForAPIHandling()
        }
        
        // Wait for connection if still connecting
        if isWebSocketConnecting {
            try await withCheckedThrowingContinuation { continuation in
                webSocketConnectionContinuations.append(continuation)
            }
        }
        
        guard isWebSocketConnected else {
            throw ScreencapError.webSocketNotConnected
        }
    }

    /// Get all available displays
    func getDisplays() async throws -> [DisplayInfo] {
        // Use SCShareableContent to ensure consistency with capture
        let content = try await SCShareableContent.excludingDesktopWindows(
            false,
            onScreenWindowsOnly: false
        )

        guard !content.displays.isEmpty else {
            throw ScreencapError.noDisplay
        }

        logger.info("📺 Found \(content.displays.count) displays")

        var displayInfos: [DisplayInfo] = []

        for (index, display) in content.displays.enumerated() {
            // Try to find corresponding NSScreen for additional info
            let nsScreen = NSScreen.screens.first { screen in
                // Match by frame - SCDisplay and NSScreen should have the same frame
                let xMatch = abs(screen.frame.origin.x - display.frame.origin.x) < 1.0
                let yMatch = abs(screen.frame.origin.y - display.frame.origin.y) < 1.0
                let widthMatch = abs(screen.frame.width - display.frame.width) < 1.0
                let heightMatch = abs(screen.frame.height - display.frame.height) < 1.0
                return xMatch && yMatch && widthMatch && heightMatch
            }

            let name = nsScreen?.localizedName ?? "Display \(index + 1)"
            logger.debug("Display \(index): '\(name)' - size: \(display.width)x\(display.height)")

            let displayInfo = DisplayInfo(
                id: "\(index)",
                width: Int(display.width),
                height: Int(display.height),
                scaleFactor: Double(nsScreen?.backingScaleFactor ?? 2.0),
                refreshRate: Double(nsScreen?.maximumFramesPerSecond ?? 60),
                x: display.frame.origin.x,
                y: display.frame.origin.y,
                name: name
            )

            displayInfos.append(displayInfo)
        }

        return displayInfos
    }

    /// Get current display information (for backward compatibility)
    func getDisplayInfo() async throws -> DisplayInfo {
        let displays = try await getDisplays()
        guard let mainDisplay = displays.first else {
            throw ScreencapError.noDisplay
        }
        return mainDisplay
    }

    /// Get list of available windows
    func getWindows() async throws -> [WindowInfo] {
        let content = try await SCShareableContent.excludingDesktopWindows(
            false,
            onScreenWindowsOnly: false
        )

        // Filter windows that are actually visible and belong to a screen
        return content.windows.compactMap { window in
            let cgWindowID = window.windowID

            // Skip windows that are not on screen
            guard window.isOnScreen else { return nil }

            // Skip windows with zero size
            guard window.frame.width > 0 && window.frame.height > 0 else { return nil }

            // Skip windows from VibeTunnel itself to avoid confusion
            if let appName = window.owningApplication?.applicationName,
               appName.lowercased().contains("vibetunnel")
            {
                return nil
            }

            return WindowInfo(
                cgWindowID: Int(cgWindowID),
                title: window.title,
                ownerName: window.owningApplication?.applicationName,
                ownerPID: window.owningApplication?.processID ?? 0,
                x: window.frame.origin.x,
                y: window.frame.origin.y,
                width: window.frame.width,
                height: window.frame.height,
                isOnScreen: window.isOnScreen
            )
        }
    }

    /// Start capture with specified mode
    func startCapture(type: String, index: Int, useWebRTC: Bool = false) async throws {
        logger.info("Starting capture - type: \(type), index: \(index), WebRTC: \(useWebRTC)")

        self.useWebRTC = useWebRTC

        // Stop any existing capture
        await stopCapture()

        logger.debug("Requesting shareable content...")
        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(
                false,
                onScreenWindowsOnly: false
            )
            logger
                .info(
                    "Got shareable content - displays: \(content.displays.count), windows: \(content.windows.count), apps: \(content.applications.count)"
                )
        } catch {
            logger.error("Failed to get shareable content: \(error)")
            throw ScreencapError.failedToGetContent(error)
        }

        // Determine capture mode
        switch type {
        case "desktop":
            // Check if index is -1 which means all displays
            if index == -1 {
                // Capture all displays
                guard let primaryDisplay = content.displays.first else {
                    throw ScreencapError.noDisplay
                }

                captureMode = .allDisplays
                currentDisplayIndex = -1

                logger.info("🖥️ Setting up all displays capture mode")
                logger.info("  Primary display: size=\(primaryDisplay.width)x\(primaryDisplay.height)")
                logger.info("  Total displays: \(content.displays.count)")

                // For all displays, capture everything including menu bar
                logger.info("🔍 Creating content filter for all displays including menu bar")

                // Create filter that includes all applications - this is required for proper capture
                captureFilter = SCContentFilter(
                    display: primaryDisplay,
                    including: content.applications, // Include all applications for all displays capture
                    exceptingWindows: []
                )

                logger.info("✅ Created content filter for all displays capture including system UI")
            } else {
                // Single display capture
                let displayIndex = index < content.displays.count ? index : 0
                guard displayIndex < content.displays.count else {
                    throw ScreencapError.noDisplay
                }
                let display = content.displays[displayIndex]
                captureMode = .desktop(displayIndex: displayIndex)
                currentDisplayIndex = displayIndex

                // Log display selection for debugging
                logger
                    .info(
                        "📺 Capturing display \(displayIndex) of \(content.displays.count) - size: \(display.width)x\(display.height)"
                    )

                // Create filter to capture entire display including menu bar
                // Include all applications to ensure proper desktop capture
                captureFilter = SCContentFilter(
                    display: display,
                    including: content.applications, // Include all applications for desktop capture
                    exceptingWindows: []
                )
            }

        case "window":
            guard index < content.windows.count else {
                throw ScreencapError.invalidWindowIndex
            }
            let window = content.windows[index]
            selectedWindow = window
            captureMode = .window(window)

            logger
                .info(
                    "🪟 Capturing window: '\(window.title ?? "Untitled")' - size: \(window.frame.width)x\(window.frame.height)"
                )

            // For window capture, we need to find which display contains this window
            let windowDisplay = content.displays.first { display in
                // Check if window's frame intersects with display's frame
                display.frame.intersects(window.frame)
            } ?? content.displays.first

            guard windowDisplay != nil else {
                throw ScreencapError.noDisplay
            }

            // Create filter for single window - use a simpler approach
            logger.info("📱 Creating filter for window on display")

            // Create a filter with just the single window
            captureFilter = SCContentFilter(
                desktopIndependentWindow: window
            )

        case "application":
            guard index < content.applications.count else {
                throw ScreencapError.invalidApplicationIndex
            }
            let app = content.applications[index]
            captureMode = .application(app)

            // Get all windows for this application
            let appWindows = content.windows.filter { window in
                window.owningApplication?.processID == app.processID
            }

            guard let display = content.displays.first else {
                throw ScreencapError.noDisplay
            }
            captureFilter = SCContentFilter(
                display: display,
                including: appWindows
            )

        default:
            throw ScreencapError.invalidCaptureType
        }

        // Configure stream
        guard let filter = captureFilter else {
            logger.error("Capture filter is nil")
            throw ScreencapError.invalidConfiguration
        }

        let streamConfig = SCStreamConfiguration()

        // For all displays mode, calculate the combined dimensions
        if case .allDisplays = captureMode {
            // Calculate the bounding rectangle that encompasses all displays
            var minX = CGFloat.greatestFiniteMagnitude
            var minY = CGFloat.greatestFiniteMagnitude
            var maxX: CGFloat = -CGFloat.greatestFiniteMagnitude
            var maxY: CGFloat = -CGFloat.greatestFiniteMagnitude

            logger.info("🖥️ Calculating bounds for \(content.displays.count) displays:")
            for (index, display) in content.displays.enumerated() {
                logger
                    .info(
                        "  Display \(index): origin=(\(display.frame.origin.x), \(display.frame.origin.y)), size=\(display.frame.width)x\(display.frame.height)"
                    )
                minX = min(minX, display.frame.origin.x)
                minY = min(minY, display.frame.origin.y)
                maxX = max(maxX, display.frame.origin.x + display.frame.width)
                maxY = max(maxY, display.frame.origin.y + display.frame.height)
            }

            let totalWidth = maxX - minX
            let totalHeight = maxY - minY

            logger.info("📐 Combined display bounds: origin=(\(minX), \(minY)), size=\(totalWidth)x\(totalHeight)")

            streamConfig.width = Int(totalWidth)
            streamConfig.height = Int(totalHeight)

            // IMPORTANT: Set destination rect to ensure proper scaling
            streamConfig.destinationRect = CGRect(x: 0, y: 0, width: totalWidth, height: totalHeight)

            // Don't set source rect - let it capture the entire display content
            logger.info("📐 Stream config: destination rect = (0, 0, \(totalWidth), \(totalHeight))")
        } else if case .window(let window) = captureMode {
            // For window capture, use the window's bounds
            // Note: The window frame might need to be scaled for Retina displays
            let scaleFactor = NSScreen.main?.backingScaleFactor ?? 2.0
            streamConfig.width = Int(window.frame.width * scaleFactor)
            streamConfig.height = Int(window.frame.height * scaleFactor)
            logger
                .info(
                    "🪟 Window stream config - size: \(streamConfig.width)x\(streamConfig.height) (scale: \(scaleFactor))"
                )
        } else if case .desktop(let displayIndex) = captureMode {
            // For desktop capture, use the display dimensions and set proper rects
            if displayIndex >= 0 && displayIndex < content.displays.count {
                let display = content.displays[displayIndex]
                streamConfig.width = Int(display.width)
                streamConfig.height = Int(display.height)

                // Set source rect to capture the entire display including menu bar and dock
                streamConfig.sourceRect = CGRect(x: 0, y: 0, width: display.width, height: display.height)
                streamConfig.destinationRect = CGRect(x: 0, y: 0, width: display.width, height: display.height)

                let sourceRectStr = String(describing: streamConfig.sourceRect)
                let destRectStr = String(describing: streamConfig.destinationRect)
                logger
                    .info(
                        "🖥️ Desktop stream config - display: \(streamConfig.width)x\(streamConfig.height), sourceRect: \(sourceRectStr), destRect: \(destRectStr)"
                    )
            } else {
                streamConfig.width = Int(filter.contentRect.width)
                streamConfig.height = Int(filter.contentRect.height)
            }
        } else {
            streamConfig.width = Int(filter.contentRect.width)
            streamConfig.height = Int(filter.contentRect.height)
        }

        // Basic configuration
        streamConfig.minimumFrameInterval = CMTime(value: 1, timescale: 30) // 30 FPS
        streamConfig.queueDepth = 5
        streamConfig.showsCursor = true
        streamConfig.capturesAudio = false

        // CRITICAL: Set pixel format to get raw frames
        streamConfig.pixelFormat = kCVPixelFormatType_32BGRA

        // Configure scaling behavior
        if case .allDisplays = captureMode {
            // For all displays, we want to capture the full virtual desktop
            streamConfig.scalesToFit = true
            streamConfig.preservesAspectRatio = true
            logger.info("📐 All displays mode: scalesToFit=true, preservesAspectRatio=true")
        } else {
            // No scaling for single display/window
            streamConfig.scalesToFit = false
        }

        // Color space
        streamConfig.colorSpaceName = CGColorSpace.sRGB

        logger.info("Stream config - size: \(streamConfig.width)x\(streamConfig.height), fps: 30")

        // Create and start stream
        let stream = SCStream(filter: filter, configuration: streamConfig, delegate: self)
        captureStream = stream

        // Add output and start capture
        do {
            // Add output with dedicated queue for optimal performance
            try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: sampleHandlerQueue)

            // Log stream output configuration
            logger.info("Added stream output handler for type: .screen")

            try await stream.startCapture()

            isCapturing = true
            logger.info("✅ Successfully started \(type) capture")

            // Start WebRTC if enabled
            if useWebRTC {
                await startWebRTCCapture()
            }
        } catch {
            logger.error("Failed to start capture: \(error)")
            captureStream = nil
            throw ScreencapError.failedToStartCapture(error)
        }
    }

    /// Start capture for a specific window by its cgWindowID
    func startCaptureWindow(cgWindowID: Int, useWebRTC: Bool = false) async throws {
        logger.info("Starting window capture - cgWindowID: \(cgWindowID), WebRTC: \(useWebRTC)")

        self.useWebRTC = useWebRTC

        // Stop any existing capture
        await stopCapture()

        logger.debug("Requesting shareable content...")
        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(
                false,
                onScreenWindowsOnly: false
            )
            logger
                .info(
                    "Got shareable content - displays: \(content.displays.count), windows: \(content.windows.count), apps: \(content.applications.count)"
                )
        } catch {
            logger.error("Failed to get shareable content: \(error)")
            throw ScreencapError.failedToGetContent(error)
        }

        // Find the window by cgWindowID
        guard let window = content.windows.first(where: { $0.windowID == CGWindowID(cgWindowID) }) else {
            logger.error("Window with cgWindowID \(cgWindowID) not found")
            throw ScreencapError.invalidWindowIndex
        }

        selectedWindow = window
        captureMode = .window(window)

        logger
            .info(
                "🪟 Capturing window: '\(window.title ?? "Untitled")' - size: \(window.frame.width)x\(window.frame.height)"
            )

        // Create filter for single window - use a simpler approach
        logger.info("📱 Creating filter for window on display")

        // Create a filter with just the single window
        captureFilter = SCContentFilter(
            desktopIndependentWindow: window
        )

        // Configure stream
        guard let filter = captureFilter else {
            logger.error("Capture filter is nil")
            throw ScreencapError.invalidConfiguration
        }

        let streamConfig = SCStreamConfiguration()

        // For window capture, use the window's bounds
        // Note: The window frame might need to be scaled for Retina displays
        let scaleFactor = NSScreen.main?.backingScaleFactor ?? 2.0
        streamConfig.width = Int(window.frame.width * scaleFactor)
        streamConfig.height = Int(window.frame.height * scaleFactor)
        logger
            .info("🪟 Window stream config - size: \(streamConfig.width)x\(streamConfig.height) (scale: \(scaleFactor))")

        // Basic configuration
        streamConfig.minimumFrameInterval = CMTime(value: 1, timescale: 30) // 30 FPS
        streamConfig.queueDepth = 5
        streamConfig.showsCursor = true
        streamConfig.capturesAudio = false

        // CRITICAL: Set pixel format to get raw frames
        streamConfig.pixelFormat = kCVPixelFormatType_32BGRA

        // No scaling for single window
        streamConfig.scalesToFit = false

        // Color space
        streamConfig.colorSpaceName = CGColorSpace.sRGB

        logger.info("Stream config - size: \(streamConfig.width)x\(streamConfig.height), fps: 30")

        // Create and start stream
        let stream = SCStream(filter: filter, configuration: streamConfig, delegate: self)
        captureStream = stream

        // Add output and start capture
        do {
            // Add output with dedicated queue for optimal performance
            try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: sampleHandlerQueue)

            // Log stream output configuration
            logger.info("Added stream output handler for type: .screen")

            try await stream.startCapture()

            isCapturing = true
            logger.info("✅ Successfully started window capture")

            // Start WebRTC if enabled
            if useWebRTC {
                await startWebRTCCapture()
            }
        } catch {
            logger.error("Failed to start capture: \(error)")
            captureStream = nil
            throw ScreencapError.failedToStartCapture(error)
        }
    }

    private func startWebRTCCapture() async {
        do {
            // Get server URL from environment or use default
            let serverURLString = ProcessInfo.processInfo
                .environment["VIBETUNNEL_SERVER_URL"] ?? "http://localhost:4020"
            guard let serverURL = URL(string: serverURLString) else {
                logger.error("Invalid server URL: \(serverURLString)")
                return
            }

            // Create WebRTC manager
            webRTCManager = WebRTCManager(serverURL: serverURL, screencapService: self)

            // Start WebRTC capture
            let modeString: String = switch captureMode {
            case .desktop(let index):
                "desktop-\(index)"
            case .allDisplays:
                "all-displays"
            case .window:
                "window"
            case .application:
                "application"
            }
            try await webRTCManager?.startCapture(mode: modeString)

            logger.info("✅ WebRTC capture started")
        } catch {
            logger.error("Failed to start WebRTC capture: \(error)")
            // Continue with JPEG mode
            self.useWebRTC = false
        }
    }

    /// Stop current capture
    func stopCapture() async {
        guard isCapturing else { return }

        let stream = captureStream
        captureStream = nil
        isCapturing = false
        currentFrame = nil

        // Stop WebRTC if active
        if let webRTCManager {
            await webRTCManager.stopCapture()
            self.webRTCManager = nil
        }

        if let stream {
            do {
                try await stream.stopCapture()
                logger.info("Stopped capture")
            } catch {
                logger.error("Failed to stop capture: \(error)")
            }
        }
    }

    /// Get current captured frame as JPEG data
    func getCurrentFrame() -> Data? {
        guard let frame = currentFrame else {
            return nil
        }

        let ciImage = CIImage(cgImage: frame)
        let context = CIContext()

        // Convert to JPEG with good quality
        guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
              let jpegData = context.jpegRepresentation(
                  of: ciImage,
                  colorSpace: colorSpace,
                  options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.8]
              )
        else {
            logger.error("Failed to convert frame to JPEG")
            return nil
        }

        return jpegData
    }

    /// Send click at specified coordinates
    /// - Parameters:
    ///   - x: X coordinate in 0-1000 normalized range
    ///   - y: Y coordinate in 0-1000 normalized range
    ///   - cgWindowID: Optional window ID for window-specific clicks
    func sendClick(x: Double, y: Double, cgWindowID: Int? = nil) async throws {
        // Validate coordinate boundaries
        guard x >= 0 && x <= 1_000 && y >= 0 && y <= 1_000 else {
            logger.error("⚠️ Invalid click coordinates: (\(x), \(y)) - must be in range 0-1000")
            throw ScreencapError.invalidCoordinates(x: x, y: y)
        }

        // Security audit log - include timestamp for tracking
        let timestamp = Date().timeIntervalSince1970
        logger
            .info(
                "🔒 [AUDIT] Click event at \(timestamp): coords=(\(x), \(y)), windowID=\(cgWindowID?.description ?? "nil")"
            )

        logger.info("🖱️ Received click at normalized coordinates: (\(x), \(y))")

        // Get the capture filter to determine actual dimensions
        guard let filter = captureFilter else {
            throw ScreencapError.notCapturing
        }

        // Convert from 0-1000 normalized coordinates to actual pixel coordinates
        let normalizedX = x / 1_000.0
        let normalizedY = y / 1_000.0

        var pixelX: Double
        var pixelY: Double

        // Calculate pixel coordinates based on capture mode
        switch captureMode {
        case .desktop(let displayIndex):
            // Get SCShareableContent to ensure consistency
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)

            if displayIndex >= 0 && displayIndex < content.displays.count {
                let display = content.displays[displayIndex]
                // Convert normalized to pixel coordinates within the display
                pixelX = display.frame.origin.x + (normalizedX * display.frame.width)
                pixelY = display.frame.origin.y + (normalizedY * display.frame.height)

                logger
                    .info(
                        "📺 Display \(displayIndex): pixel coords=(\(String(format: "%.1f", pixelX)), \(String(format: "%.1f", pixelY)))"
                    )
            } else {
                throw ScreencapError.noDisplay
            }

        case .allDisplays:
            // For all displays, we need to calculate based on the combined bounds
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)

            // Calculate the bounding rectangle
            var minX = CGFloat.greatestFiniteMagnitude
            var minY = CGFloat.greatestFiniteMagnitude
            var maxX: CGFloat = -CGFloat.greatestFiniteMagnitude
            var maxY: CGFloat = -CGFloat.greatestFiniteMagnitude

            for display in content.displays {
                minX = min(minX, display.frame.origin.x)
                minY = min(minY, display.frame.origin.y)
                maxX = max(maxX, display.frame.origin.x + display.frame.width)
                maxY = max(maxY, display.frame.origin.y + display.frame.height)
            }

            let totalWidth = maxX - minX
            let totalHeight = maxY - minY

            // Convert normalized to pixel coordinates within the combined bounds
            pixelX = minX + (normalizedX * totalWidth)
            pixelY = minY + (normalizedY * totalHeight)

            logger
                .info(
                    "🖥️ All displays: pixel coords=(\(String(format: "%.1f", pixelX)), \(String(format: "%.1f", pixelY)))"
                )

        case .window(let window):
            // For window capture, use the window's frame
            pixelX = window.frame.origin.x + (normalizedX * window.frame.width)
            pixelY = window.frame.origin.y + (normalizedY * window.frame.height)

            logger.info("🪟 Window: pixel coords=(\(String(format: "%.1f", pixelX)), \(String(format: "%.1f", pixelY)))")

        case .application:
            // For application capture, use the filter's content rect
            pixelX = filter.contentRect.origin.x + (normalizedX * filter.contentRect.width)
            pixelY = filter.contentRect.origin.y + (normalizedY * filter.contentRect.height)
        }

        // CGEvent uses screen coordinates which have top-left origin, same as our pixel coordinates
        let clickLocation = CGPoint(x: pixelX, y: pixelY)

        logger
            .info(
                "🎯 Final click location: (\(String(format: "%.1f", clickLocation.x)), \(String(format: "%.1f", clickLocation.y)))"
            )

        // Create mouse down event
        guard let mouseDown = CGEvent(
            mouseEventSource: nil,
            mouseType: .leftMouseDown,
            mouseCursorPosition: clickLocation,
            mouseButton: .left
        ) else {
            throw ScreencapError.failedToCreateEvent
        }

        // Create mouse up event
        guard let mouseUp = CGEvent(
            mouseEventSource: nil,
            mouseType: .leftMouseUp,
            mouseCursorPosition: clickLocation,
            mouseButton: .left
        ) else {
            throw ScreencapError.failedToCreateEvent
        }

        // Post events
        mouseDown.post(tap: .cghidEventTap)
        try await Task.sleep(nanoseconds: 50_000_000) // 50ms delay
        mouseUp.post(tap: .cghidEventTap)

        logger.info("✅ Click sent successfully")
    }

    /// Send mouse down event at specified coordinates
    /// - Parameters:
    ///   - x: X coordinate in 0-1000 normalized range
    ///   - y: Y coordinate in 0-1000 normalized range
    func sendMouseDown(x: Double, y: Double) async throws {
        // Validate coordinate boundaries
        guard x >= 0 && x <= 1_000 && y >= 0 && y <= 1_000 else {
            logger.error("⚠️ Invalid mouse down coordinates: (\(x), \(y)) - must be in range 0-1000")
            throw ScreencapError.invalidCoordinates(x: x, y: y)
        }

        // Security audit log
        let timestamp = Date().timeIntervalSince1970
        logger.info("🔒 [AUDIT] Mouse down event at \(timestamp): coords=(\(x), \(y))")

        logger.info("🖱️ Received mouse down at normalized coordinates: (\(x), \(y))")

        // Calculate pixel coordinates (reuse the conversion logic)
        let clickLocation = try await calculateClickLocation(x: x, y: y)

        // Create mouse down event
        guard let mouseDown = CGEvent(
            mouseEventSource: nil,
            mouseType: .leftMouseDown,
            mouseCursorPosition: clickLocation,
            mouseButton: .left
        ) else {
            throw ScreencapError.failedToCreateEvent
        }

        // Post event
        mouseDown.post(tap: .cghidEventTap)

        logger.info("✅ Mouse down sent successfully")
    }

    /// Send mouse move (drag) event at specified coordinates
    /// - Parameters:
    ///   - x: X coordinate in 0-1000 normalized range
    ///   - y: Y coordinate in 0-1000 normalized range
    func sendMouseMove(x: Double, y: Double) async throws {
        // Validate coordinate boundaries
        guard x >= 0 && x <= 1_000 && y >= 0 && y <= 1_000 else {
            logger.error("⚠️ Invalid mouse move coordinates: (\(x), \(y)) - must be in range 0-1000")
            throw ScreencapError.invalidCoordinates(x: x, y: y)
        }

        // Calculate pixel coordinates
        let moveLocation = try await calculateClickLocation(x: x, y: y)

        // Create mouse dragged event
        guard let mouseDrag = CGEvent(
            mouseEventSource: nil,
            mouseType: .leftMouseDragged,
            mouseCursorPosition: moveLocation,
            mouseButton: .left
        ) else {
            throw ScreencapError.failedToCreateEvent
        }

        // Post event
        mouseDrag.post(tap: .cghidEventTap)
    }

    /// Send mouse up event at specified coordinates
    /// - Parameters:
    ///   - x: X coordinate in 0-1000 normalized range
    ///   - y: Y coordinate in 0-1000 normalized range
    func sendMouseUp(x: Double, y: Double) async throws {
        // Validate coordinate boundaries
        guard x >= 0 && x <= 1_000 && y >= 0 && y <= 1_000 else {
            logger.error("⚠️ Invalid mouse up coordinates: (\(x), \(y)) - must be in range 0-1000")
            throw ScreencapError.invalidCoordinates(x: x, y: y)
        }

        // Security audit log
        let timestamp = Date().timeIntervalSince1970
        logger.info("🔒 [AUDIT] Mouse up event at \(timestamp): coords=(\(x), \(y))")

        logger.info("🖱️ Received mouse up at normalized coordinates: (\(x), \(y))")

        // Calculate pixel coordinates
        let clickLocation = try await calculateClickLocation(x: x, y: y)

        // Create mouse up event
        guard let mouseUp = CGEvent(
            mouseEventSource: nil,
            mouseType: .leftMouseUp,
            mouseCursorPosition: clickLocation,
            mouseButton: .left
        ) else {
            throw ScreencapError.failedToCreateEvent
        }

        // Post event
        mouseUp.post(tap: .cghidEventTap)

        logger.info("✅ Mouse up sent successfully")
    }

    /// Calculate pixel location from normalized coordinates
    private func calculateClickLocation(x: Double, y: Double) async throws -> CGPoint {
        // Get the capture filter to determine actual dimensions
        guard let filter = captureFilter else {
            throw ScreencapError.notCapturing
        }

        // Convert from 0-1000 normalized coordinates to actual pixel coordinates
        let normalizedX = x / 1_000.0
        let normalizedY = y / 1_000.0

        var pixelX: Double
        var pixelY: Double

        // Calculate pixel coordinates based on capture mode
        switch captureMode {
        case .desktop(let displayIndex):
            // Get SCShareableContent to ensure consistency
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)

            if displayIndex >= 0 && displayIndex < content.displays.count {
                let display = content.displays[displayIndex]
                // Convert normalized to pixel coordinates within the display
                pixelX = display.frame.origin.x + (normalizedX * display.frame.width)
                pixelY = display.frame.origin.y + (normalizedY * display.frame.height)
            } else {
                throw ScreencapError.noDisplay
            }

        case .allDisplays:
            // For all displays, we need to calculate based on the combined bounds
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)

            // Calculate the bounding rectangle
            var minX = CGFloat.greatestFiniteMagnitude
            var minY = CGFloat.greatestFiniteMagnitude
            var maxX: CGFloat = -CGFloat.greatestFiniteMagnitude
            var maxY: CGFloat = -CGFloat.greatestFiniteMagnitude

            for display in content.displays {
                minX = min(minX, display.frame.origin.x)
                minY = min(minY, display.frame.origin.y)
                maxX = max(maxX, display.frame.origin.x + display.frame.width)
                maxY = max(maxY, display.frame.origin.y + display.frame.height)
            }

            let totalWidth = maxX - minX
            let totalHeight = maxY - minY

            // Convert normalized to pixel coordinates within the combined bounds
            pixelX = minX + (normalizedX * totalWidth)
            pixelY = minY + (normalizedY * totalHeight)

        case .window(let window):
            // For window capture, use the window's frame
            pixelX = window.frame.origin.x + (normalizedX * window.frame.width)
            pixelY = window.frame.origin.y + (normalizedY * window.frame.height)

        case .application:
            // For application capture, use the filter's content rect
            pixelX = filter.contentRect.origin.x + (normalizedX * filter.contentRect.width)
            pixelY = filter.contentRect.origin.y + (normalizedY * filter.contentRect.height)
        }

        // CGEvent uses screen coordinates which have top-left origin, same as our pixel coordinates
        return CGPoint(x: pixelX, y: pixelY)
    }

    /// Send keyboard input
    func sendKey(
        key: String,
        metaKey: Bool = false,
        ctrlKey: Bool = false,
        altKey: Bool = false,
        shiftKey: Bool = false
    )
        async throws
    {
        // Validate key input
        guard !key.isEmpty && key.count <= 20 else {
            logger.error("⚠️ Invalid key input: '\(key)' - must be non-empty and <= 20 characters")
            throw ScreencapError.invalidKeyInput(key)
        }

        // Security audit log - include timestamp for tracking
        let timestamp = Date().timeIntervalSince1970
        logger
            .info(
                "🔒 [AUDIT] Key event at \(timestamp): key='\(key)', modifiers=[cmd:\(metaKey), ctrl:\(ctrlKey), alt:\(altKey), shift:\(shiftKey)]"
            )

        // Convert key string to key code
        let keyCode = keyStringToKeyCode(key)

        // Create key down event
        guard let keyDown = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true) else {
            throw ScreencapError.failedToCreateEvent
        }

        // Create key up event
        guard let keyUp = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false) else {
            throw ScreencapError.failedToCreateEvent
        }

        // Set modifier flags
        var flags: CGEventFlags = []
        if metaKey { flags.insert(.maskCommand) }
        if ctrlKey { flags.insert(.maskControl) }
        if altKey { flags.insert(.maskAlternate) }
        if shiftKey { flags.insert(.maskShift) }

        keyDown.flags = flags
        keyUp.flags = flags

        // Post events
        keyDown.post(tap: .cghidEventTap)
        try await Task.sleep(nanoseconds: 50_000_000) // 50ms delay
        keyUp.post(tap: .cghidEventTap)

        logger.info("Sent key: \(key) with modifiers")
    }

    // MARK: - Private Methods

    private func keyStringToKeyCode(_ key: String) -> CGKeyCode {
        // Basic key mapping - this should be expanded
        switch key.lowercased() {
        case "a": 0x00
        case "s": 0x01
        case "d": 0x02
        case "f": 0x03
        case "h": 0x04
        case "g": 0x05
        case "z": 0x06
        case "x": 0x07
        case "c": 0x08
        case "v": 0x09
        case "b": 0x0B
        case "q": 0x0C
        case "w": 0x0D
        case "e": 0x0E
        case "r": 0x0F
        case "y": 0x10
        case "t": 0x11
        case "1": 0x12
        case "2": 0x13
        case "3": 0x14
        case "4": 0x15
        case "6": 0x16
        case "5": 0x17
        case "=": 0x18
        case "9": 0x19
        case "7": 0x1A
        case "-": 0x1B
        case "8": 0x1C
        case "0": 0x1D
        case "]": 0x1E
        case "o": 0x1F
        case "u": 0x20
        case "[": 0x21
        case "i": 0x22
        case "p": 0x23
        case "l": 0x25
        case "j": 0x26
        case "'": 0x27
        case "k": 0x28
        case ";": 0x29
        case "\\": 0x2A
        case ",": 0x2B
        case "/": 0x2C
        case "n": 0x2D
        case "m": 0x2E
        case ".": 0x2F
        case " ", "space": 0x31
        case "enter", "return": 0x24
        case "tab": 0x30
        case "escape", "esc": 0x35
        case "backspace", "delete": 0x33
        case "arrowup", "up": 0x7E
        case "arrowdown", "down": 0x7D
        case "arrowleft", "left": 0x7B
        case "arrowright", "right": 0x7C
        default: 0x00 // Default to 'a'
        }
    }
}

// MARK: - SCStreamDelegate

extension ScreencapService: SCStreamDelegate {
    public nonisolated func stream(_ stream: SCStream, didStopWithError error: Error) {
        Task { [weak self] in
            await self?.handleStreamError(error)
        }
    }

    private func handleStreamError(_ error: Error) {
        logger.error("Stream stopped with error: \(error)")
        isCapturing = false
        captureStream = nil
    }
}

// MARK: - SCStreamOutput

extension ScreencapService: SCStreamOutput {
    public nonisolated func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard type == .screen else {
            // Log other types occasionally
            if Int.random(in: 0..<100) == 0 {
                // Cannot log from nonisolated context, skip logging
            }
            return
        }

        // Skip frame counting in non-isolated context to avoid concurrency issues
        let shouldLog = Int.random(in: 0..<300) == 0

        // Log sample buffer format details
        if let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer) {
            let mediaType = CMFormatDescriptionGetMediaType(formatDesc)
            let mediaSubType = CMFormatDescriptionGetMediaSubType(formatDesc)
            let dimensions = CMVideoFormatDescriptionGetDimensions(formatDesc)

            // Only log occasionally to reduce noise
            if shouldLog {
                // Cannot log from nonisolated context, skip detailed logging
                _ = String(format: "0x%08X", mediaType)
                _ = String(format: "0x%08X", mediaSubType)

                // Also log if we're in all displays mode to debug the capture
                Task { @MainActor in
                    if case .allDisplays = self.captureMode {
                        self.logger
                            .info("📊 All displays capture - receiving frames: \(dimensions.width)x\(dimensions.height)")
                    }
                }
            }
        }

        // Check if sample buffer is ready
        if !CMSampleBufferDataIsReady(sampleBuffer) {
            // Cannot log from nonisolated context, skip warning
            return
        }

        // Get sample buffer attachments to check frame status
        guard let attachmentsArray = CMSampleBufferGetSampleAttachmentsArray(
            sampleBuffer,
            createIfNecessary: false
        ) as? [[SCStreamFrameInfo: Any]],
            let attachments = attachmentsArray.first
        else {
            if shouldLog {
                // Cannot log from nonisolated context, skip debug message
            }
            return
        }

        // Check frame status - only process complete frames
        if let statusRawValue = attachments[SCStreamFrameInfo.status] as? Int,
           let status = SCFrameStatus(rawValue: statusRawValue),
           status != .complete
        {
            if shouldLog {
                // Cannot log from nonisolated context, skip debug message
            }
            return
        }

        // Get pixel buffer immediately
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            // Log this issue but only occasionally
            if shouldLog {
                // Cannot log from nonisolated context, skip warning
            }
            return
        }

        // We have a pixel buffer! Process it for WebRTC if enabled
        // Process WebRTC frame if enabled
        // To avoid data race warnings, we'll let WebRTCManager handle the async processing
        // by calling it synchronously and letting it manage its own concurrency
        if useWebRTC, let webRTCManager = webRTCManager {
            // The processVideoFrame method is nonisolated and accepts a sending parameter
            // We can call it directly without creating a Task, avoiding the closure capture issue
            webRTCManager.processVideoFrameSync(sampleBuffer)
        }

        // Create CIImage and process for display
        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        Task { @MainActor [weak self] in
            guard let self else { return }
            await self.processFrame(ciImage: ciImage)
        }
    }

    /// Separate async function to handle frame processing
    @MainActor
    private func processFrame(ciImage: CIImage) async {
        let context = CIContext()
        guard let cgImage = context.createCGImage(ciImage, from: ciImage.extent) else {
            logger.error("Failed to create CGImage from CIImage")
            return
        }

        // Update current frame
        currentFrame = cgImage
        let frameCount = frameCounter
        frameCounter += 1

        // Log only every 300 frames (10 seconds at 30fps) to reduce noise
        if frameCount.isMultiple(of: 300) {
            logger.info("📹 Frame \(frameCount) received")
        }
    }
}

// MARK: - Error Types

enum ScreencapError: LocalizedError {
    case noDisplay
    case invalidWindowIndex
    case invalidApplicationIndex
    case invalidCaptureType
    case failedToCreateEvent
    case notCapturing
    case failedToGetContent(Error)
    case invalidConfiguration
    case failedToStartCapture(Error)
    case invalidCoordinates(x: Double, y: Double)
    case invalidKeyInput(String)

    var errorDescription: String? {
        switch self {
        case .noDisplay:
            "No display available"
        case .invalidWindowIndex:
            "Invalid window index"
        case .invalidApplicationIndex:
            "Invalid application index"
        case .invalidCaptureType:
            "Invalid capture type"
        case .failedToCreateEvent:
            "Failed to create input event"
        case .notCapturing:
            "Not currently capturing"
        case .failedToGetContent(let error):
            "Failed to get screen content: \(error.localizedDescription)"
        case .invalidConfiguration:
            "Invalid capture configuration"
        case .failedToStartCapture(let error):
            "Failed to start capture: \(error.localizedDescription)"
        case .invalidCoordinates(let x, let y):
            "Invalid coordinates (\(x), \(y)) - must be in range 0-1000"
        case .invalidKeyInput(let key):
            "Invalid key input: '\(key)' - must be non-empty and <= 20 characters"
        }
    }
}
