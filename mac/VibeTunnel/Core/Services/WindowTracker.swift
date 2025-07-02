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

    /// Maps session IDs to their terminal window information
    private var sessionWindowMap: [String: WindowEnumerator.WindowInfo] = [:]

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
            }

            logger.warning("Failed to register window for session \(sessionID) after all attempts")
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
