import Foundation
@preconcurrency import ScreenCaptureKit
@preconcurrency import CoreMedia
import CoreGraphics
import CoreImage
import AppKit
import OSLog
import VideoToolbox

/// Service that provides screen capture functionality with HTTP API
@preconcurrency @MainActor
public final class ScreencapService: NSObject {
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "ScreencapService")
    
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
    private var webRTCManager: WebRTCManager?
    private var useWebRTC = false
    private var decompressionSession: VTDecompressionSession?
    
    // MARK: - Types
    
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
    }
    
    // MARK: - Public Methods
    
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
               appName.lowercased().contains("vibetunnel") {
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
            logger.info("Got shareable content - displays: \(content.displays.count), windows: \(content.windows.count), apps: \(content.applications.count)")
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
                
                // Use the method that Federico found works - include all apps
                captureFilter = SCContentFilter(
                    display: primaryDisplay,
                    including: content.applications,
                    exceptingWindows: []
                )
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
                logger.info("📺 Capturing display \(displayIndex) of \(content.displays.count) - size: \(display.width)x\(display.height)")
                
                // Use the method that Federico found works - include all apps
                captureFilter = SCContentFilter(
                    display: display,
                    including: content.applications,
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
            
            logger.info("🪟 Capturing window: '\(window.title ?? "Untitled")' - size: \(window.frame.width)x\(window.frame.height)")
            
            // For window capture, we need to find which display contains this window
            let windowDisplay = content.displays.first { display in
                // Check if window's frame intersects with display's frame
                return display.frame.intersects(window.frame)
            } ?? content.displays.first
            
            guard let display = windowDisplay else {
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
            var minX: CGFloat = CGFloat.greatestFiniteMagnitude
            var minY: CGFloat = CGFloat.greatestFiniteMagnitude
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
            
            streamConfig.width = Int(totalWidth)
            streamConfig.height = Int(totalHeight)
            
            // Set the source rect to capture all displays
            streamConfig.sourceRect = CGRect(x: minX, y: minY, width: totalWidth, height: totalHeight)
        } else if case .window(let window) = captureMode {
            // For window capture, use the window's bounds
            streamConfig.width = Int(window.frame.width)
            streamConfig.height = Int(window.frame.height)
            logger.info("🪟 Window stream config - size: \(streamConfig.width)x\(streamConfig.height)")
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
        
        // No scaling to maintain quality
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
    
    private func startWebRTCCapture() async {
        do {
            // Get server URL from environment or use default
            let serverURLString = ProcessInfo.processInfo.environment["VIBETUNNEL_SERVER_URL"] ?? "http://localhost:4020"
            guard let serverURL = URL(string: serverURLString) else {
                logger.error("Invalid server URL: \(serverURLString)")
                return
            }
            
            // Create WebRTC manager
            webRTCManager = WebRTCManager(serverURL: serverURL)
            
            // Start WebRTC capture
            let modeString: String
            switch captureMode {
            case .desktop(let index):
                modeString = "desktop-\(index)"
            case .allDisplays:
                modeString = "all-displays"
            case .window(_):
                modeString = "window"
            case .application(_):
                modeString = "application"
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
        if let webRTCManager = webRTCManager {
            await webRTCManager.stopCapture()
            self.webRTCManager = nil
        }
        
        if let stream = stream {
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
        guard let jpegData = context.jpegRepresentation(
            of: ciImage,
            colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
            options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.8]
        ) else {
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
        logger.info("🖱️ Received click at normalized coordinates: (\(x), \(y))")
        
        // Get the capture filter to determine actual dimensions
        guard let filter = captureFilter else {
            throw ScreencapError.notCapturing
        }
        
        // Convert from 0-1000 normalized coordinates to actual pixel coordinates
        let normalizedX = x / 1000.0
        let normalizedY = y / 1000.0
        
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
                
                logger.info("📺 Display \(displayIndex): pixel coords=(\(String(format: "%.1f", pixelX)), \(String(format: "%.1f", pixelY)))")
            } else {
                throw ScreencapError.noDisplay
            }
            
        case .allDisplays:
            // For all displays, we need to calculate based on the combined bounds
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            
            // Calculate the bounding rectangle
            var minX: CGFloat = CGFloat.greatestFiniteMagnitude
            var minY: CGFloat = CGFloat.greatestFiniteMagnitude
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
            
            logger.info("🖥️ All displays: pixel coords=(\(String(format: "%.1f", pixelX)), \(String(format: "%.1f", pixelY)))")
            
        case .window(let window):
            // For window capture, use the window's frame
            pixelX = window.frame.origin.x + (normalizedX * window.frame.width)
            pixelY = window.frame.origin.y + (normalizedY * window.frame.height)
            
            logger.info("🪟 Window: pixel coords=(\(String(format: "%.1f", pixelX)), \(String(format: "%.1f", pixelY)))")
            
        case .application(_):
            // For application capture, use the filter's content rect
            pixelX = filter.contentRect.origin.x + (normalizedX * filter.contentRect.width)
            pixelY = filter.contentRect.origin.y + (normalizedY * filter.contentRect.height)
        }
        
        // CGEvent uses screen coordinates which have top-left origin, same as our pixel coordinates
        let clickLocation = CGPoint(x: pixelX, y: pixelY)
        
        logger.info("🎯 Final click location: (\(String(format: "%.1f", clickLocation.x)), \(String(format: "%.1f", clickLocation.y)))")
        
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
    
    /// Send keyboard input
    func sendKey(key: String, metaKey: Bool = false, ctrlKey: Bool = false, altKey: Bool = false, shiftKey: Bool = false) async throws {
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
        case "a": return 0x00
        case "s": return 0x01
        case "d": return 0x02
        case "f": return 0x03
        case "h": return 0x04
        case "g": return 0x05
        case "z": return 0x06
        case "x": return 0x07
        case "c": return 0x08
        case "v": return 0x09
        case "b": return 0x0B
        case "q": return 0x0C
        case "w": return 0x0D
        case "e": return 0x0E
        case "r": return 0x0F
        case "y": return 0x10
        case "t": return 0x11
        case "1": return 0x12
        case "2": return 0x13
        case "3": return 0x14
        case "4": return 0x15
        case "6": return 0x16
        case "5": return 0x17
        case "=": return 0x18
        case "9": return 0x19
        case "7": return 0x1A
        case "-": return 0x1B
        case "8": return 0x1C
        case "0": return 0x1D
        case "]": return 0x1E
        case "o": return 0x1F
        case "u": return 0x20
        case "[": return 0x21
        case "i": return 0x22
        case "p": return 0x23
        case "l": return 0x25
        case "j": return 0x26
        case "'": return 0x27
        case "k": return 0x28
        case ";": return 0x29
        case "\\": return 0x2A
        case ",": return 0x2B
        case "/": return 0x2C
        case "n": return 0x2D
        case "m": return 0x2E
        case ".": return 0x2F
        case " ", "space": return 0x31
        case "enter", "return": return 0x24
        case "tab": return 0x30
        case "escape", "esc": return 0x35
        case "backspace", "delete": return 0x33
        case "arrowup", "up": return 0x7E
        case "arrowdown", "down": return 0x7D
        case "arrowleft", "left": return 0x7B
        case "arrowright", "right": return 0x7C
        default: return 0x00 // Default to 'a'
        }
    }
}

// MARK: - SCStreamDelegate

extension ScreencapService: SCStreamDelegate {
    nonisolated public func stream(_ stream: SCStream, didStopWithError error: Error) {
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
    nonisolated public func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen else {
            // Log other types occasionally
            if Int.random(in: 0..<100) == 0 {
                print("Received non-screen output type: \(type)")
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
                let mediaTypeString = String(format: "0x%08X", mediaType)
                let mediaSubTypeString = String(format: "0x%08X", mediaSubType)
                print("Sample buffer - mediaType: \(mediaTypeString), subType: \(mediaSubTypeString), dimensions: \(dimensions.width)x\(dimensions.height)")
            }
        }
        
        // Check if sample buffer is ready
        if !CMSampleBufferDataIsReady(sampleBuffer) {
            print("Sample buffer data is not ready")
            return
        }
        
        // Get pixel buffer immediately
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            // Log this issue but only occasionally
            if shouldLog {
                print("No pixel buffer available in sample buffer")
            }
            return
        }
        
        // We have a pixel buffer! Process it
        Task { [weak self] in
            guard let self = self else { return }
            
            // Check if WebRTC is enabled on MainActor
            let (useWebRTC, webRTCManager) = await MainActor.run {
                (self.useWebRTC, self.webRTCManager)
            }
            
            // Handle WebRTC if enabled
            if useWebRTC, let webRTCManager = webRTCManager {
                // Process video frame directly with the sample buffer
                await webRTCManager.processVideoFrame(sampleBuffer)
            }
            
            // For regular display, create CIImage
            let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
            await MainActor.run { [weak self] in
                guard let self = self else { return }
                Task {
                    await self.processFrame(ciImage: ciImage)
                }
            }
        }
    }
    
    
    // Separate async function to handle frame processing
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
        if frameCount % 300 == 0 {
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
    
    var errorDescription: String? {
        switch self {
        case .noDisplay:
            return "No display available"
        case .invalidWindowIndex:
            return "Invalid window index"
        case .invalidApplicationIndex:
            return "Invalid application index"
        case .invalidCaptureType:
            return "Invalid capture type"
        case .failedToCreateEvent:
            return "Failed to create input event"
        case .notCapturing:
            return "Not currently capturing"
        case .failedToGetContent(let error):
            return "Failed to get screen content: \(error.localizedDescription)"
        case .invalidConfiguration:
            return "Invalid capture configuration"
        case .failedToStartCapture(let error):
            return "Failed to start capture: \(error.localizedDescription)"
        }
    }
}