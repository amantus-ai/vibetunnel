import Foundation
@preconcurrency import ScreenCaptureKit
@preconcurrency import CoreMedia
import CoreGraphics
import CoreImage
import AppKit
import OSLog

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
    private var frameCounter: Int = 0
    
    // WebRTC support
    private var webRTCManager: WebRTCManager?
    private var useWebRTC = false
    
    // MARK: - Types
    
    enum CaptureMode {
        case desktop(displayIndex: Int = 0)
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
        let screens = NSScreen.screens
        guard !screens.isEmpty else {
            throw ScreencapError.noDisplay
        }
        
        return screens.enumerated().map { index, screen in
            DisplayInfo(
                id: "\(index)",
                width: Int(screen.frame.width),
                height: Int(screen.frame.height),
                scaleFactor: screen.backingScaleFactor,
                refreshRate: Double(screen.maximumFramesPerSecond),
                x: screen.frame.origin.x,
                y: screen.frame.origin.y,
                name: screen.localizedName
            )
        }
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
            // Use display index if provided, otherwise default to first display
            let displayIndex = index < content.displays.count ? index : 0
            guard displayIndex < content.displays.count else {
                throw ScreencapError.noDisplay
            }
            let display = content.displays[displayIndex]
            captureMode = .desktop(displayIndex: displayIndex)
            currentDisplayIndex = displayIndex
            captureFilter = SCContentFilter(
                display: display,
                excludingWindows: []
            )
            
        case "window":
            guard index < content.windows.count else {
                throw ScreencapError.invalidWindowIndex
            }
            let window = content.windows[index]
            selectedWindow = window
            captureMode = .window(window)
            
            // Create filter for window capture
            guard let display = content.displays.first else {
                throw ScreencapError.noDisplay
            }
            captureFilter = SCContentFilter(
                display: display,
                including: [window]
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
        streamConfig.width = Int(filter.contentRect.width)
        streamConfig.height = Int(filter.contentRect.height)
        streamConfig.minimumFrameInterval = CMTime(value: 1, timescale: 30) // 30 FPS
        streamConfig.queueDepth = 3
        streamConfig.showsCursor = true
        streamConfig.capturesAudio = false
        streamConfig.pixelFormat = kCVPixelFormatType_32BGRA
        
        // Ensure we get raw pixel buffers, not compressed frames
        streamConfig.colorSpaceName = CGColorSpace.sRGB
        streamConfig.scalesToFit = false
        streamConfig.preservesAspectRatio = true
        
        logger.info("Stream config - size: \(streamConfig.width)x\(streamConfig.height), fps: 30")
        
        // Create and start stream
        let stream = SCStream(filter: filter, configuration: streamConfig, delegate: self)
        captureStream = stream
        
        // Add output and start capture
        do {
            try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: frameQueue)
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
    func sendClick(x: Double, y: Double, cgWindowID: Int? = nil) async throws {
        var adjustedX = x
        var adjustedY = y
        
        // If capturing a specific display, adjust coordinates based on display origin
        if case .desktop(let displayIndex) = captureMode {
            let screens = NSScreen.screens
            if displayIndex < screens.count {
                let screen = screens[displayIndex]
                adjustedX += screen.frame.origin.x
                adjustedY += screen.frame.origin.y
            }
        }
        
        let clickLocation = CGPoint(x: adjustedX, y: adjustedY)
        
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
        
        logger.info("Sent click at screen coordinates (\(adjustedX), \(adjustedY))")
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
            return 
        }
        
        // Process the frame asynchronously to avoid blocking the stream
        // Use detached task to avoid capturing context
        Task.detached { [weak self] in
            await self?.processFrame(sampleBuffer)
        }
    }
    
    // Separate async function to handle frame processing
    private func processFrame(_ sampleBuffer: sending CMSampleBuffer) async {
        // Extract CGImage from sample buffer
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            // This can happen if the buffer contains encoded data instead of raw pixels
            // Log only occasionally to avoid spam
            await MainActor.run { [weak self] in
                guard let self = self else { return }
                if self.frameCounter % 30 == 0 { // Log once per second at 30fps
                    self.logger.debug("Sample buffer does not contain pixel buffer (possibly encoded data)")
                }
            }
            return
        }
        
        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        let context = CIContext()
        guard let cgImage = context.createCGImage(ciImage, from: ciImage.extent) else {
            await MainActor.run { [weak self] in
                self?.logger.error("Failed to create CGImage from CIImage")
            }
            return
        }
        
        // Check if WebRTC is enabled and process frame
        await MainActor.run { [weak self] in
            guard let self = self else { return }
            
            // Update current frame
            self.currentFrame = cgImage
            let frameCount = self.frameCounter
            self.frameCounter += 1
            
            // Log only every 300 frames (10 seconds at 30fps) to reduce noise
            if frameCount % 300 == 0 {
                self.logger.info("📹 Frame \(frameCount) received")
            }
        }
        
        // Process WebRTC frame if enabled
        let (useWebRTC, webRTCManager) = await MainActor.run { [weak self] in
            (self?.useWebRTC ?? false, self?.webRTCManager)
        }
        
        if useWebRTC, let webRTCManager = webRTCManager {
            // Only process frames that have pixel buffers for WebRTC
            // The sending parameter safely transfers ownership
            await webRTCManager.processVideoFrame(sampleBuffer)
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