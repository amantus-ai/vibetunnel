import AppKit
import Foundation
import OSLog

/// Tracks terminal windows and their associated sessions.
///
/// This class provides functionality to:
/// - Enumerate terminal windows using Core Graphics APIs
/// - Map VibeTunnel sessions to their terminal windows
/// - Focus specific terminal windows when requested
/// - Handle both windows and tabs for different terminal applications
@MainActor
final class WindowTracker {
    static let shared = WindowTracker()

    private let logger = Logger(
        subsystem: "sh.vibetunnel.vibetunnel",
        category: "WindowTracker"
    )

    /// Information about a tracked terminal window
    struct WindowInfo {
        let windowID: CGWindowID
        let ownerPID: pid_t
        let terminalApp: Terminal
        let sessionID: String
        let createdAt: Date

        // Tab-specific information
        let tabReference: String? // AppleScript reference for Terminal.app tabs
        let tabID: String? // Tab identifier for iTerm2

        // Window properties from Core Graphics
        let bounds: CGRect?
        let title: String?
    }

    /// Maps session IDs to their terminal window information
    private var sessionWindowMap: [String: WindowInfo] = [:]

    /// Lock for thread-safe access to the session map
    private let mapLock = NSLock()

    private init() {
        logger.info("WindowTracker initialized")
    }

    // MARK: - Window Registration

    /// Registers a terminal window for a session.
    /// This should be called after launching a terminal with a session ID.
    func registerWindow(
        for sessionID: String,
        terminalApp: Terminal,
        tabReference: String? = nil,
        tabID: String? = nil
    ) {
        logger.info("Registering window for session: \(sessionID), terminal: \(terminalApp.rawValue)")

        // Give the terminal some time to create the window
        Task {
            try? await Task.sleep(for: .seconds(1.0))

            // Find the most recently created window for this terminal
            if let windowInfo = findWindow(
                for: terminalApp,
                sessionID: sessionID,
                tabReference: tabReference,
                tabID: tabID
            ) {
                mapLock.withLock {
                    sessionWindowMap[sessionID] = windowInfo
                }
                logger.info("Successfully registered window \(windowInfo.windowID) for session \(sessionID)")
            } else {
                logger.warning("Could not find window for session \(sessionID)")
            }
        }
    }

    /// Unregisters a window for a session.
    func unregisterWindow(for sessionID: String) {
        mapLock.withLock {
            if sessionWindowMap.removeValue(forKey: sessionID) != nil {
                logger.info("Unregistered window for session: \(sessionID)")
            }
        }
    }

    // MARK: - Window Enumeration

    /// Gets all terminal windows currently visible on screen.
    static func getAllTerminalWindows() -> [WindowInfo] {
        let options: CGWindowListOption = [.excludeDesktopElements, .optionOnScreenOnly]

        guard let windowList = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
            return []
        }

        return windowList.compactMap { windowDict in
            // Extract window properties
            guard let ownerPID = windowDict[kCGWindowOwnerPID as String] as? pid_t,
                  let windowID = windowDict[kCGWindowNumber as String] as? CGWindowID,
                  let ownerName = windowDict[kCGWindowOwnerName as String] as? String
            else {
                return nil
            }

            // Check if this is a terminal application
            guard let terminal = Terminal.allCases.first(where: { term in
                // Match by process name or app name
                ownerName == term.processName || ownerName == term.rawValue
            }) else {
                return nil
            }

            // Get window bounds
            let bounds: CGRect? = if let boundsDict = windowDict[kCGWindowBounds as String] as? [String: CGFloat],
                                     let x = boundsDict["X"],
                                     let y = boundsDict["Y"],
                                     let width = boundsDict["Width"],
                                     let height = boundsDict["Height"]
            {
                CGRect(x: x, y: y, width: width, height: height)
            } else {
                nil
            }

            // Get window title
            let title = windowDict[kCGWindowName as String] as? String

            return WindowInfo(
                windowID: windowID,
                ownerPID: ownerPID,
                terminalApp: terminal,
                sessionID: "", // Will be filled when registered
                createdAt: Date(),
                tabReference: nil,
                tabID: nil,
                bounds: bounds,
                title: title
            )
        }
    }

    /// Finds a window for a specific terminal and session.
    private func findWindow(
        for terminal: Terminal,
        sessionID: String,
        tabReference: String?,
        tabID: String?
    )
        -> WindowInfo?
    {
        let allWindows = Self.getAllTerminalWindows()

        // Filter windows for the specific terminal
        let terminalWindows = allWindows.filter { $0.terminalApp == terminal }

        // First try to find window by title containing session path or command
        // Sessions typically show their working directory in the title
        if let sessionInfo = getSessionInfo(for: sessionID) {
            let workingDir = sessionInfo.workingDir
            let dirName = (workingDir as NSString).lastPathComponent
            
            // Look for windows whose title contains the directory name
            if let matchingWindow = terminalWindows.first(where: { window in
                if let title = window.title {
                    return title.contains(dirName) || title.contains(workingDir)
                }
                return false
            }) {
                logger.debug("Found window by directory match: \(dirName)")
                return createWindowInfo(from: matchingWindow, sessionID: sessionID, terminal: terminal, tabReference: tabReference, tabID: tabID)
            }
        }

        // For Terminal.app and iTerm2 with specific tab/window IDs, use those
        if terminal == .terminal, let tabRef = tabReference {
            // Extract window ID from tab reference (format: "tab id X of window id Y")
            if let windowIDMatch = tabRef.firstMatch(of: /window id (\d+)/),
               let windowID = CGWindowID(windowIDMatch.output.1) {
                if let matchingWindow = terminalWindows.first(where: { $0.windowID == windowID }) {
                    logger.debug("Found Terminal.app window by ID: \(windowID)")
                    return createWindowInfo(from: matchingWindow, sessionID: sessionID, terminal: terminal, tabReference: tabReference, tabID: tabID)
                }
            }
        }

        // If we have a window ID from launch result, use it
        if let tabID = tabID, terminal == .iTerm2 {
            // For iTerm2, tabID contains the window ID string
            // Try to match by window title which often includes the window ID
            if let matchingWindow = terminalWindows.first(where: { window in
                if let title = window.title {
                    return title.contains(tabID)
                }
                return false
            }) {
                logger.debug("Found iTerm2 window by ID in title: \(tabID)")
                return createWindowInfo(from: matchingWindow, sessionID: sessionID, terminal: terminal, tabReference: tabReference, tabID: tabID)
            }
        }

        // Fallback: return the most recently created window (highest window ID)
        // But only if it was created very recently (within 5 seconds)
        if let latestWindow = terminalWindows.max(by: { $0.windowID < $1.windowID }) {
            logger.debug("Using most recent window as fallback for session: \(sessionID)")
            return createWindowInfo(from: latestWindow, sessionID: sessionID, terminal: terminal, tabReference: tabReference, tabID: tabID)
        }

        return nil
    }
    
    /// Helper to create WindowInfo from a found window
    private func createWindowInfo(
        from window: WindowInfo,
        sessionID: String,
        terminal: Terminal,
        tabReference: String?,
        tabID: String?
    ) -> WindowInfo {
        return WindowInfo(
            windowID: window.windowID,
            ownerPID: window.ownerPID,
            terminalApp: terminal,
            sessionID: sessionID,
            createdAt: Date(),
            tabReference: tabReference,
            tabID: tabID,
            bounds: window.bounds,
            title: window.title
        )
    }
    
    /// Get session info from SessionMonitor
    private func getSessionInfo(for sessionID: String) -> ServerSessionInfo? {
        // Access SessionMonitor to get session details
        // This is safe because both are @MainActor
        return SessionMonitor.shared.sessions[sessionID]
    }

    // MARK: - Window Focus

    /// Focuses the window associated with a session.
    func focusWindow(for sessionID: String) {
        mapLock.withLock {
            guard let windowInfo = sessionWindowMap[sessionID] else {
                logger.warning("No window found for session: \(sessionID)")
                logger.debug("Available sessions: \(self.sessionWindowMap.keys.joined(separator: ", "))")

                // Try to scan for the session one more time
                Task {
                    await scanForSession(sessionID)
                    // Try focusing again after scan
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                        self.focusWindow(for: sessionID)
                    }
                }
                return
            }

            logger
                .info(
                    "Focusing window for session: \(sessionID), terminal: \(windowInfo.terminalApp.rawValue), windowID: \(windowInfo.windowID)"
                )

            switch windowInfo.terminalApp {
            case .terminal:
                focusTerminalAppWindow(windowInfo)
            case .iTerm2:
                focusiTerm2Window(windowInfo)
            default:
                // For other terminals, use standard window focus
                focusWindowUsingAccessibility(windowInfo)
            }
        }
    }

    /// Focuses a Terminal.app window/tab.
    private func focusTerminalAppWindow(_ windowInfo: WindowInfo) {
        if let tabRef = windowInfo.tabReference {
            // Use stored tab reference
            let script = """
            tell application "Terminal"
                activate
                \(tabRef)
            end tell
            """

            do {
                try AppleScriptExecutor.shared.execute(script)
                logger.info("Focused Terminal.app tab using reference")
            } catch {
                logger.error("Failed to focus Terminal.app tab: \(error)")
                // Fallback to accessibility
                focusWindowUsingAccessibility(windowInfo)
            }
        } else {
            // Fallback to window ID based focusing
            let script = """
            tell application "Terminal"
                activate
                set allWindows to windows
                repeat with w in allWindows
                    if id of w is \(windowInfo.windowID) then
                        set frontmost of w to true
                        exit repeat
                    end if
                end repeat
            end tell
            """

            do {
                try AppleScriptExecutor.shared.execute(script)
            } catch {
                logger.error("Failed to focus Terminal.app window: \(error)")
                focusWindowUsingAccessibility(windowInfo)
            }
        }
    }

    /// Focuses an iTerm2 window.
    private func focusiTerm2Window(_ windowInfo: WindowInfo) {
        if let windowID = windowInfo.tabID {
            // Use window ID for focusing (stored in tabID for consistency)
            let script = """
            tell application "iTerm2"
                activate
                tell window id "\(windowID)"
                    select
                end tell
            end tell
            """

            do {
                try AppleScriptExecutor.shared.execute(script)
                logger.info("Focused iTerm2 window using ID")
            } catch {
                logger.error("Failed to focus iTerm2 window: \(error)")
                focusWindowUsingAccessibility(windowInfo)
            }
        } else {
            // Fallback to window focusing
            focusWindowUsingAccessibility(windowInfo)
        }
    }

    /// Focuses a window using Accessibility APIs.
    private func focusWindowUsingAccessibility(_ windowInfo: WindowInfo) {
        // First bring the application to front
        if let app = NSRunningApplication(processIdentifier: windowInfo.ownerPID) {
            app.activate()
            logger.info("Activated application with PID: \(windowInfo.ownerPID)")
        }

        // Use AXUIElement to focus the specific window
        let axApp = AXUIElementCreateApplication(windowInfo.ownerPID)

        var windowsValue: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &windowsValue)

        guard result == .success,
              let windows = windowsValue as? [AXUIElement],
              !windows.isEmpty
        else {
            logger.error("Failed to get windows for application")
            return
        }

        // Try to find the window by comparing window IDs
        for window in windows {
            var windowIDValue: CFTypeRef?
            if AXUIElementCopyAttributeValue(window, kAXWindowAttribute as CFString, &windowIDValue) == .success,
               let windowNumber = windowIDValue as? Int,
               windowNumber == windowInfo.windowID
            {
                // Found the matching window, make it main and focused
                AXUIElementSetAttributeValue(window, kAXMainAttribute as CFString, true as CFTypeRef)
                AXUIElementSetAttributeValue(window, kAXFocusedAttribute as CFString, true as CFTypeRef)
                logger.info("Focused window using Accessibility API")
                return
            }
        }

        logger.warning("Could not find matching window in AXUIElement list")
    }

    // MARK: - Direct Permission Checks

    /// Checks if we have the required permissions for window tracking using direct API calls.
    private func checkPermissionsDirectly() -> Bool {
        // Check for Screen Recording permission (required for CGWindowListCopyWindowInfo)
        let options: CGWindowListOption = [.excludeDesktopElements]
        if let windowList = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]],
           !windowList.isEmpty
        {
            return true
        }
        return false
    }

    /// Requests the required permissions by opening System Preferences.
    private func requestPermissionsDirectly() {
        logger.info("Requesting Screen Recording permission")

        // Open System Preferences to Privacy & Security > Screen Recording
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture") {
            NSWorkspace.shared.open(url)
        }
    }

    // MARK: - Session Scanning

    /// Scans for a terminal window containing a specific session.
    /// This is used for sessions attached via `vt` that weren't launched through our app.
    private func scanForSession(_ sessionID: String) async {
        logger.info("Scanning for window containing session: \(sessionID)")

        // Get session info to match by working directory
        guard let sessionInfo = getSessionInfo(for: sessionID) else {
            logger.warning("No session info found for session: \(sessionID)")
            return
        }

        // Get all terminal windows
        let allWindows = Self.getAllTerminalWindows()
        
        let workingDir = sessionInfo.workingDir
        let dirName = (workingDir as NSString).lastPathComponent
        let expandedDir = (workingDir as NSString).expandingTildeInPath

        // Look for windows that might contain this session
        for window in allWindows {
            var matchFound = false
            var matchReason = ""
            
            // Check if window title contains working directory or session markers
            if let title = window.title {
                // Check for directory name match (most common)
                if title.contains(dirName) || title.contains(expandedDir) {
                    matchFound = true
                    matchReason = "directory match: \(dirName)"
                }
                // Check for VibeTunnel-specific markers
                else if title.contains("vt") || title.contains("vibetunnel") || title.contains("TTY_SESSION_ID") {
                    matchFound = true
                    matchReason = "VibeTunnel marker in title"
                }
                // Check if title contains the command being run
                else if let command = sessionInfo.command.first,
                        !command.isEmpty && title.contains(command) {
                    matchFound = true
                    matchReason = "command match: \(command)"
                }
            }
            
            if matchFound {
                logger.info("Found window for session \(sessionID) by \(matchReason): \(window.title ?? "no title")")

                // Create window info for this session
                let windowInfo = WindowInfo(
                    windowID: window.windowID,
                    ownerPID: window.ownerPID,
                    terminalApp: window.terminalApp,
                    sessionID: sessionID,
                    createdAt: Date(),
                    tabReference: nil,
                    tabID: nil,
                    bounds: window.bounds,
                    title: window.title
                )

                mapLock.withLock {
                    sessionWindowMap[sessionID] = windowInfo
                }

                logger.info("Successfully mapped window \(window.windowID) to session \(sessionID)")
                return
            }
        }

        // If no match found, log window titles for debugging
        logger.debug("Could not find window for session \(sessionID) (workingDir: \(workingDir))")
        for (index, window) in allWindows.enumerated() {
            logger.debug("Window \(index): \(window.terminalApp.rawValue) - '\(window.title ?? "no title")'")
        }
    }

    // MARK: - Session Monitoring

    /// Updates the window tracker based on active sessions.
    /// Should be called when SessionMonitor updates.
    func updateFromSessions(_ sessions: [ServerSessionInfo]) {
        mapLock.withLock {
            // Remove windows for sessions that no longer exist
            let activeSessionIDs = Set(sessions.map(\.id))
            sessionWindowMap = sessionWindowMap.filter { activeSessionIDs.contains($0.key) }

            // Scan for untracked sessions (e.g., attached via vt command)
            for session in sessions where session.isRunning {
                if sessionWindowMap[session.id] == nil {
                    // This session isn't tracked yet, try to find its window
                    Task {
                        await scanForSession(session.id)
                    }
                }
            }

            logger
                .debug(
                    "Updated window tracker: \(self.sessionWindowMap.count) active windows, \(sessions.count) total sessions"
                )
        }
    }

    /// Gets the window information for a session.
    func windowInfo(for sessionID: String) -> WindowInfo? {
        mapLock.withLock {
            sessionWindowMap[sessionID]
        }
    }

    /// Gets all tracked windows.
    func allTrackedWindows() -> [WindowInfo] {
        mapLock.withLock {
            Array(sessionWindowMap.values)
        }
    }

    // MARK: - Permissions

    /// Checks if we have the necessary permissions for window tracking.
    func checkPermissions() -> Bool {
        // Check Screen Recording permission
        guard SystemPermissionManager.shared.hasPermission(.screenRecording) else {
            logger.warning("Screen Recording permission required for window tracking")
            return false
        }

        // Check Accessibility permission (for window focusing)
        guard SystemPermissionManager.shared.hasPermission(.accessibility) else {
            logger.warning("Accessibility permission required for window focusing")
            return false
        }

        return true
    }

    /// Requests all necessary permissions for window tracking.
    func requestPermissions() {
        if !SystemPermissionManager.shared.hasPermission(.screenRecording) {
            SystemPermissionManager.shared.requestPermission(.screenRecording)
        }

        if !SystemPermissionManager.shared.hasPermission(.accessibility) {
            SystemPermissionManager.shared.requestPermission(.accessibility)
        }
    }
}
