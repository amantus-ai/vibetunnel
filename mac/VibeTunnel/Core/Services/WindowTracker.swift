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
/// - **Close terminal windows when sessions are terminated (NEW)**
///
/// ## Window Closing Feature
///
/// A key enhancement is the ability to automatically close terminal windows when
/// their associated sessions are terminated. This solves the common problem where
/// killing a long-running process (like `claude`) leaves an empty terminal window.
///
/// ### Design Principles:
/// 1. **Only close what we open**: Windows are only closed if VibeTunnel opened them
/// 2. **Track ownership at creation**: Sessions opened via AppleScript are marked at launch time
/// 3. **Respect external sessions**: Sessions attached via `vt` are never closed
///
/// ### Implementation:
/// - When spawning terminals via AppleScript, sessions are marked in `sessionsOpenedByUs` set
/// - On termination, we dynamically find windows using process tree traversal
/// - Only windows for sessions in the set are closed
/// - Currently supports Terminal.app and iTerm2
///
/// ### User Experience:
/// - Consistent behavior: All VibeTunnel-spawned windows close on termination
/// - No orphaned windows: Prevents accumulation of empty terminals
/// - External sessions preserved: `vt`-attached terminals remain open
@MainActor
final class WindowTracker {
    static let shared = WindowTracker()

    private let logger = Logger(
        subsystem: "sh.vibetunnel.vibetunnel",
        category: "WindowTracker"
    )

    /// Maps session IDs to their terminal window information
    private var sessionWindowMap: [String: WindowEnumerator.WindowInfo] = [:]

    /// Tracks which sessions we opened via AppleScript (and can close).
    ///
    /// When VibeTunnel spawns a terminal session through AppleScript, we mark
    /// it in this set. This allows us to distinguish between:
    /// - Sessions we created: Can and should close their windows
    /// - Sessions attached via `vt`: Should never close their windows
    ///
    /// The actual window finding happens dynamically using process tree traversal,
    /// making the system robust against tab reordering and window manipulation.
    ///
    /// Example flow:
    /// 1. User creates session via UI → TerminalLauncher uses AppleScript
    /// 2. Session ID is added to this set
    /// 3. User kills session → We find and close the window dynamically
    ///
    /// Sessions attached via `vt` command are NOT added to this set.
    private var sessionsOpenedByUs: Set<String> = []

    /// Lock for thread-safe access to the session map
    private let mapLock = NSLock()

    // Component instances
    private let windowEnumerator = WindowEnumerator()
    private let windowMatcher = WindowMatcher()
    private let windowFocuser = WindowFocuser()
    private let permissionChecker = PermissionChecker()
    private let processTracker = ProcessTracker()

    private init() {
        logger.info("WindowTracker initialized")
    }

    // MARK: - Window Registration

    /// Registers a session that was opened by VibeTunnel.
    /// This should be called after launching a terminal with a session ID.
    /// Only sessions registered here will have their windows closed on termination.
    func registerSessionOpenedByUs(
        for sessionID: String,
        terminalApp: Terminal
    ) {
        logger.info("Registering session opened by us: \(sessionID), terminal: \(terminalApp.rawValue)")

        // Mark this session as opened by us, so we can close its window later
        // This is the critical point where we distinguish between:
        // - Sessions we created via AppleScript (can close)
        // - Sessions attached via `vt` command (cannot close)
        _ = mapLock.withLock {
            sessionsOpenedByUs.insert(sessionID)
        }

        // Window finding is now handled dynamically when needed (focus/close)
        // This avoids storing stale tab references
    }

    /// Legacy method for compatibility - redirects to simplified registration
    func registerWindow(
        for sessionID: String,
        terminalApp: Terminal,
        tabReference: String? = nil,
        tabID: String? = nil
    ) {
        // Simply mark the session as opened by us
        // We no longer store tab references as they become stale
        registerSessionOpenedByUs(for: sessionID, terminalApp: terminalApp)
    }

    /// Unregisters a window for a session.
    func unregisterWindow(for sessionID: String) {
        mapLock.withLock {
            if sessionWindowMap.removeValue(forKey: sessionID) != nil {
                logger.info("Unregistered window for session: \(sessionID)")
            }
            sessionsOpenedByUs.remove(sessionID)
        }
    }

    // MARK: - Window Information

    /// Gets the window information for a specific session.
    func windowInfo(for sessionID: String) -> WindowEnumerator.WindowInfo? {
        mapLock.withLock {
            sessionWindowMap[sessionID]
        }
    }

    /// Gets all tracked windows.
    func allTrackedWindows() -> [WindowEnumerator.WindowInfo] {
        mapLock.withLock {
            Array(sessionWindowMap.values)
        }
    }

    // MARK: - Window Focusing

    /// Focuses the terminal window for a specific session.
    func focusWindow(for sessionID: String) {
        guard let windowInfo = windowInfo(for: sessionID) else {
            logger.warning("No window registered for session: \(sessionID)")
            return
        }

        logger.info("Focusing window for session: \(sessionID), terminal: \(windowInfo.terminalApp.rawValue)")

        // Check permissions before attempting to focus
        guard permissionChecker.checkPermissions() else {
            return
        }

        // Delegate to the window focuser
        windowFocuser.focusWindow(windowInfo)
    }

    // MARK: - Window Closing

    /// Closes the terminal window for a specific session if it was opened by VibeTunnel.
    ///
    /// This method implements a key feature where terminal windows are automatically closed
    /// when their associated sessions are terminated, but ONLY if VibeTunnel opened them.
    /// This prevents the common issue where killing a process leaves empty terminal windows.
    ///
    /// The method checks if:
    /// 1. The session was opened by VibeTunnel (exists in `sessionsOpenedByUs`)
    /// 2. We can find the window using dynamic lookup (process tree traversal)
    /// 3. We can close via Accessibility API (PID-based) or AppleScript
    ///
    /// - Parameter sessionID: The ID of the session whose window should be closed
    /// - Returns: `true` if the window was successfully closed, `false` otherwise
    ///
    /// - Note: This is called automatically by `SessionService.terminateSession()`
    ///         after the server confirms the process has been killed.
    ///
    /// Example scenarios:
    /// - ✅ User runs `claude` command via UI → Window closes when session killed
    /// - ✅ User runs long process via UI → Window closes when session killed
    /// - ❌ User attaches existing terminal via `vt` → Window NOT closed
    /// - ❌ User manually opens terminal → Window NOT closed
    @discardableResult
    func closeWindowIfOpenedByUs(for sessionID: String) -> Bool {
        // Check if we opened this window
        let wasOpenedByUs = mapLock.withLock {
            sessionsOpenedByUs.contains(sessionID)
        }

        guard wasOpenedByUs else {
            logger.info("Session \(sessionID) was not opened by VibeTunnel, not closing window")
            return false
        }

        // Use dynamic lookup to find the window
        // This is more reliable than stored references which can become stale
        guard let sessionInfo = getSessionInfo(for: sessionID) else {
            logger.warning("No session info found for session: \(sessionID)")
            unregisterWindow(for: sessionID)
            return false
        }
        
        guard let windowInfo = findWindowForSession(sessionID, sessionInfo: sessionInfo) else {
            logger.warning("Could not find window for session \(sessionID) - it may have been closed already")
            // Clean up tracking since window is gone
            unregisterWindow(for: sessionID)
            return false
        }

        logger.info("Closing window for session: \(sessionID), terminal: \(windowInfo.terminalApp.rawValue)")

        // Generate and execute AppleScript to close the window
        let closeScript = generateCloseWindowScript(for: windowInfo)
        do {
            try AppleScriptExecutor.shared.execute(closeScript)
            logger.info("Successfully closed window for session: \(sessionID)")

            // Clean up tracking
            unregisterWindow(for: sessionID)
            return true
        } catch {
            logger.error("Failed to close window for session \(sessionID): \(error)")
            return false
        }
    }

    /// Generates AppleScript to close a specific terminal window.
    ///
    /// This method creates terminal-specific AppleScript commands to close windows.
    /// Uses window IDs from dynamic lookup rather than stored tab references,
    /// making it robust against tab reordering and window manipulation.
    ///
    /// - **Terminal.app**: Uses window ID to close the entire window
    ///   - `saving no` prevents save dialogs
    ///   - Closes all tabs in the window
    ///
    /// - **iTerm2**: Uses window ID with robust matching
    ///   - Iterates through windows to find exact match
    ///   - Closes entire window
    ///
    /// - **Ghostty**: Uses standard AppleScript window closing
    ///   - Directly closes window by ID
    ///   - Supports modern window management
    ///
    /// - **Other terminals**: Not supported as they don't provide reliable window IDs
    ///
    /// - Parameter windowInfo: Window information from dynamic lookup
    /// - Returns: AppleScript string to close the window, or empty string if unsupported
    ///
    /// - Note: All scripts include error handling to gracefully handle already-closed windows
    private func generateCloseWindowScript(for windowInfo: WindowEnumerator.WindowInfo) -> String {
        switch windowInfo.terminalApp {
        case .terminal:
            // Use window ID to close - more reliable than tab references
            return """
            tell application "Terminal"
                try
                    close (first window whose id is \(windowInfo.windowID)) saving no
                on error
                    -- Window might already be closed
                end try
            end tell
            """

        case .iTerm2:
            // For iTerm2, close the window by matching against all windows
            // iTerm2's window IDs can be tricky, so we use a more robust approach
            return """
            tell application "iTerm2"
                try
                    set targetWindows to (windows)
                    repeat with w in targetWindows
                        try
                            if id of w is \(windowInfo.windowID) then
                                close w
                                exit repeat
                            end if
                        end try
                    end repeat
                on error
                    -- Window might already be closed
                end try
            end tell
            """

        case .ghostty:
            // Ghostty supports standard AppleScript window operations
            // Note: Ghostty uses lowercase "ghostty" in System Events
            return """
            tell application "ghostty"
                try
                    close (first window whose id is \(windowInfo.windowID))
                on error
                    -- Window might already be closed
                end try
            end tell
            """

        default:
            // For other terminals, we don't have reliable window closing
            logger.warning("Cannot close window for \(windowInfo.terminalApp.rawValue) - terminal not supported")
            return ""
        }
    }

    // MARK: - Permission Management

    /// Check if we have the required permissions.
    func checkPermissions() -> Bool {
        permissionChecker.checkPermissions()
    }

    /// Request accessibility permissions.
    func requestPermissions() {
        permissionChecker.requestPermissions()
    }

    // MARK: - Session Updates

    /// Updates window tracking based on current sessions.
    /// This method is called periodically to:
    /// 1. Remove windows for sessions that no longer exist
    /// 2. Try to find windows for ALL sessions without registered windows
    func updateFromSessions(_ sessions: [ServerSessionInfo]) {
        let sessionIDs = Set(sessions.map(\.id))

        // Remove windows for sessions that no longer exist
        mapLock.withLock {
            let trackedSessions = Set(sessionWindowMap.keys)
            let sessionsToRemove = trackedSessions.subtracting(sessionIDs)

            for sessionID in sessionsToRemove {
                if sessionWindowMap.removeValue(forKey: sessionID) != nil {
                    logger.info("Removed window tracking for terminated session: \(sessionID)")
                }
                // Also clean up the opened-by-us tracking
                sessionsOpenedByUs.remove(sessionID)
            }
        }
        
        // Check for sessions that have exited and close their windows if we opened them
        for session in sessions where session.status == "exited" {
            // Only close windows that we opened (not external vt attachments)
            if sessionsOpenedByUs.contains(session.id) {
                logger.info("Session \(session.id) has exited naturally, closing its window")
                _ = closeWindowIfOpenedByUs(for: session.id)
            }
        }

        // For ALL sessions without registered windows, try to find them
        // This handles:
        // 1. Sessions attached via `vt` command
        // 2. Sessions spawned through the app but window registration failed
        // 3. Any other session that has a terminal window
        for session in sessions where session.isRunning {
            if windowInfo(for: session.id) == nil {
                logger.debug("Session \(session.id) has no window registered, attempting to find it...")

                // Try to find the window for this session
                if let foundWindow = findWindowForSession(session.id, sessionInfo: session) {
                    mapLock.withLock {
                        sessionWindowMap[session.id] = foundWindow
                    }
                    logger
                        .info(
                            "Found and registered window for session: \(session.id) (attachedViaVT: \(session.attachedViaVT ?? false))"
                        )
                } else {
                    logger.debug("Could not find window for session: \(session.id)")
                }
            }
        }
    }

    // MARK: - Private Methods

    /// Finds a window for a specific terminal and session.
    private func findWindow(
        for terminal: Terminal,
        sessionID: String,
        tabReference: String?,
        tabID: String?
    )
        -> WindowEnumerator.WindowInfo?
    {
        let allWindows = WindowEnumerator.getAllTerminalWindows()
        let sessionInfo = getSessionInfo(for: sessionID)

        if let window = windowMatcher.findWindow(
            for: terminal,
            sessionID: sessionID,
            sessionInfo: sessionInfo,
            tabReference: tabReference,
            tabID: tabID,
            terminalWindows: allWindows
        ) {
            return createWindowInfo(
                from: window,
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
        from window: WindowEnumerator.WindowInfo,
        sessionID: String,
        terminal: Terminal,
        tabReference: String?,
        tabID: String?
    )
        -> WindowEnumerator.WindowInfo
    {
        WindowEnumerator.WindowInfo(
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

    /// Finds a terminal window for a session that was attached via `vt`.
    private func findWindowForSession(_ sessionID: String, sessionInfo: ServerSessionInfo) -> WindowEnumerator
        .WindowInfo?
    {
        let allWindows = WindowEnumerator.getAllTerminalWindows()

        if let window = windowMatcher
            .findWindowForSession(sessionID, sessionInfo: sessionInfo, allWindows: allWindows)
        {
            return WindowEnumerator.WindowInfo(
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

        return nil
    }

    /// Scans for a terminal window containing a specific session.
    /// This is used for sessions attached via `vt` that weren't launched through our app.
    private func scanForSession(_ sessionID: String) async {
        logger.info("Scanning for window containing session: \(sessionID)")

        // Get session info to match by working directory
        guard let sessionInfo = getSessionInfo(for: sessionID) else {
            logger.warning("No session info found for session: \(sessionID)")
            return
        }

        if let foundWindow = findWindowForSession(sessionID, sessionInfo: sessionInfo) {
            mapLock.withLock {
                sessionWindowMap[sessionID] = foundWindow
            }
            logger.info("Successfully found and registered window for session \(sessionID) during scan")
        } else {
            logger.warning("Could not find window for session \(sessionID) during scan")
        }
    }
}
