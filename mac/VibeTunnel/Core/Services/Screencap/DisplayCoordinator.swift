import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import OSLog
@preconcurrency import ScreenCaptureKit

/// Protocol for display change notifications
@MainActor
public protocol DisplayCoordinatorDelegate: AnyObject {
    /// Called when display configuration changes during capture
    func displayCoordinator(
        _ coordinator: DisplayCoordinator,
        didDetectDisplayChange notification: DisplayChangeNotification
    )
}

/// Notification about display changes
public struct DisplayChangeNotification {
    public enum ChangeType {
        case displayDisconnected
        case windowDisconnected
        case configurationChanged
    }

    public let type: ChangeType
    public let message: String
    public let affectedDisplayIndex: Int?
    public let affectedWindowID: Int?
}

/// Coordinates display discovery, window enumeration, and display change monitoring
@preconcurrency
@MainActor
public final class DisplayCoordinator: NSObject {
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "DisplayCoordinator")

    // MARK: - Properties

    /// Delegate for display change notifications
    public weak var delegate: DisplayCoordinatorDelegate?

    /// Icon cache
    private var iconCache: [Int32: String?] = [:] // PID -> base64 icon

    /// Whether we're monitoring for display changes
    private var isMonitoring = false

    // MARK: - Initialization

    override public init() {
        super.init()
        logger.info("🖥️ DisplayCoordinator initialized")
    }

    deinit {
        // Remove observer directly in deinit
        NotificationCenter.default.removeObserver(self)
    }

    // MARK: - Display Discovery

    /// Get all available displays
    public func getDisplays() async throws -> [DisplayInfo] {
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
                    scaleFactor: Double(screen.backingScaleFactor),
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
            logger.debug(
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

            // As a last resort, match by index
            if nsScreen == nil && index < NSScreen.screens.count {
                nsScreen = NSScreen.screens[index]
                let screenName = nsScreen?.localizedName ?? "Unknown"
                logger.debug("⚠️ Matched SCDisplay \(index) with NSScreen by index: \(screenName)")
            }

            let displayInfo = DisplayInfo(
                id: "SCDisplay-\(display.displayID)",
                width: display.width,
                height: display.height,
                scaleFactor: Double(nsScreen?.backingScaleFactor ?? 1.0),
                refreshRate: 60.0, // SCDisplay doesn't provide refresh rate directly
                x: Double(display.frame.origin.x),
                y: Double(display.frame.origin.y),
                name: nsScreen?.localizedName
            )
            displayInfos.append(displayInfo)
        }

        return displayInfos
    }

    /// Get display info for the main display
    public func getDisplayInfo() async throws -> DisplayInfo {
        let displays = try await getDisplays()
        guard let mainDisplay = displays.first else {
            throw ScreencapError.noDisplay
        }
        return mainDisplay
    }

    // MARK: - Process and Window Discovery

    /// Get process groups with their windows
    public func getProcessGroups() async throws -> [ProcessGroup] {
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
                logger.debug(
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

    // MARK: - Icon Management

    /// Get cached application icon or load it if not cached
    public func getCachedAppIcon(for pid: Int32) -> String? {
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

    /// Clear the icon cache
    public func clearIconCache() {
        iconCache.removeAll()
        logger.info("🗑️ Icon cache cleared")
    }

    /// Clear icon cache for a specific PID
    public func clearIconCache(for pid: Int32) {
        iconCache.removeValue(forKey: pid)
        logger.info("🗑️ Icon cache cleared for PID \(pid)")
    }

    // MARK: - Display Change Monitoring

    /// Start monitoring for display configuration changes
    public func startMonitoring() {
        guard !isMonitoring else { return }

        // Monitor for display configuration changes
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(displayConfigurationChanged),
            name: NSApplication.didChangeScreenParametersNotification,
            object: nil
        )

        isMonitoring = true
        logger.info("📺 Display monitoring enabled")
    }

    /// Stop monitoring for display configuration changes
    public func stopMonitoring() {
        guard isMonitoring else { return }

        // Observer will be removed in deinit
        isMonitoring = false
        logger.info("📺 Display monitoring disabled")
    }

    /// Handle display configuration changes
    @objc
    private func displayConfigurationChanged(_ notification: Notification) {
        logger.warning("⚠️ Display configuration changed")

        let changeNotification = DisplayChangeNotification(
            type: .configurationChanged,
            message: "Display configuration has changed",
            affectedDisplayIndex: nil,
            affectedWindowID: nil
        )

        delegate?.displayCoordinator(self, didDetectDisplayChange: changeNotification)
    }

    /// Notify that a specific display was disconnected
    public func notifyDisplayDisconnected(displayIndex: Int) {
        let changeNotification = DisplayChangeNotification(
            type: .displayDisconnected,
            message: "Display \(displayIndex) was disconnected during capture",
            affectedDisplayIndex: displayIndex,
            affectedWindowID: nil
        )

        delegate?.displayCoordinator(self, didDetectDisplayChange: changeNotification)
    }

    /// Notify that a specific window was disconnected
    public func notifyWindowDisconnected(windowID: Int) {
        let changeNotification = DisplayChangeNotification(
            type: .windowDisconnected,
            message: "Window closed or became unavailable",
            affectedDisplayIndex: nil,
            affectedWindowID: windowID
        )

        delegate?.displayCoordinator(self, didDetectDisplayChange: changeNotification)
    }

    // MARK: - Helper Methods

    /// Check if screen recording permission is granted
    private func isScreenRecordingAllowed() async -> Bool {
        // Use SystemPermissionManager which has better caching and non-triggering checks
        let hasPermission = await MainActor.run {
            SystemPermissionManager.shared.hasPermission(.screenRecording)
        }

        if hasPermission {
            logger.info("✅ Screen recording permission is granted")
        } else {
            logger.warning("❌ Screen recording permission not granted")
        }

        return hasPermission
    }
}
