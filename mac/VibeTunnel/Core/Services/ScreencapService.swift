import AppKit
import ApplicationServices
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

    /// Check if the service has been initialized
    static var isInitialized: Bool {
        true // Singleton is always initialized
    }

    // MARK: - WebSocket Connection State

    private var isWebSocketConnecting = false
    private var isWebSocketConnected = false
    private var webSocketConnectionContinuations: [CheckedContinuation<Void, Error>] = []
    private var reconnectTask: Task<Void, Never>?
    private var shouldReconnect = true

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

    /// Icon cache
    private var iconCache: [Int32: String?] = [:] // PID -> base64 icon

    // WebRTC support
    // These properties need to be nonisolated so they can be accessed from the stream output handler
    private nonisolated(unsafe) var webRTCManager: WebRTCManager?
    private nonisolated(unsafe) var useWebRTC = false
    private var decompressionSession: VTDecompressionSession?

    /// State machine for capture lifecycle
    private let stateMachine = CaptureStateMachine()

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
        case permissionDenied
        case invalidWindowIndex
        case invalidApplicationIndex
        case invalidCaptureType
        case invalidConfiguration
        case serviceNotReady

        var errorDescription: String? {
            switch self {
            case .invalidServerURL:
                "Invalid server URL for WebSocket connection"
            case .webSocketNotConnected:
                "WebSocket connection not established"
            case .windowNotFound(let id):
                "Window with ID \(id) not found"
            case .noDisplay:
                "No display available"
            case .notCapturing:
                "Screen capture is not active"
            case .failedToStartCapture(let error):
                "Failed to start capture: \(error.localizedDescription)"
            case .failedToCreateEvent:
                "Failed to create system event"
            case .invalidCoordinates(let x, let y):
                "Invalid coordinates: (\(x), \(y))"
            case .invalidKeyInput(let key):
                "Invalid key input: \(key)"
            case .failedToGetContent(let error):
                "Failed to get shareable content: \(error.localizedDescription)"
            case .permissionDenied:
                "Screen recording permission is required. Please grant permission in System Settings > Privacy & Security > Screen Recording > VibeTunnel"
            case .invalidWindowIndex:
                "Invalid window index"
            case .invalidApplicationIndex:
                "Invalid application index"
            case .invalidCaptureType:
                "Invalid capture type"
            case .invalidConfiguration:
                "Invalid capture configuration"
            case .serviceNotReady:
                "Screen capture service is not ready. Connection may still be initializing."
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
        let x: Double
        let y: Double
        let width: Double
        let height: Double
    }

    struct ProcessGroup: Codable {
        let processName: String
        let pid: Int32
        let bundleIdentifier: String?
        let iconData: String? // Base64 encoded PNG
        let windows: [WindowInfo]
    }

    // MARK: - Initialization

    override init() {
        super.init()
        logger.info("🚀 ScreencapService initialized")

        // Register for display configuration changes
        setupDisplayNotifications()

        // Set up state machine callbacks
        setupStateMachine()

        // Initialize WebRTCManager, which will register itself as a handler
        // for screencap messages on the shared socket.
        initializeWebRTCManager()
    }

    /// Initialize WebRTCManager for API handling without triggering screen recording permission
    private func initializeWebRTCManager() {
        let serverPort = UserDefaults.standard.string(forKey: "serverPort") ?? "4020"
        let serverURLString = ProcessInfo.processInfo
            .environment["VIBETUNNEL_SERVER_URL"] ?? "http://localhost:\(serverPort)"
        if let serverURL = URL(string: serverURLString) {
            webRTCManager = WebRTCManager(serverURL: serverURL, screencapService: self)
            logger.info("✅ WebRTCManager initialized for API handling")
        } else {
            logger.error("Invalid server URL for WebRTCManager: \(serverURLString)")
        }
    }

    deinit {
        // Remove display notifications
        NotificationCenter.default.removeObserver(self)
    }

    // MARK: - Public Methods

    /// Ensure the service is ready for API handling.
    public func connectForApiHandling() async throws {
        // The connection is now managed by SharedUnixSocketManager. We just need to
        // ensure that the WebRTCManager (and its handlers) has been initialized.
        guard webRTCManager != nil else {
            logger.error("WebRTCManager not initialized. ScreencapService is not ready.")
            throw ScreencapError.serviceNotReady
        }
        // Also check if the underlying shared socket is connected.
        guard SharedUnixSocketManager.shared.isConnected else {
            logger.error("Shared socket is not connected. ScreencapService is not ready.")
            throw ScreencapError.webSocketNotConnected
        }

        // Transition state machine to ready if we're still idle
        if stateMachine.currentState == .idle {
            stateMachine.processEvent(.connect)
            // The socket is already connected, so immediately transition to ready
            stateMachine.processEvent(.connectionEstablished)
        }

        logger.info("ScreencapService is ready for API handling.")
    }

    /// Notify the service that the WebRTC connection is ready
    func notifyConnectionReady() {
        logger.info("🔌 WebRTC connection ready notification received")

        // Transition to ready state if we're in connecting state
        if stateMachine.currentState == .connecting {
            stateMachine.processEvent(.connectionEstablished)
        } else if stateMachine.currentState == .idle {
            // If we're still idle, transition through connecting to ready
            stateMachine.processEvent(.connect)
            stateMachine.processEvent(.connectionEstablished)
        }
    }

    /// Test method to debug SCShareableContent issues
    func testShareableContent() async {
        logger.info("🧪 Testing SCShareableContent...")

        // Test 1: Check NSScreen
        logger.info("🧪 Test 1: NSScreen.screens")
        let screens = NSScreen.screens
        logger.info("  - Count: \(screens.count)")
        for (i, screen) in screens.enumerated() {
            logger.info("  - Screen \(i): \(screen.localizedName), frame: \(String(describing: screen.frame))")
        }

        // Test 2: Try SCShareableContent.current
        logger.info("🧪 Test 2: SCShareableContent.current")
        do {
            let currentContent = try await SCShareableContent.current
            logger.info("  - Displays: \(currentContent.displays.count)")
            logger.info("  - Windows: \(currentContent.windows.count)")
            for (i, display) in currentContent.displays.enumerated() {
                logger
                    .info(
                        "  - Display \(i): frame=\(String(describing: display.frame)), size=\(display.width)x\(display.height)"
                    )
            }
        } catch {
            logger.error("  - Failed: \(error)")
        }

        // Test 3: Try excludingDesktopWindows with different parameters
        logger.info("🧪 Test 3: SCShareableContent.excludingDesktopWindows(false, false)")
        do {
            let content1 = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            logger.info("  - Displays: \(content1.displays.count)")
            logger.info("  - Windows: \(content1.windows.count)")
        } catch {
            logger.error("  - Failed: \(error)")
        }

        // Test 4: Try excludingDesktopWindows with true, true
        logger.info("🧪 Test 4: SCShareableContent.excludingDesktopWindows(true, true)")
        do {
            let content2 = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
            logger.info("  - Displays: \(content2.displays.count)")
            logger.info("  - Windows: \(content2.windows.count)")
        } catch {
            logger.error("  - Failed: \(error)")
        }
    }

    /// Get all available displays
    func getDisplays() async throws -> [DisplayInfo] {
        logger.info("🔍 getDisplays() called")

        // First check screen recording permission
        let hasPermission = await isScreenRecordingAllowed()
        logger.info("🔍 Screen recording permission check: \(hasPermission)")

        // If no permission, throw an error instead of continuing
        guard hasPermission else {
            logger.warning("❌ No screen recording permission for getDisplays")
            throw ScreencapError.permissionDenied
        }

        // First check NSScreen to see what the system reports
        let nsScreens = NSScreen.screens
        logger.info("🖥️ NSScreen.screens count: \(nsScreens.count)")
        for (index, screen) in nsScreens.enumerated() {
            logger.info("🖥️ NSScreen \(index): \(screen.localizedName), frame: \(String(describing: screen.frame))")
        }

        // Use SCShareableContent to ensure consistency with capture
        logger.info("🔍 Calling SCShareableContent.excludingDesktopWindows...")
        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(
                false,
                onScreenWindowsOnly: false
            )
            logger.info("✅ SCShareableContent returned successfully")
            logger.info("📺 SCShareableContent displays count: \(content.displays.count)")
            logger.info("🪟 SCShareableContent windows count: \(content.windows.count)")
        } catch {
            logger.error("❌ SCShareableContent.excludingDesktopWindows failed: \(error)")
            throw error
        }

        guard !content.displays.isEmpty else {
            logger.error("❌ No displays found in SCShareableContent, trying NSScreen fallback")

            // Fallback to NSScreen when SCShareableContent fails
            let nsScreens = NSScreen.screens
            if nsScreens.isEmpty {
                logger.error("❌ No displays found in NSScreen either")
                throw ScreencapError.noDisplay
            }

            logger.warning("⚠️ Using NSScreen fallback - found \(nsScreens.count) displays")

            // Create DisplayInfo from NSScreen data
            var displayInfos: [DisplayInfo] = []
            for (index, screen) in nsScreens.enumerated() {
                let displayInfo = DisplayInfo(
                    id: "NSScreen-\(index)",
                    width: Int(screen.frame.width),
                    height: Int(screen.frame.height),
                    scaleFactor: screen.backingScaleFactor,
                    refreshRate: 60.0, // NSScreen doesn't provide refresh rate
                    x: Double(screen.frame.origin.x),
                    y: Double(screen.frame.origin.y),
                    name: screen.localizedName
                )
                displayInfos.append(displayInfo)
            }

            return displayInfos
        }

        logger.info("📺 Found \(content.displays.count) displays")

        var displayInfos: [DisplayInfo] = []

        for (index, display) in content.displays.enumerated() {
            // Log display details for debugging
            logger
                .debug(
                    "📺 SCDisplay \(index): frame=\(String(describing: display.frame)), width=\(display.width), height=\(display.height)"
                )

            // Log all NSScreen frames for comparison
            for (screenIndex, screen) in NSScreen.screens.enumerated() {
                let screenName = screen.localizedName
                logger.debug("🖥️ NSScreen \(screenIndex): frame=\(String(describing: screen.frame)), name=\(screenName)")
            }

            // Try to find corresponding NSScreen for additional info
            // First attempt: try direct matching
            var nsScreen = NSScreen.screens.first { screen in
                // Match by frame - SCDisplay and NSScreen should have the same frame
                let xMatch = abs(screen.frame.origin.x - display.frame.origin.x) < 1.0
                let yMatch = abs(screen.frame.origin.y - display.frame.origin.y) < 1.0
                let widthMatch = abs(screen.frame.width - display.frame.width) < 1.0
                let heightMatch = abs(screen.frame.height - display.frame.height) < 1.0

                let matches = xMatch && yMatch && widthMatch && heightMatch
                if matches {
                    let screenName = screen.localizedName
                    logger.debug("✅ Matched SCDisplay \(index) with NSScreen: \(screenName)")
                }
                return matches
            }

            // If no match found, try matching by size only (position might be different)
            if nsScreen == nil {
                nsScreen = NSScreen.screens.first { screen in
                    let widthMatch = abs(screen.frame.width - display.frame.width) < 1.0
                    let heightMatch = abs(screen.frame.height - display.frame.height) < 1.0

                    let matches = widthMatch && heightMatch
                    if matches {
                        let screenName = screen.localizedName
                        logger.debug("✅ Matched SCDisplay \(index) with NSScreen by size: \(screenName)")
                    }
                    return matches
                }
            }

            let name = nsScreen?.localizedName ?? "Display \(index + 1)"
            logger.info("📍 Display \(index): '\(name)' - size: \(display.width)x\(display.height)")

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

    /// Get process groups with their windows
    func getProcessGroups() async throws -> [ProcessGroup] {
        logger.info("🔍 getProcessGroups called")

        // First check screen recording permission
        let hasPermission = await isScreenRecordingAllowed()
        logger.info("🔍 Screen recording permission check: \(hasPermission)")

        // If no permission, throw an error instead of continuing
        guard hasPermission else {
            logger.warning("❌ No screen recording permission for getProcessGroups")
            throw ScreencapError.permissionDenied
        }

        // Add timeout to detect if SCShareableContent is hanging
        let startTime = Date()
        defer {
            let elapsed = Date().timeIntervalSince(startTime)
            logger.info("🔍 getProcessGroups completed in \(elapsed) seconds")
        }

        logger.info("🔍 About to call SCShareableContent.excludingDesktopWindows")
        logger.info("🔍 Current thread: \(Thread.current)")
        logger.info("🔍 Main thread: \(Thread.isMainThread)")

        // Try to get shareable content with better error handling
        let content: SCShareableContent
        do {
            // Simple direct call with better error handling
            logger.info("🔍 Calling SCShareableContent.excludingDesktopWindows directly...")
            content = try await SCShareableContent.excludingDesktopWindows(
                false,
                onScreenWindowsOnly: false
            )
            logger.info("🔍 Got shareable content with \(content.windows.count) windows")
        } catch {
            logger.error("❌ Failed to get shareable content: \(error)")
            logger.error("❌ Error type: \(type(of: error))")
            logger.error("❌ Error description: \(error.localizedDescription)")

            if let nsError = error as NSError? {
                logger.error("❌ Error domain: \(nsError.domain)")
                logger.error("❌ Error code: \(nsError.code)")
                logger.error("❌ Error userInfo: \(nsError.userInfo)")
            }

            // Try alternative method
            logger.info("🔍 Trying SCShareableContent.current as fallback...")
            do {
                content = try await SCShareableContent.current
                logger.info("🔍 Got shareable content via .current with \(content.windows.count) windows")
            } catch {
                logger.error("❌ Fallback also failed: \(error)")
                throw ScreencapError.failedToGetContent(error)
            }
        }

        // Filter windows first
        let filteredWindows = content.windows.filter { window in
            // Skip windows that are not on screen
            guard window.isOnScreen else { return false }

            // Skip windows with zero size
            guard window.frame.width > 0 && window.frame.height > 0 else { return false }

            // Skip very small windows (less than 100x100 pixels)
            // These are often invisible utility windows or focus proxies
            guard window.frame.width >= 100 && window.frame.height >= 100 else {
                logger
                    .debug(
                        "Filtering out small window: \(window.title ?? "Untitled") - size: \(window.frame.width)x\(window.frame.height)"
                    )
                return false
            }

            // Skip system windows
            if let appName = window.owningApplication?.applicationName {
                let systemApps = [
                    "Window Server",
                    "WindowManager",
                    "Dock",
                    "SystemUIServer",
                    "Control Center",
                    "Notification Center",
                    "Spotlight",
                    "AXUIElement", // Accessibility UI elements
                    "Desktop" // Filter out Desktop entries
                ]

                if systemApps.contains(appName) {
                    return false
                }

                // Skip VibeTunnel itself
                if appName.lowercased().contains("vibetunnel") {
                    return false
                }
            }

            // Skip windows with certain titles
            if let title = window.title {
                if title.contains("Event Tap") ||
                    title.contains("Shield") ||
                    title.isEmpty || // Skip windows with empty titles
                    title == "Focus Proxy" || // Common invisible window
                    title == "Menu Bar" ||
                    title == "Desktop" // Skip Desktop windows
                {
                    return false
                }
            }

            return true
        }

        logger.info("🔍 Filtered to \(filteredWindows.count) windows")

        // Group windows by process
        let groupedWindows = Dictionary(grouping: filteredWindows) { window in
            window.owningApplication?.processID ?? 0
        }

        logger.info("🔍 Grouped into \(groupedWindows.count) process groups")

        // Convert to ProcessGroups
        // OPTIMIZATION: Skip icon loading for now to avoid timeout
        let processGroups = groupedWindows.compactMap { _, windows -> ProcessGroup? in
            guard let firstWindow = windows.first,
                  let app = firstWindow.owningApplication else { return nil }

            let windowInfos = windows.map { window in
                WindowInfo(
                    cgWindowID: Int(window.windowID),
                    title: window.title,
                    x: window.frame.origin.x,
                    y: window.frame.origin.y,
                    width: window.frame.width,
                    height: window.frame.height
                )
            }

            return ProcessGroup(
                processName: app.applicationName,
                pid: app.processID,
                bundleIdentifier: app.bundleIdentifier,
                iconData: getCachedAppIcon(for: app.processID),
                windows: windowInfos
            )
        }

        // Sort by largest window area (descending) - processes with bigger windows appear first
        return processGroups.sorted { group1, group2 in
            // Find the largest window area in each process group
            let maxArea1 = group1.windows.map { $0.width * $0.height }.max() ?? 0
            let maxArea2 = group2.windows.map { $0.width * $0.height }.max() ?? 0

            // Sort by area descending (larger windows first)
            return maxArea1 > maxArea2
        }
    }

    /// Check if screen recording permission is granted
    private func isScreenRecordingAllowed() async -> Bool {
        do {
            // Try to get shareable content - this will fail if no permission
            _ = try await SCShareableContent.current
            logger.info("✅ Screen recording permission is granted")
            return true
        } catch {
            logger.warning("❌ Screen recording permission check failed: \(error)")
            return false
        }
    }

    /// Get cached application icon or load it if not cached
    private func getCachedAppIcon(for pid: Int32) -> String? {
        // Check cache first
        if let cachedIcon = iconCache[pid] {
            return cachedIcon
        }

        // Load icon and cache it
        let icon = getAppIcon(for: pid)
        iconCache[pid] = icon
        return icon
    }

    /// Get application icon as base64 encoded PNG
    private func getAppIcon(for pid: Int32) -> String? {
        let startTime = Date()
        defer {
            let elapsed = Date().timeIntervalSince(startTime)
            logger.info("⏱️ getAppIcon for PID \(pid) took \(elapsed) seconds")
        }

        guard let app = NSRunningApplication(processIdentifier: pid),
              let icon = app.icon
        else {
            logger.info("⚠️ No icon found for PID \(pid)")
            return nil
        }

        // Resize icon to reasonable size (32x32 for retina displays)
        let targetSize = NSSize(width: 32, height: 32)
        let resizedIcon = NSImage(size: targetSize)

        resizedIcon.lockFocus()
        NSGraphicsContext.current?.imageInterpolation = .high
        icon.draw(
            in: NSRect(origin: .zero, size: targetSize),
            from: NSRect(origin: .zero, size: icon.size),
            operation: .copy,
            fraction: 1.0
        )
        resizedIcon.unlockFocus()

        // Convert to PNG
        guard let tiffData = resizedIcon.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiffData),
              let pngData = bitmap.representation(using: .png, properties: [:])
        else {
            logger.error("❌ Failed to convert icon to PNG for PID \(pid)")
            return nil
        }

        return pngData.base64EncodedString()
    }

    /// Start capture with specified mode
    func startCapture(type: String, index: Int, useWebRTC: Bool = false, use8k: Bool = false) async throws {
        logger.info("🎬 Starting capture - type: \(type), index: \(index), WebRTC: \(useWebRTC), 8K: \(use8k)")

        // Check screen recording permission first
        let hasPermission = await isScreenRecordingAllowed()
        logger.info("🔒 Screen recording permission: \(hasPermission)")
        if !hasPermission {
            logger.error("❌ No screen recording permission!")
            logger.error("💡 Please grant Screen Recording permission in:")
            logger.error("   System Settings > Privacy & Security > Screen Recording > VibeTunnel")
        }

        // Stop any existing capture first to ensure clean state
        await stopCapture()

        // If we're still idle, try to connect first
        if stateMachine.currentState == .idle {
            logger.info("📊 Service in idle state, attempting to connect first")
            try await connectForApiHandling()
        }

        // Wait for state machine to settle if we just stopped
        if stateMachine.currentState == .stopping {
            logger.info("📊 Waiting for stop to complete...")
            var attempts = 0
            while stateMachine.currentState == .stopping && attempts < 20 {
                try await Task.sleep(nanoseconds: 50_000_000) // 50ms
                attempts += 1
            }
        }

        // Check if we can start capture
        guard stateMachine.canPerformAction(.startCapture) else {
            logger.error("Cannot start capture in state: \(self.stateMachine.currentState)")
            logger.error("📊 Current state description: \(self.stateMachine.stateDescription())")
            throw ScreencapError.serviceNotReady
        }

        self.useWebRTC = useWebRTC

        // Determine capture mode for state machine
        let captureMode: CaptureMode = switch type {
        case "desktop":
            if index == -1 {
                .allDisplays
            } else {
                .desktop(displayIndex: index)
            }
        case "window":
            // For window capture, we'll need to select the window later
            // Use desktop mode as a placeholder until window is selected
            .desktop(displayIndex: 0)
        default:
            .desktop(displayIndex: 0)
        }

        // Transition to starting state
        stateMachine.processEvent(.startCapture(mode: captureMode, useWebRTC: useWebRTC))

        logger.debug("Requesting shareable content...")
        let content: SCShareableContent
        do {
            content = try await SCShareableContent.current
            logger
                .info(
                    "Got shareable content - displays: \(content.displays.count), windows: \(content.windows.count), apps: \(content.applications.count)"
                )
        } catch {
            logger.error("Failed to get shareable content: \(error)")
            throw ScreencapError.failedToGetContent(error)
        }

        // Create configuration builder with the shareable content
        let configBuilder = CaptureConfigurationBuilder(shareableContent: content)
            .setFrameRate(30)
            .setShowsCursor(true)
            .setCapturesAudio(false)
            .setUse8K(use8k)

        // Determine capture mode
        switch type {
        case "desktop":
            // Check if index is -1 which means all displays
            if index == -1 {
                // Capture all displays
                guard let primaryDisplay = content.displays.first else {
                    throw ScreencapError.noDisplay
                }

                self.captureMode = .allDisplays
                currentDisplayIndex = -1
                configBuilder.setCaptureMode(.allDisplays)
                logger.info("🖥️ Setting up all displays capture mode")
                logger.info("  Primary display: size=\(primaryDisplay.width)x\(primaryDisplay.height)")
                logger.info("  Total displays: \(content.displays.count)")
            } else {
                // Single display capture
                let displayIndex = index < content.displays.count ? index : 0
                guard displayIndex < content.displays.count else {
                    throw ScreencapError.noDisplay
                }
                let display = content.displays[displayIndex]
                self.captureMode = .desktop(displayIndex: displayIndex)
                currentDisplayIndex = displayIndex
                configBuilder.setCaptureMode(.desktop(displayIndex: displayIndex))

                // Log display selection for debugging
                logger
                    .info(
                        "📺 Capturing display \(displayIndex) of \(content.displays.count) - size: \(display.width)x\(display.height)"
                    )
            }

        case "window":
            guard index < content.windows.count else {
                throw ScreencapError.invalidWindowIndex
            }
            let window = content.windows[index]
            selectedWindow = window
            self.captureMode = .window(window)
            configBuilder.setCaptureMode(.window(window))

            logger
                .info(
                    "🪟 Capturing window: '\(window.title ?? "Untitled")' - size: \(window.frame.width)x\(window.frame.height)"
                )

        case "application":
            guard index < content.applications.count else {
                throw ScreencapError.invalidApplicationIndex
            }
            let app = content.applications[index]
            self.captureMode = .application(app)
            configBuilder.setCaptureMode(.application(app))

            // Get all windows for this application
            let appWindows = content.windows.filter { window in
                window.owningApplication?.processID == app.processID && window.isOnScreen && window.frame
                    .width > 1 && window.frame.height > 1
            }

            guard !appWindows.isEmpty else {
                logger.warning("No capturable windows found for application: \(app.applicationName)")
                throw ScreencapError.windowNotFound(0)
            }

            logger
                .info(
                    "Capturing application \(app.applicationName) with \(appWindows.count) windows"
                )

        default:
            throw ScreencapError.invalidCaptureType
        }

        // Build filter using CaptureConfigurationBuilder
        captureFilter = try configBuilder.buildFilter()

        // Configure stream
        guard let filter = captureFilter else {
            logger.error("Capture filter is nil")
            throw ScreencapError.invalidConfiguration
        }

        // Build configuration using CaptureConfigurationBuilder
        let streamConfig = try configBuilder.buildConfiguration(for: filter)

        // Log final stream configuration for debugging
        logger.info("📊 Final stream configuration:")
        logger.info("  - Output size: \(streamConfig.width)x\(streamConfig.height) pixels")
        logger.info("  - Pixel format: \(streamConfig.pixelFormat) (32BGRA = \(kCVPixelFormatType_32BGRA))")
        logger.info("  - Source rect: \(String(describing: streamConfig.sourceRect))")
        logger.info("  - Destination rect: \(String(describing: streamConfig.destinationRect))")
        logger.info("  - Scales to fit: \(streamConfig.scalesToFit)")
        logger.info("  - Shows cursor: \(streamConfig.showsCursor)")
        logger.info("  - FPS: 30")

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
            logger.info("📺 Stream is now active and should be producing frames")

            // Transition to capturing state
            stateMachine.processEvent(.captureStarted)

            // Start WebRTC if enabled
            if useWebRTC {
                logger.info("🌐 Starting WebRTC capture...")
                await startWebRTCCapture(use8k: use8k)
            } else {
                logger.info("🖼️ Using JPEG mode (WebRTC disabled)")
            }
        } catch {
            logger.error("Failed to start capture: \(error)")
            captureStream = nil

            // Transition to error state
            stateMachine.processEvent(.captureFailure(error))

            throw ScreencapError.failedToStartCapture(error)
        }
    }

    /// Start capture for a specific window by its cgWindowID
    func startCaptureWindow(cgWindowID: Int, useWebRTC: Bool = false, use8k: Bool = false) async throws {
        logger.info("Starting window capture - cgWindowID: \(cgWindowID), WebRTC: \(useWebRTC), 8K: \(use8k)")

        self.useWebRTC = useWebRTC

        // Stop any existing capture
        await stopCapture()

        // If we're still idle, try to connect first
        if stateMachine.currentState == .idle {
            logger.info("📊 Service in idle state, attempting to connect first")
            try await connectForApiHandling()
        }

        // Wait for state machine to settle if we just stopped
        if stateMachine.currentState == .stopping {
            logger.info("📊 Waiting for stop to complete...")
            var attempts = 0
            while stateMachine.currentState == .stopping && attempts < 20 {
                try await Task.sleep(nanoseconds: 50_000_000) // 50ms
                attempts += 1
            }
        }

        // Check if we can start capture
        guard stateMachine.canPerformAction(.startCapture) else {
            logger.error("Cannot start window capture in state: \(self.stateMachine.currentState)")
            logger.error("📊 Current state description: \(self.stateMachine.stateDescription())")
            throw ScreencapError.serviceNotReady
        }

        logger.debug("Requesting shareable content...")
        let content: SCShareableContent
        do {
            content = try await SCShareableContent.current
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
        self.captureMode = .window(window)

        // Transition to starting state
        stateMachine.processEvent(.startCapture(mode: .window(window), useWebRTC: useWebRTC))

        logger
            .info(
                "🪟 Capturing window: '\(window.title ?? "Untitled")' - size: \(window.frame.width)x\(window.frame.height)"
            )

        // Create configuration builder
        let configBuilder = CaptureConfigurationBuilder(shareableContent: content)
            .setFrameRate(30)
            .setShowsCursor(true)
            .setCapturesAudio(false)
            .setUse8K(use8k)
            .setCaptureMode(.window(window))

        // Build filter and configuration
        captureFilter = try configBuilder.buildFilter()

        guard let filter = captureFilter else {
            logger.error("Capture filter is nil")
            throw ScreencapError.invalidConfiguration
        }

        let streamConfig = try configBuilder.buildConfiguration(for: filter)

        // Log final stream configuration for debugging
        logger.info("📊 Final stream configuration:")
        logger.info("  - Output size: \(streamConfig.width)x\(streamConfig.height) pixels")
        // Source and destination rectangles are handled by the content filter
        logger.info("  - Scales to fit: \(streamConfig.scalesToFit)")
        logger.info("  - Shows cursor: \(streamConfig.showsCursor)")
        logger.info("  - FPS: 30")

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

            // Transition to capturing state
            stateMachine.processEvent(.captureStarted)

            // Start WebRTC if enabled
            if useWebRTC {
                logger.info("🌐 Starting WebRTC capture...")
                await startWebRTCCapture(use8k: use8k)
            } else {
                logger.info("🖼️ Using JPEG mode (WebRTC disabled)")
            }
        } catch {
            logger.error("Failed to start capture: \(error)")
            captureStream = nil

            // Transition to error state
            stateMachine.processEvent(.captureFailure(error))

            throw ScreencapError.failedToStartCapture(error)
        }
    }

    private func startWebRTCCapture(use8k: Bool) async {
        logger.info("🌐 startWebRTCCapture called")
        do {
            // The WebRTC manager is already initialized.
            // We just need to set the quality and start the capture.
            webRTCManager?.setQuality(use8k: use8k)

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
            logger.info("🚀 Calling WebRTC manager startCapture with mode: \(modeString)")
            try await webRTCManager?.startCapture(mode: modeString)

            logger.info("✅ WebRTC capture started successfully")
        } catch {
            logger.error("❌ Failed to start WebRTC capture: \(error)")
            logger.error("🔄 Falling back to JPEG mode")
            // Continue with JPEG mode
            self.useWebRTC = false
        }
    }

    /// Stop current capture
    func stopCapture() async {
        guard isCapturing else { return }

        // Transition to stopping state
        if stateMachine.currentState == .capturing {
            stateMachine.processEvent(.stopCapture)
        }

        // Mark as not capturing first to stop frame processing
        isCapturing = false

        // Store references before clearing
        let stream = captureStream

        // Clear references
        captureStream = nil
        currentFrame = nil
        frameCounter = 0

        // Wait a bit for any in-flight frames to complete
        try? await Task.sleep(nanoseconds: 100_000_000) // 100ms

        // Stop WebRTC if active
        if let webRTC = webRTCManager {
            await webRTC.stopCapture()
        }

        // Stop the stream
        if let stream {
            do {
                try await stream.stopCapture()
                logger.info("Stopped capture")
            } catch {
                logger.error("Failed to stop capture: \(error)")
            }
        }

        // Transition to stopped state
        stateMachine.processEvent(.captureStopped)

        // Give the state machine time to complete the transition
        try? await Task.sleep(nanoseconds: 50_000_000) // 50ms
    }

    /// Get current captured frame as JPEG data
    func getCurrentFrame() -> Data? {
        logger.info("🖼️ getCurrentFrame() called")
        guard isCapturing else {
            logger.warning("⚠️ Not capturing, cannot get frame")
            return nil
        }

        guard let frame = currentFrame else {
            logger.warning("⚠️ currentFrame is nil, no frame available to send")
            return nil
        }

        logger.info("✅ Frame is available, preparing JPEG data...")
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

        logger.info("✅ JPEG data created successfully (\(jpegData.count) bytes)")
        return jpegData
    }

    /// Get current capture state information
    func getCaptureState() -> (state: String, description: String) {
        (
            state: stateMachine.currentState.rawValue,
            description: stateMachine.stateDescription()
        )
    }

    /// Send click at specified coordinates
    /// - Parameters:
    ///   - x: X coordinate in 0-1000 normalized range
    ///   - y: Y coordinate in 0-1000 normalized range
    ///   - cgWindowID: Optional window ID for window-specific clicks
    func sendClick(x: Double, y: Double, cgWindowID: Int? = nil) async throws {
        // Check accessibility permission first
        let hasAccessibility = AXIsProcessTrusted()
        logger.info("🔐 [DEBUG] Accessibility permission status: \(hasAccessibility)")

        if !hasAccessibility {
            logger.error("❌ Cannot send mouse click - Accessibility permission not granted")
            logger
                .error("💡 Please grant Accessibility permission in System Settings > Privacy & Security > Accessibility"
                )
            throw ScreencapError.permissionDenied
        }

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

        // CGEvent uses NSScreen coordinates (bottom-left origin)
        // But SCDisplay uses top-left origin, so we need to flip Y
        let screenHeight = NSScreen.screens.first?.frame.height ?? 1_080
        let flippedY = screenHeight - pixelY
        let clickLocation = CGPoint(x: pixelX, y: flippedY)

        // Log the current mouse position for debugging
        let currentMouseLocation = NSEvent.mouseLocation
        logger
            .info(
                "🖱️ Current mouse position: (\(String(format: "%.1f", currentMouseLocation.x)), \(String(format: "%.1f", currentMouseLocation.y)))"
            )

        // Also log screen information for debugging
        if let mainScreen = NSScreen.main {
            logger
                .info(
                    "🖥️ Main screen frame: origin=(\(mainScreen.frame.origin.x), \(mainScreen.frame.origin.y)), size=(\(mainScreen.frame.width)x\(mainScreen.frame.height)) (backing scale: \(mainScreen.backingScaleFactor))"
                )
        }

        logger
            .info(
                "🎯 Final click location: (\(String(format: "%.1f", clickLocation.x)), \(String(format: "%.1f", clickLocation.y))) [original Y: \(String(format: "%.1f", pixelY)), flipped Y: \(String(format: "%.1f", flippedY))]"
            )

        // Create an event source for better compatibility
        let eventSource = CGEventSource(stateID: .hidSystemState)

        // IMPORTANT: First move the mouse cursor to the target position
        // This ensures the cursor is at the correct location before clicking
        logger.info("🖱️ [DEBUG] Moving mouse cursor to position before clicking...")

        guard let mouseMove = CGEvent(
            mouseEventSource: eventSource,
            mouseType: .mouseMoved,
            mouseCursorPosition: clickLocation,
            mouseButton: .left
        ) else {
            throw ScreencapError.failedToCreateEvent
        }

        // Post the mouse move event
        mouseMove.post(tap: .cghidEventTap)

        // Small delay to ensure the move is processed
        try await Task.sleep(nanoseconds: 10_000_000) // 10ms delay

        // Verify the mouse actually moved
        let newMouseLocation = NSEvent.mouseLocation
        logger
            .info(
                "🖱️ [DEBUG] Mouse position after move: (\(String(format: "%.1f", newMouseLocation.x)), \(String(format: "%.1f", newMouseLocation.y)))"
            )

        // Create mouse down event
        guard let mouseDown = CGEvent(
            mouseEventSource: eventSource,
            mouseType: .leftMouseDown,
            mouseCursorPosition: clickLocation,
            mouseButton: .left
        ) else {
            throw ScreencapError.failedToCreateEvent
        }

        // Create mouse up event
        guard let mouseUp = CGEvent(
            mouseEventSource: eventSource,
            mouseType: .leftMouseUp,
            mouseCursorPosition: clickLocation,
            mouseButton: .left
        ) else {
            throw ScreencapError.failedToCreateEvent
        }

        // Set the click count to 1 for both events
        mouseDown.setIntegerValueField(.mouseEventClickState, value: 1)
        mouseUp.setIntegerValueField(.mouseEventClickState, value: 1)

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

        // Create an event source for better compatibility
        let eventSource = CGEventSource(stateID: .hidSystemState)

        // Create mouse down event
        guard let mouseDown = CGEvent(
            mouseEventSource: eventSource,
            mouseType: .leftMouseDown,
            mouseCursorPosition: clickLocation,
            mouseButton: .left
        ) else {
            throw ScreencapError.failedToCreateEvent
        }

        // Set the click state
        mouseDown.setIntegerValueField(.mouseEventClickState, value: 1)

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

        // Create an event source for better compatibility
        let eventSource = CGEventSource(stateID: .hidSystemState)

        // Create mouse dragged event
        guard let mouseDrag = CGEvent(
            mouseEventSource: eventSource,
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

        // Create an event source for better compatibility
        let eventSource = CGEventSource(stateID: .hidSystemState)

        // Create mouse up event
        guard let mouseUp = CGEvent(
            mouseEventSource: eventSource,
            mouseType: .leftMouseUp,
            mouseCursorPosition: clickLocation,
            mouseButton: .left
        ) else {
            throw ScreencapError.failedToCreateEvent
        }

        // Set the click state
        mouseUp.setIntegerValueField(.mouseEventClickState, value: 1)

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

        // Check environment variable to control Y-coordinate flipping
        let shouldFlipY = ProcessInfo.processInfo.environment["VIBETUNNEL_FLIP_Y"] != "false"
        let useWarpCursor = ProcessInfo.processInfo.environment["VIBETUNNEL_USE_WARP"] == "true"

        logger.info("🔍 [DEBUG] calculateClickLocation - Input: x=\(x), y=\(y)")
        logger.info("🔍 [DEBUG] Capture mode: \(String(describing: self.captureMode))")
        logger
            .info(
                "🔍 [DEBUG] Filter content rect: origin=(\(filter.contentRect.origin.x), \(filter.contentRect.origin.y)), size=(\(filter.contentRect.width)x\(filter.contentRect.height))"
            )
        logger.info("🔍 [DEBUG] Configuration: shouldFlipY=\(shouldFlipY), useWarpCursor=\(useWarpCursor)")

        // Convert from 0-1000 normalized coordinates to actual pixel coordinates
        let normalizedX = x / 1_000.0
        let normalizedY = y / 1_000.0

        logger
            .info(
                "🔍 [DEBUG] Normalized coordinates: x=\(String(format: "%.4f", normalizedX)), y=\(String(format: "%.4f", normalizedY))"
            )

        var pixelX: Double
        var pixelY: Double

        // Calculate pixel coordinates based on capture mode
        switch captureMode {
        case .desktop(let displayIndex):
            // Get SCShareableContent to ensure consistency
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)

            logger
                .info(
                    "🔍 [DEBUG] Desktop capture mode - Display index: \(displayIndex), Total displays: \(content.displays.count)"
                )

            if displayIndex >= 0 && displayIndex < content.displays.count {
                let display = content.displays[displayIndex]
                logger
                    .info(
                        "🔍 [DEBUG] Display frame: origin=(\(display.frame.origin.x), \(display.frame.origin.y)), size=(\(display.frame.width)x\(display.frame.height))"
                    )

                // Convert normalized to pixel coordinates within the display
                pixelX = display.frame.origin.x + (normalizedX * display.frame.width)
                pixelY = display.frame.origin.y + (normalizedY * display.frame.height)

                logger
                    .info(
                        "🔍 [DEBUG] Calculated pixel coords: x=\(String(format: "%.1f", pixelX)), y=\(String(format: "%.1f", pixelY))"
                    )
            } else {
                throw ScreencapError.noDisplay
            }

        case .allDisplays:
            // For all displays, we need to calculate based on the combined bounds
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)

            logger.info("🔍 [DEBUG] All displays capture mode - Total displays: \(content.displays.count)")

            // Calculate the bounding rectangle
            var minX = CGFloat.greatestFiniteMagnitude
            var minY = CGFloat.greatestFiniteMagnitude
            var maxX: CGFloat = -CGFloat.greatestFiniteMagnitude
            var maxY: CGFloat = -CGFloat.greatestFiniteMagnitude

            for display in content.displays {
                logger
                    .info(
                        "🔍 [DEBUG] Display: origin=(\(display.frame.origin.x), \(display.frame.origin.y)), size=(\(display.frame.width)x\(display.frame.height))"
                    )
                minX = min(minX, display.frame.origin.x)
                minY = min(minY, display.frame.origin.y)
                maxX = max(maxX, display.frame.origin.x + display.frame.width)
                maxY = max(maxY, display.frame.origin.y + display.frame.height)
            }

            let totalWidth = maxX - minX
            let totalHeight = maxY - minY

            logger
                .info(
                    "🔍 [DEBUG] Combined bounds: min=(\(minX), \(minY)), max=(\(maxX), \(maxY)), size=(\(totalWidth)x\(totalHeight))"
                )

            // Convert normalized to pixel coordinates within the combined bounds
            pixelX = minX + (normalizedX * totalWidth)
            pixelY = minY + (normalizedY * totalHeight)

            logger
                .info(
                    "🔍 [DEBUG] Calculated pixel coords: x=\(String(format: "%.1f", pixelX)), y=\(String(format: "%.1f", pixelY))"
                )

        case .window(let window):
            // For window capture, use the window's frame
            logger
                .info(
                    "🔍 [DEBUG] Window capture mode - Window frame: origin=(\(window.frame.origin.x), \(window.frame.origin.y)), size=(\(window.frame.width)x\(window.frame.height))"
                )

            pixelX = window.frame.origin.x + (normalizedX * window.frame.width)
            pixelY = window.frame.origin.y + (normalizedY * window.frame.height)

            logger
                .info(
                    "🔍 [DEBUG] Calculated pixel coords: x=\(String(format: "%.1f", pixelX)), y=\(String(format: "%.1f", pixelY))"
                )

        case .application:
            // For application capture, use the filter's content rect
            logger
                .info(
                    "🔍 [DEBUG] Application capture mode - Filter content rect: origin=(\(filter.contentRect.origin.x), \(filter.contentRect.origin.y)), size=(\(filter.contentRect.width)x\(filter.contentRect.height))"
                )

            pixelX = filter.contentRect.origin.x + (normalizedX * filter.contentRect.width)
            pixelY = filter.contentRect.origin.y + (normalizedY * filter.contentRect.height)

            logger
                .info(
                    "🔍 [DEBUG] Calculated pixel coords: x=\(String(format: "%.1f", pixelX)), y=\(String(format: "%.1f", pixelY))"
                )
        }

        // Log coordinate system information
        logger.info("🔍 [DEBUG] Coordinate system information:")
        logger.info("🔍 [DEBUG] SCDisplay uses top-left origin, NSEvent/CGEvent uses bottom-left origin")
        logger.info("🔍 [DEBUG] shouldFlipY=\(shouldFlipY) (set VIBETUNNEL_FLIP_Y=false to disable)")
        logger.info("🔍 [DEBUG] useWarpCursor=\(useWarpCursor) (set VIBETUNNEL_USE_WARP=true to enable)")

        // Log all screen information
        for (index, screen) in NSScreen.screens.enumerated() {
            logger
                .info(
                    "🔍 [DEBUG] Screen \(index): frame=origin(\(screen.frame.origin.x), \(screen.frame.origin.y)), size=(\(screen.frame.width)x\(screen.frame.height)), backing scale=\(screen.backingScaleFactor)"
                )
        }

        var finalX = pixelX
        var finalY = pixelY

        if shouldFlipY {
            // IMPORTANT: For multi-monitor setups, we need to find the screen that contains our click point
            var targetScreen: NSScreen?
            for screen in NSScreen.screens {
                let screenFrame = screen.frame
                if pixelX >= screenFrame.origin.x && pixelX <= screenFrame.origin.x + screenFrame.width &&
                    pixelY >= screenFrame.origin.y && pixelY <= screenFrame.origin.y + screenFrame.height
                {
                    targetScreen = screen
                    logger
                        .info(
                            "🔍 [DEBUG] Found target screen containing click point: frame=(\(screenFrame.origin.x), \(screenFrame.origin.y), \(screenFrame.width), \(screenFrame.height))"
                        )
                    break
                }
            }

            // If no screen found, use the main screen
            if targetScreen == nil {
                targetScreen = NSScreen.main ?? NSScreen.screens.first
                logger.warning("⚠️ [DEBUG] No screen contains click point, using main screen")
            }

            guard let screen = targetScreen else {
                logger.error("❌ [DEBUG] No screen available")
                throw ScreencapError.noDisplay
            }

            // Calculate the correct Y coordinate flip relative to the target screen
            let screenHeight = screen.frame.height
            let screenOriginY = screen.frame.origin.y

            // For NSScreen coordinates, we need to flip Y relative to the screen's coordinate system
            // SCDisplay uses top-left origin, NSEvent uses bottom-left origin
            let relativeY = pixelY - screenOriginY // Y position relative to the screen's top
            let flippedY = screenOriginY + (screenHeight - relativeY) // Flip Y within the screen

            finalY = flippedY

            logger
                .info(
                    "🔍 [DEBUG] Y-flip calculation: screenHeight=\(screenHeight), screenOriginY=\(screenOriginY), relativeY=\(relativeY)"
                )
            logger
                .info(
                    "📐 [DEBUG] Y-coordinate flipping: pixel Y: \(String(format: "%.1f", pixelY)) → flipped Y: \(String(format: "%.1f", flippedY))"
                )
        } else {
            logger.info("🔍 [DEBUG] Y-coordinate flipping DISABLED - using pixel coordinates directly")
            logger
                .info(
                    "🔍 [DEBUG] Direct pixel coordinates: x=\(String(format: "%.1f", pixelX)), y=\(String(format: "%.1f", pixelY))"
                )
        }

        logger
            .info(
                "🎯 [DEBUG] Final coordinates: x=\(String(format: "%.1f", finalX)), y=\(String(format: "%.1f", finalY))"
            )

        // Test CGWarpMouseCursorPosition if enabled
        if useWarpCursor {
            logger
                .info(
                    "🔍 [DEBUG] Testing CGWarpMouseCursorPosition with coordinates: x=\(String(format: "%.1f", finalX)), y=\(String(format: "%.1f", finalY))"
                )
            let warpResult = CGWarpMouseCursorPosition(CGPoint(x: finalX, y: finalY))
            logger
                .info(
                    "🔍 [DEBUG] CGWarpMouseCursorPosition result: \(warpResult == CGError.success ? "SUCCESS" : "FAILED with error \(warpResult.rawValue)")"
                )
        }

        return CGPoint(x: finalX, y: finalY)
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

    // MARK: - State Machine Setup

    /// Configure state machine callbacks
    private func setupStateMachine() {
        stateMachine.onStateChange = { [weak self] newState, previousState in
            guard let self else { return }
            self.logger.info("📊 State changed: \(previousState?.description ?? "nil") → \(newState)")

            // Notify WebRTC manager of state changes
            if let webRTCManager = self.webRTCManager {
                Task {
                    let message = ControlProtocol.createEvent(
                        category: .screencap,
                        action: "state-change",
                        payload: [
                            "state": newState.rawValue,
                            "previousState": previousState?.rawValue as Any
                        ]
                    )
                    await webRTCManager.sendControlMessage(message)
                }
            }
        }
    }

    // MARK: - Display Monitoring

    /// Set up notifications for display configuration changes
    private func setupDisplayNotifications() {
        // Monitor for display configuration changes
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(displayConfigurationChanged),
            name: NSApplication.didChangeScreenParametersNotification,
            object: nil
        )

        logger.info("📺 Display monitoring enabled")
    }

    /// Handle display configuration changes
    @objc
    private func displayConfigurationChanged(_ notification: Notification) {
        logger.warning("⚠️ Display configuration changed")

        // Check if we're currently capturing
        guard isCapturing else {
            logger.info("Not capturing, ignoring display change")
            return
        }

        Task { @MainActor in
            await handleDisplayChange()
        }
    }

    /// Handle display disconnection or reconfiguration during capture
    private func handleDisplayChange() async {
        logger.info("🔄 Handling display configuration change during capture")

        // Transition to reconnecting state
        stateMachine.processEvent(.displayChanged)

        // Get current capture mode
        let captureMode = self.captureMode

        // Stop current capture
        await stopCapture()

        // Wait a moment for the system to stabilize
        try? await Task.sleep(nanoseconds: 500_000_000) // 0.5 seconds

        do {
            // Check if displays are still available
            let displays = try await getDisplays()

            switch captureMode {
            case .desktop(let displayIndex):
                // Check if the display index is still valid
                if displayIndex < displays.count {
                    // Restart capture with same display
                    logger.info("✅ Display \(displayIndex) still available, restarting capture")
                    try await startCapture(type: "display", index: displayIndex, useWebRTC: useWebRTC)
                } else if !displays.isEmpty {
                    // Fall back to primary display
                    logger.warning("⚠️ Display \(displayIndex) no longer available, falling back to primary display")
                    try await startCapture(type: "display", index: 0, useWebRTC: useWebRTC)
                } else {
                    logger.error("❌ No displays available after configuration change")
                    // Notify connected clients
                    await notifyDisplayDisconnected()
                }

            case .window:
                // For window capture, try to restart with the same window
                if let window = selectedWindow {
                    do {
                        // Verify window still exists
                        let content = try await SCShareableContent.current
                        if content.windows.contains(where: { $0.windowID == window.windowID }) {
                            logger.info("✅ Window still available, restarting capture")
                            try await startCaptureWindow(cgWindowID: Int(window.windowID), useWebRTC: useWebRTC)
                        } else {
                            logger.warning("⚠️ Window no longer available after display change")
                            await notifyWindowDisconnected()
                        }
                    } catch {
                        logger.error("Failed to verify window availability: \(error)")
                        await notifyWindowDisconnected()
                    }
                }

            case .allDisplays:
                // For all displays mode, just restart
                logger.info("🔄 Restarting all displays capture after configuration change")
                try await startCapture(type: "display", index: -1, useWebRTC: useWebRTC)

            case .application:
                // For application capture, try to restart with the same application
                logger.info("🔄 Application capture mode - checking if still available")
                // For now, just notify that the display configuration changed
                await notifyDisplayDisconnected()
            }
        } catch {
            logger.error("❌ Failed to handle display change: \(error)")
            await notifyDisplayDisconnected()
        }
    }

    /// Notify connected clients that display was disconnected
    private func notifyDisplayDisconnected() async {
        if let webRTCManager {
            let message = ControlProtocol.createEvent(
                category: .screencap,
                action: "display-disconnected",
                payload: ["message": "Display disconnected during capture"]
            )
            await webRTCManager.sendControlMessage(message)
        }
    }

    /// Notify connected clients that window was disconnected
    private func notifyWindowDisconnected() async {
        if let webRTCManager {
            let message = ControlProtocol.createEvent(
                category: .screencap,
                action: "window-disconnected",
                payload: ["message": "Window closed or became unavailable"]
            )
            await webRTCManager.sendControlMessage(message)
        }
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

        // Track frame reception - log first frame and then periodically
        // Use random sampling to avoid concurrency issues
        let shouldLog = Int.random(in: 0..<300) == 0

        // Log sample buffer format details
        if let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer) {
            _ = CMFormatDescriptionGetMediaType(formatDesc)
            let mediaSubType = CMFormatDescriptionGetMediaSubType(formatDesc)
            let dimensions = CMVideoFormatDescriptionGetDimensions(formatDesc)

            // Only log occasionally to reduce noise
            if shouldLog {
                Task { @MainActor in
                    self.logger.info("📊 Frame received - dimensions: \(dimensions.width)x\(dimensions.height)")
                    self.logger.info("🎨 Pixel format: \(String(format: "0x%08X", mediaSubType))")
                    // Mark that we're receiving frames
                    if self.frameCounter == 0 {
                        self.logger.info("🎬 FIRST FRAME RECEIVED!")
                    }
                    self.frameCounter += 1
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
        if useWebRTC, let webRTCManager {
            // The processVideoFrame method is nonisolated and accepts a sending parameter
            // We can call it directly without creating a Task, avoiding the closure capture issue
            webRTCManager.processVideoFrameSync(sampleBuffer)

            // Log occasionally
            if shouldLog {
                Task { @MainActor in
                    self.logger.info("🌐 Forwarding frame to WebRTC manager")
                }
            }
        } else if shouldLog {
            Task { @MainActor in
                self.logger.info("🖼️ WebRTC disabled - using JPEG mode")
            }
        }

        // Create CIImage and process for display
        // Only create and process if we have a valid pixel buffer
        guard CVPixelBufferGetWidth(pixelBuffer) > 0 && CVPixelBufferGetHeight(pixelBuffer) > 0 else {
            return
        }

        // Convert to CGImage in the nonisolated context
        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        let context = CIContext()

        // Check extent is valid
        guard !ciImage.extent.isEmpty else {
            // Skip frame with empty extent
            return
        }

        guard let cgImage = context.createCGImage(ciImage, from: ciImage.extent) else {
            // Failed to create CGImage
            return
        }

        Task { @MainActor [weak self] in
            guard let self else { return }
            await self.processFrameWithCGImage(cgImage)
        }
    }

    /// Separate async function to handle frame processing
    @MainActor
    private func processFrameWithCGImage(_ cgImage: CGImage) async {
        // Check if we're still capturing before processing
        guard isCapturing else {
            logger.debug("Skipping frame processing - capture stopped")
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
