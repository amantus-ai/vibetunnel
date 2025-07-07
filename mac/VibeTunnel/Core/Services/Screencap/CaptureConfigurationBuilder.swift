import AppKit
import CoreMedia
import Foundation
import OSLog
import ScreenCaptureKit

/// Builder for creating SCStreamConfiguration and SCContentFilter objects for screen capture
@MainActor
public final class CaptureConfigurationBuilder {
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "CaptureConfigurationBuilder")

    // Configuration properties
    private var captureMode: CaptureMode = .desktop(displayIndex: 0)
    private var frameRate: Int = 30
    private var showsCursor: Bool = true
    private var capturesAudio: Bool = false
    private var queueDepth: Int = 5
    private var use8k: Bool = false

    /// Content for filter creation
    private var shareableContent: SCShareableContent?

    // MARK: - Public Methods

    /// Initialize with shareable content
    public init(shareableContent: SCShareableContent) {
        self.shareableContent = shareableContent
    }

    /// Set the capture mode
    @discardableResult
    public func setCaptureMode(_ mode: CaptureMode) -> Self {
        self.captureMode = mode
        return self
    }

    /// Set frame rate (default: 30)
    @discardableResult
    public func setFrameRate(_ fps: Int) -> Self {
        self.frameRate = max(1, min(60, fps))
        return self
    }

    /// Set whether to show cursor (default: true)
    @discardableResult
    public func setShowsCursor(_ show: Bool) -> Self {
        self.showsCursor = show
        return self
    }

    /// Set whether to capture audio (default: false)
    @discardableResult
    public func setCapturesAudio(_ capture: Bool) -> Self {
        self.capturesAudio = capture
        return self
    }

    /// Set queue depth (default: 5)
    @discardableResult
    public func setQueueDepth(_ depth: Int) -> Self {
        self.queueDepth = max(1, min(10, depth))
        return self
    }

    /// Set whether to use 8K resolution (default: false)
    @discardableResult
    public func setUse8K(_ use8k: Bool) -> Self {
        self.use8k = use8k
        return self
    }

    /// Build the content filter for the capture mode
    public func buildFilter() throws -> SCContentFilter {
        guard let content = shareableContent else {
            throw ScreencapError.failedToGetContent(NSError(domain: "CaptureConfigurationBuilder", code: -1))
        }

        switch captureMode {
        case .desktop(let displayIndex):
            return try buildDesktopFilter(displayIndex: displayIndex, content: content)

        case .allDisplays:
            return try buildAllDisplaysFilter(content: content)

        case .window(let window):
            return try buildWindowFilter(window: window, content: content)

        case .application(let app):
            return try buildApplicationFilter(app: app, content: content)
        }
    }

    /// Build the stream configuration
    public func buildConfiguration(for filter: SCContentFilter) throws -> SCStreamConfiguration {
        let config = SCStreamConfiguration()

        // Calculate dimensions based on capture mode
        let dimensions = try calculateDimensions(for: filter)
        config.width = dimensions.width
        config.height = dimensions.height

        // Basic configuration
        config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(frameRate))
        config.queueDepth = queueDepth
        config.showsCursor = showsCursor
        config.capturesAudio = capturesAudio

        // CRITICAL: Set pixel format to get raw frames
        config.pixelFormat = kCVPixelFormatType_32BGRA

        // Configure scaling behavior
        configureScaling(config: config)

        // Set color space
        config.colorSpaceName = CGColorSpace.sRGB

        // Configure source and destination rectangles
        configureRectangles(config: config, filter: filter)

        logger.info("📊 Built stream configuration (using Apple's approach):")
        logger.info("  - Output size: \(config.width)x\(config.height) pixels")
        logger.info("  - Pixel format: \(self.fourCCToString(config.pixelFormat))")
        logger.info("  - Scales to fit: \(config.scalesToFit)")
        logger.info("  - Preserves aspect ratio: \(config.preservesAspectRatio)")
        logger.info("  - Shows cursor: \(config.showsCursor)")
        logger.info("  - FPS: \(self.frameRate) (interval: \(config.minimumFrameInterval.seconds)s)")
        logger.info("  - Queue depth: \(config.queueDepth)")
        logger.info("  - Color space: \(String(describing: config.colorSpaceName))")
        logger.info("  - Captures audio: \(config.capturesAudio)")

        return config
    }

    // MARK: - Private Filter Builders

    private func buildDesktopFilter(displayIndex: Int, content: SCShareableContent) throws -> SCContentFilter {
        if displayIndex == -1 {
            // Treat -1 as all displays
            return try buildAllDisplaysFilter(content: content)
        }

        guard displayIndex < content.displays.count else {
            throw ScreencapError.noDisplay
        }

        let display = content.displays[displayIndex]
        logger.info("📺 Building filter for display \(displayIndex)")
        logger.info("  - Display ID: \(display.displayID)")
        logger.info("  - Display size: \(display.width)x\(display.height) points")
        logger.info("  - Display frame: \(String(describing: display.frame))")
        logger.info("  - Scale factor: \(self.getScaleFactor(for: display))")

        // Create filter to capture entire display
        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
        if #available(macOS 14.2, *) {
            filter.includeMenuBar = true
            logger.info("  - Include menu bar: true")
        }

        logger.info("  - Filter content rect: \(String(describing: filter.contentRect))")
        logger.info("  - Filter point pixel scale: \(filter.pointPixelScale)")

        return filter
    }

    private func buildAllDisplaysFilter(content: SCShareableContent) throws -> SCContentFilter {
        guard let primaryDisplay = content.displays.first else {
            throw ScreencapError.noDisplay
        }

        logger.info("🖥️ Building filter for all displays")
        logger.info("  - Primary display ID: \(primaryDisplay.displayID)")
        logger.info("  - Primary display size: \(primaryDisplay.width)x\(primaryDisplay.height) points")
        logger.info("  - Primary display frame: \(String(describing: primaryDisplay.frame))")
        logger.info("  - Total displays: \(content.displays.count)")

        for (index, display) in content.displays.enumerated() {
            logger.info("  - Display \(index): ID=\(display.displayID), frame=\(String(describing: display.frame))")
        }

        // Create filter that includes all displays
        let filter = SCContentFilter(
            display: primaryDisplay,
            excludingApplications: [],
            exceptingWindows: []
        )

        logger.info("  - Filter content rect: \(String(describing: filter.contentRect))")
        logger.info("  - Filter point pixel scale: \(filter.pointPixelScale)")

        return filter
    }

    private func buildWindowFilter(window: SCWindow, content: SCShareableContent) throws -> SCContentFilter {
        logger.info("🪟 Building filter for window: '\(window.title ?? "Untitled")'")
        logger.info("  - Window ID: \(window.windowID)")
        logger.info("  - Window frame: \(String(describing: window.frame))")
        logger.info("  - Window layer: \(window.windowLayer)")
        logger.info("  - Is on screen: \(window.isOnScreen)")
        logger.info("  - Owning app: \(window.owningApplication?.applicationName ?? "Unknown")")

        // Solution 1: Use Apple's desktopIndependentWindow method
        logger.info("  - Using desktopIndependentWindow filter (Apple's method)")
        let filter = SCContentFilter(desktopIndependentWindow: window)

        logger.info("  - Filter content rect: \(String(describing: filter.contentRect))")
        logger.info("  - Filter point pixel scale: \(filter.pointPixelScale)")

        return filter
    }

    private func buildApplicationFilter(
        app: SCRunningApplication,
        content: SCShareableContent
    )
        throws -> SCContentFilter
    {
        // Get all windows for this application
        let appWindows = content.windows.filter { window in
            window.owningApplication?.processID == app.processID &&
                window.isOnScreen &&
                window.frame.width > 1 &&
                window.frame.height > 1
        }

        guard !appWindows.isEmpty else {
            logger.warning("No capturable windows found for application: \(app.applicationName)")
            throw ScreencapError.windowNotFound(0)
        }

        // Find the display that contains the largest window
        let largestWindow = appWindows.max { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }
        let displayForCapture = content.displays.first { $0.frame.intersects(largestWindow?.frame ?? .zero) }

        guard let display = displayForCapture else {
            throw ScreencapError.noDisplay
        }

        logger.info("📱 Building filter for application \(app.applicationName) with \(appWindows.count) windows")

        return SCContentFilter(display: display, including: appWindows)
    }

    // MARK: - Private Dimension Calculation

    private func calculateDimensions(for filter: SCContentFilter) throws -> (width: Int, height: Int) {
        guard let content = shareableContent else {
            throw ScreencapError.failedToGetContent(NSError(domain: "CaptureConfigurationBuilder", code: -1))
        }

        logger.info("💫 Calculating dimensions for capture mode")

        let dimensions: (width: Int, height: Int)
        switch captureMode {
        case .allDisplays:
            dimensions = calculateAllDisplaysDimensions(content: content)
            logger.info("  - All displays dimensions: \(dimensions.width)x\(dimensions.height)")

        case .window(let window):
            dimensions = calculateWindowDimensions(window: window)
            logger
                .info("  - Window '\(window.title ?? "Untitled")' dimensions: \(dimensions.width)x\(dimensions.height)")

        case .desktop(let displayIndex):
            dimensions = calculateDesktopDimensions(displayIndex: displayIndex, content: content)
            logger.info("  - Desktop \(displayIndex) dimensions: \(dimensions.width)x\(dimensions.height)")

        case .application:
            dimensions = calculateApplicationDimensions(filter: filter, content: content)
            logger.info("  - Application dimensions: \(dimensions.width)x\(dimensions.height)")
        }

        // Limit resolution to 4K to prevent web interface clipping on high-res displays
        let limitedDimensions = limitTo4K(width: dimensions.width, height: dimensions.height)
        if limitedDimensions.width != dimensions.width || limitedDimensions.height != dimensions.height {
            logger.info("  - Limited to 4K: \(limitedDimensions.width)x\(limitedDimensions.height)")
        }

        return limitedDimensions
    }
    
    private func limitTo4K(width: Int, height: Int) -> (width: Int, height: Int) {
        let max4KWidth = 3840
        let max4KHeight = 2160
        
        // If already within 4K bounds, return as is
        if width <= max4KWidth && height <= max4KHeight {
            return (width, height)
        }
        
        // Calculate scale factor to fit within 4K bounds while maintaining aspect ratio
        let widthScale = Double(max4KWidth) / Double(width)
        let heightScale = Double(max4KHeight) / Double(height)
        let scale = min(widthScale, heightScale)
        
        let scaledWidth = Int(Double(width) * scale)
        let scaledHeight = Int(Double(height) * scale)
        
        logger.info("🔽 Scaling down from \(width)x\(height) to \(scaledWidth)x\(scaledHeight) (scale: \(String(format: "%.2f", scale)))")
        
        return (width: scaledWidth, height: scaledHeight)
    }

    private func calculateAllDisplaysDimensions(content: SCShareableContent) -> (width: Int, height: Int) {
        // Calculate the bounding rectangle that encompasses all displays
        var minX = CGFloat.greatestFiniteMagnitude
        var minY = CGFloat.greatestFiniteMagnitude
        var maxX: CGFloat = -CGFloat.greatestFiniteMagnitude
        var maxY: CGFloat = -CGFloat.greatestFiniteMagnitude
        var maxScaleFactor: CGFloat = 1.0

        logger.info("🖥️ Calculating bounds for \(content.displays.count) displays:")

        for (index, display) in content.displays.enumerated() {
            let scaleFactor = getScaleFactor(for: display)
            maxScaleFactor = max(maxScaleFactor, scaleFactor)

            logger
                .info(
                    "  Display \(index): origin=(\(display.frame.origin.x), \(display.frame.origin.y)), size=\(display.frame.width)x\(display.frame.height), scale=\(scaleFactor)"
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
                "📐 Combined display bounds: origin=(\(minX), \(minY)), size=\(totalWidth)x\(totalHeight), maxScale=\(maxScaleFactor)"
            )

        // Apply scale factor to get pixel dimensions for retina displays
        return (
            width: Int(totalWidth * maxScaleFactor),
            height: Int(totalHeight * maxScaleFactor)
        )
    }

    private func calculateWindowDimensions(window: SCWindow) -> (width: Int, height: Int) {
        // Solution 2: Use Apple's hardcoded 2x multiplier for windows
        logger.info("🪟 Window dimensions - size: \(window.frame.width)x\(window.frame.height) (using fixed 2x scale)")

        return (
            width: Int(window.frame.width) * 2,
            height: Int(window.frame.height) * 2
        )
    }

    private func calculateDesktopDimensions(
        displayIndex: Int,
        content: SCShareableContent
    )
        -> (width: Int, height: Int)
    {
        if displayIndex >= 0 && displayIndex < content.displays.count {
            let display = content.displays[displayIndex]
            let scaleFactor = getScaleFactor(for: display)

            logger.info("🖥️ Desktop dimensions - display: \(display.width)x\(display.height) (scale: \(scaleFactor))")

            // SCDisplay dimensions are in points, multiply by scale factor for pixels
            return (
                width: Int(CGFloat(display.width) * scaleFactor),
                height: Int(CGFloat(display.height) * scaleFactor)
            )
        }

        // Fallback
        return (width: 1_920, height: 1_080)
    }

    private func calculateApplicationDimensions(
        filter: SCContentFilter,
        content: SCShareableContent
    )
        -> (width: Int, height: Int)
    {
        guard case .application(let app) = captureMode else {
            return (width: 1_920, height: 1_080)
        }

        // Calculate bounding box of all windows
        let appWindows = content.windows.filter {
            $0.owningApplication?.processID == app.processID && $0.isOnScreen
        }

        if !appWindows.isEmpty {
            var unionRect = CGRect.null
            for window in appWindows {
                unionRect = unionRect.union(window.frame)
            }

            // Find the screen to get scale factor
            let appScreen = NSScreen.screens.first { screen in
                screen.frame.intersects(unionRect)
            }
            let scaleFactor = appScreen?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2.0

            logger
                .info(
                    "📱 App dimensions - rect: \(String(describing: unionRect.width))x\(String(describing: unionRect.height)), scale: \(scaleFactor)"
                )

            return (
                width: Int(unionRect.width * scaleFactor),
                height: Int(unionRect.height * scaleFactor)
            )
        }

        return (width: 1, height: 1)
    }

    // MARK: - Private Configuration Methods

    private func configureScaling(config: SCStreamConfiguration) {
        if case .allDisplays = captureMode {
            // For all displays, avoid letterboxing
            config.scalesToFit = false
            config.preservesAspectRatio = true
            logger.info("📐 All displays mode: scalesToFit=false (to avoid letterboxing)")
        } else {
            // No scaling for single capture modes
            config.scalesToFit = false
            config.preservesAspectRatio = true
            logger.info("📐 Single capture mode: scalesToFit=false")
        }
    }

    private func configureRectangles(config: SCStreamConfiguration, filter: SCContentFilter) {
        // Solution 3: Simplify configuration - don't set source/destination rectangles
        // Let the system handle it automatically like Apple's example
        logger.info("📐 Using default rectangle configuration (Apple's approach)")
        logger.info("  - Not setting explicit source/destination rectangles")
        logger.info("  - Filter content rect: \(String(describing: filter.contentRect))")

        // Only log what the capture mode is for debugging
        switch captureMode {
        case .desktop(let displayIndex):
            logger.info("  - Desktop mode - Display \(displayIndex)")
        case .window:
            logger.info("  - Window mode")
        case .allDisplays:
            logger.info("  - All displays mode")
        case .application:
            logger.info("  - Application mode")
        }
    }

    // MARK: - Helper Methods

    private func getScaleFactor(for display: SCDisplay) -> CGFloat {
        // Find corresponding NSScreen to get scale factor
        let nsScreen = NSScreen.screens.first { screen in
            let xMatch = abs(screen.frame.origin.x - display.frame.origin.x) < 1.0
            let yMatch = abs(screen.frame.origin.y - display.frame.origin.y) < 1.0
            let widthMatch = abs(screen.frame.width - display.frame.width) < 1.0
            let heightMatch = abs(screen.frame.height - display.frame.height) < 1.0
            return xMatch && yMatch && widthMatch && heightMatch
        }

        return nsScreen?.backingScaleFactor ?? 2.0
    }

    private func fourCCToString(_ fourCC: FourCharCode) -> String {
        let chars = [
            Character(UnicodeScalar((fourCC >> 24) & 0xFF)!),
            Character(UnicodeScalar((fourCC >> 16) & 0xFF)!),
            Character(UnicodeScalar((fourCC >> 8) & 0xFF)!),
            Character(UnicodeScalar(fourCC & 0xFF)!)
        ]
        return String(chars)
    }
}
