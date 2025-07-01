import AppKit
import Darwin
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

        // For Terminal.app and iTerm2 with explicit window/tab info, register immediately
        if (terminalApp == .terminal && tabReference != nil) ||
            (terminalApp == .iTerm2 && tabID != nil)
        {
            // These terminals provide explicit window/tab IDs, so we can register immediately
            Task {
                try? await Task.sleep(for: .milliseconds(500))

                if let windowInfo = findWindow(
                    for: terminalApp,
                    sessionID: sessionID,
                    tabReference: tabReference,
                    tabID: tabID
                ) {
                    mapLock.withLock {
                        sessionWindowMap[sessionID] = windowInfo
                    }
                    logger
                        .info(
                            "Successfully registered window \(windowInfo.windowID) for session \(sessionID) with explicit ID"
                        )
                }
            }
            return
        }

        // For other terminals, use progressive delays to find the window
        Task {
            // Try multiple times with increasing delays
            let delays: [Double] = [0.5, 1.0, 2.0, 3.0]

            for (index, delay) in delays.enumerated() {
                try? await Task.sleep(for: .seconds(delay))

                // Try to find the window
                if let windowInfo = findWindow(
                    for: terminalApp,
                    sessionID: sessionID,
                    tabReference: tabReference,
                    tabID: tabID
                ) {
                    mapLock.withLock {
                        sessionWindowMap[sessionID] = windowInfo
                    }
                    logger
                        .info(
                            "Successfully registered window \(windowInfo.windowID) for session \(sessionID) after \(index + 1) attempts"
                        )
                    return
                }

                logger
                    .debug("Window registration attempt \(index + 1) failed for session \(sessionID), trying again...")
            }

            logger.warning("Could not find window for session \(sessionID) after all attempts")

            // Final fallback: try scanning
            await scanForSession(sessionID)
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
                // Match by process name, app name, or bundle identifier parts
                let processNameMatch = ownerName == term.processName ||
                    ownerName.lowercased() == term.processName.lowercased()
                let appNameMatch = ownerName == term.rawValue
                let bundleMatch = ownerName.contains(term.displayName) ||
                    term.bundleIdentifier.contains(ownerName)

                return processNameMatch || appNameMatch || bundleMatch
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

        // First try to find window by process PID traversal
        if let sessionInfo = getSessionInfo(for: sessionID), let sessionPID = sessionInfo.pid {
            logger.debug("Attempting to find window by process PID: \(sessionPID)")

            // Try to find the parent process (shell) that owns this session
            if let parentPID = getParentProcessID(of: pid_t(sessionPID)) {
                logger.debug("Found parent process PID: \(parentPID)")

                // Look for a window owned by the parent process
                if let matchingWindow = terminalWindows.first(where: { window in
                    // Check if the window's owner PID matches the parent PID
                    window.ownerPID == parentPID
                }) {
                    logger.info("Found window by parent process match: PID \(parentPID)")
                    return createWindowInfo(
                        from: matchingWindow,
                        sessionID: sessionID,
                        terminal: terminal,
                        tabReference: tabReference,
                        tabID: tabID
                    )
                }

                // If direct parent match fails, try to find grandparent or higher ancestors
                var currentPID = parentPID
                var depth = 0
                while depth < 5 { // Limit traversal depth to prevent infinite loops
                    if let grandParentPID = getParentProcessID(of: currentPID) {
                        logger.debug("Checking ancestor process PID: \(grandParentPID) at depth \(depth + 2)")

                        if let matchingWindow = terminalWindows.first(where: { window in
                            window.ownerPID == grandParentPID
                        }) {
                            logger.info("Found window by ancestor process match: PID \(grandParentPID)")
                            return createWindowInfo(
                                from: matchingWindow,
                                sessionID: sessionID,
                                terminal: terminal,
                                tabReference: tabReference,
                                tabID: tabID
                            )
                        }

                        currentPID = grandParentPID
                        depth += 1
                    } else {
                        break
                    }
                }
            }
        }

        // Fallback: try to find window by title containing session path or command
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
                return createWindowInfo(
                    from: matchingWindow,
                    sessionID: sessionID,
                    terminal: terminal,
                    tabReference: tabReference,
                    tabID: tabID
                )
            }
        }

        // For Terminal.app and iTerm2 with specific tab/window IDs, use those
        if terminal == .terminal, let tabRef = tabReference {
            // Extract window ID from tab reference (format: "tab id X of window id Y")
            if let windowIDMatch = tabRef.firstMatch(of: /window id (\d+)/),
               let windowID = CGWindowID(windowIDMatch.output.1)
            {
                if let matchingWindow = terminalWindows.first(where: { $0.windowID == windowID }) {
                    logger.debug("Found Terminal.app window by ID: \(windowID)")
                    return createWindowInfo(
                        from: matchingWindow,
                        sessionID: sessionID,
                        terminal: terminal,
                        tabReference: tabReference,
                        tabID: tabID
                    )
                }
            }
        }

        // If we have a window ID from launch result, use it
        if let tabID, terminal == .iTerm2 {
            // For iTerm2, tabID contains the window ID string
            // Try to match by window title which often includes the window ID
            if let matchingWindow = terminalWindows.first(where: { window in
                if let title = window.title {
                    return title.contains(tabID)
                }
                return false
            }) {
                logger.debug("Found iTerm2 window by ID in title: \(tabID)")
                return createWindowInfo(
                    from: matchingWindow,
                    sessionID: sessionID,
                    terminal: terminal,
                    tabReference: tabReference,
                    tabID: tabID
                )
            }
        }

        // Fallback: return the most recently created window (highest window ID)
        // But only if it was created very recently (within 5 seconds)
        if let latestWindow = terminalWindows.max(by: { $0.windowID < $1.windowID }) {
            logger.debug("Using most recent window as fallback for session: \(sessionID)")
            return createWindowInfo(
                from: latestWindow,
                sessionID: sessionID,
                terminal: terminal,
                tabReference: tabReference,
                tabID: tabID
            )
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
    )
        -> WindowInfo
    {
        WindowInfo(
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
        SessionMonitor.shared.sessions[sessionID]
    }

    /// Get the parent process ID of a given process
    private func getParentProcessID(of pid: pid_t) -> pid_t? {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.size
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]

        let result = sysctl(&mib, u_int(mib.count), &info, &size, nil, 0)

        if result == 0 && size > 0 {
            return info.kp_eproc.e_ppid
        }

        return nil
    }

    // MARK: - Window Focus

    /// Focuses the window associated with a session.
    func focusWindow(for sessionID: String) {
        // First check if we have the window info
        let windowInfo = mapLock.withLock { sessionWindowMap[sessionID] }

        if let windowInfo {
            // We have window info, try to focus it
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
        } else {
            // No window info found, try to scan for it
            logger.warning("No window found for session: \(sessionID), attempting to locate...")

            // Get available sessions for debugging
            let availableSessions = mapLock.withLock { Array(sessionWindowMap.keys) }
            logger.debug("Currently tracked sessions: \(availableSessions.joined(separator: ", "))")

            // Try to find the window immediately (synchronously)
            if let sessionInfo = getSessionInfo(for: sessionID) {
                // Try to find window using enhanced logic
                if let foundWindow = findWindowForSession(sessionID, sessionInfo: sessionInfo) {
                    mapLock.withLock {
                        sessionWindowMap[sessionID] = foundWindow
                    }
                    logger.info("Found window for session \(sessionID) on demand")
                    // Recursively call to focus the now-found window
                    focusWindow(for: sessionID)
                    return
                }
            }

            // If still not found, scan asynchronously
            Task {
                await scanForSession(sessionID)
                // Try focusing again after scan
                try? await Task.sleep(for: .milliseconds(500))
                await MainActor.run {
                    self.focusWindow(for: sessionID)
                }
            }
        }
    }

    /// Synchronously find a window for a session
    private func findWindowForSession(_ sessionID: String, sessionInfo: ServerSessionInfo) -> WindowInfo? {
        let allWindows = Self.getAllTerminalWindows()

        // First try to find window by process PID traversal
        if let sessionPID = sessionInfo.pid {
            logger.debug("Attempting to find window by process PID (sync): \(sessionPID)")

            // Try to find the parent process (shell) that owns this session
            if let parentPID = getParentProcessID(of: pid_t(sessionPID)) {
                logger.debug("Found parent process PID (sync): \(parentPID)")

                // Look for a window owned by the parent process
                if let matchingWindow = allWindows.first(where: { window in
                    window.ownerPID == parentPID
                }) {
                    logger.info("Found window by parent process match (sync): PID \(parentPID)")
                    return WindowInfo(
                        windowID: matchingWindow.windowID,
                        ownerPID: matchingWindow.ownerPID,
                        terminalApp: matchingWindow.terminalApp,
                        sessionID: sessionID,
                        createdAt: Date(),
                        tabReference: nil,
                        tabID: nil,
                        bounds: matchingWindow.bounds,
                        title: matchingWindow.title
                    )
                }

                // If direct parent match fails, try to find grandparent or higher ancestors
                var currentPID = parentPID
                var depth = 0
                while depth < 5 { // Limit traversal depth to prevent infinite loops
                    if let grandParentPID = getParentProcessID(of: currentPID) {
                        logger.debug("Checking ancestor process PID (sync): \(grandParentPID) at depth \(depth + 2)")

                        if let matchingWindow = allWindows.first(where: { window in
                            window.ownerPID == grandParentPID
                        }) {
                            logger.info("Found window by ancestor process match (sync): PID \(grandParentPID)")
                            return WindowInfo(
                                windowID: matchingWindow.windowID,
                                ownerPID: matchingWindow.ownerPID,
                                terminalApp: matchingWindow.terminalApp,
                                sessionID: sessionID,
                                createdAt: Date(),
                                tabReference: nil,
                                tabID: nil,
                                bounds: matchingWindow.bounds,
                                title: matchingWindow.title
                            )
                        }

                        currentPID = grandParentPID
                        depth += 1
                    } else {
                        break
                    }
                }
            }
        }

        // Fallback to title-based matching
        let workingDir = sessionInfo.workingDir
        let dirName = (workingDir as NSString).lastPathComponent
        let expandedDir = (workingDir as NSString).expandingTildeInPath

        // Look through all windows to find a match
        for window in allWindows {
            var matchFound = false

            if let title = window.title {
                // Check for directory name match
                if title.contains(dirName) || title.contains(expandedDir) {
                    matchFound = true
                }
                // Check for VibeTunnel markers
                else if title.contains("vt") || title.contains("vibetunnel") || title.contains("TTY_SESSION_ID") {
                    matchFound = true
                }
                // Check for command match
                else if let command = sessionInfo.command.first,
                        !command.isEmpty && title.contains(command)
                {
                    matchFound = true
                }
            }

            if matchFound {
                return WindowInfo(
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
            }
        }

        return nil
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

        // First try to find window by process PID traversal
        if let sessionPID = sessionInfo.pid {
            logger.debug("Scanning by process PID: \(sessionPID)")

            // Try to find the parent process (shell) that owns this session
            if let parentPID = getParentProcessID(of: pid_t(sessionPID)) {
                logger.debug("Found parent process PID (scan): \(parentPID)")

                // Look for a window owned by the parent process
                if let matchingWindow = allWindows.first(where: { window in
                    window.ownerPID == parentPID
                }) {
                    logger
                        .info("Found window by parent process match (scan): PID \(parentPID) for session \(sessionID)")

                    let windowInfo = WindowInfo(
                        windowID: matchingWindow.windowID,
                        ownerPID: matchingWindow.ownerPID,
                        terminalApp: matchingWindow.terminalApp,
                        sessionID: sessionID,
                        createdAt: Date(),
                        tabReference: nil,
                        tabID: nil,
                        bounds: matchingWindow.bounds,
                        title: matchingWindow.title
                    )

                    mapLock.withLock {
                        sessionWindowMap[sessionID] = windowInfo
                    }

                    logger.info("Successfully mapped window \(matchingWindow.windowID) to session \(sessionID)")
                    return
                }

                // If direct parent match fails, try to find grandparent or higher ancestors
                var currentPID = parentPID
                var depth = 0
                while depth < 5 { // Limit traversal depth to prevent infinite loops
                    if let grandParentPID = getParentProcessID(of: currentPID) {
                        logger.debug("Checking ancestor process PID (scan): \(grandParentPID) at depth \(depth + 2)")

                        if let matchingWindow = allWindows.first(where: { window in
                            window.ownerPID == grandParentPID
                        }) {
                            logger
                                .info(
                                    "Found window by ancestor process match (scan): PID \(grandParentPID) for session \(sessionID)"
                                )

                            let windowInfo = WindowInfo(
                                windowID: matchingWindow.windowID,
                                ownerPID: matchingWindow.ownerPID,
                                terminalApp: matchingWindow.terminalApp,
                                sessionID: sessionID,
                                createdAt: Date(),
                                tabReference: nil,
                                tabID: nil,
                                bounds: matchingWindow.bounds,
                                title: matchingWindow.title
                            )

                            mapLock.withLock {
                                sessionWindowMap[sessionID] = windowInfo
                            }

                            logger.info("Successfully mapped window \(matchingWindow.windowID) to session \(sessionID)")
                            return
                        }

                        currentPID = grandParentPID
                        depth += 1
                    } else {
                        break
                    }
                }
            }
        }

        // Fallback to title-based scanning
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
                        !command.isEmpty && title.contains(command)
                {
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
