import AppKit
import Foundation
import OSLog

struct WindowMatchEvidence: Comparable, CustomStringConvertible {
    let strongest: Int
    let identity: Int

    var description: String {
        "\(self.strongest) (identity \(self.identity))"
    }

    static func < (lhs: Self, rhs: Self) -> Bool {
        if lhs.strongest != rhs.strongest {
            return lhs.strongest < rhs.strongest
        }
        return lhs.identity < rhs.identity
    }
}

enum WindowMatchScore {
    static let sessionID = 500
    static let windowID = 250
    static let sessionName = 200
    static let workingDirectory = 150
    static let bounds = 100
    static let directoryName = 100
    static let storedTitle = 25

    static func combined(identity: Int, content: Int) -> WindowMatchEvidence {
        WindowMatchEvidence(strongest: max(identity, content), identity: identity)
    }
}

/// Handles window matching and session-to-window mapping algorithms.
@MainActor
final class WindowMatcher {
    struct TabMatch {
        let tab: AXElement
        let score: Int
    }

    private let logger = Logger(
        subsystem: BundleIdentifiers.loggerSubsystem,
        category: "WindowMatcher")

    private let processTracker = ProcessTracker()

    /// Find a window for a specific terminal and session
    func findWindow(
        for terminal: Terminal,
        sessionID: String,
        sessionInfo: ServerSessionInfo?,
        tabReference: String?,
        tabID: String?,
        terminalWindows: [WindowInfo])
        -> WindowInfo?
    {
        // Filter windows for the specific terminal
        let filteredWindows = terminalWindows.filter { $0.terminalApp == terminal }

        // First try to find window by process PID traversal
        if let sessionInfo, let sessionPID = sessionInfo.pid {
            self.logger.debug("Attempting to find window by process PID: \(sessionPID)")

            // For debugging: log the process tree
            self.processTracker.logProcessTree(for: pid_t(sessionPID))

            // Try to find the parent process (shell) that owns this session
            if let parentPID = processTracker.getParentProcessID(of: pid_t(sessionPID)) {
                self.logger.debug("Found parent process PID: \(parentPID)")

                // Look for windows owned by the parent process
                let parentPIDWindows = filteredWindows.filter { window in
                    window.ownerPID == parentPID
                }

                if parentPIDWindows.count == 1 {
                    self.logger.info("Found single window by parent process match: PID \(parentPID)")
                    return parentPIDWindows.first
                } else if parentPIDWindows.count > 1 {
                    self.logger
                        .info(
                            "Found \(parentPIDWindows.count) windows for PID \(parentPID), checking session ID in titles")

                    // Multiple windows - try to match by session ID in title
                    if let matchingWindow = parentPIDWindows.first(where: { window in
                        window.title?.contains("Session \(sessionID)") ?? false
                    }) {
                        self.logger.info("Found window by session ID '\(sessionID)' in title")
                        return matchingWindow
                    }

                    // If no session ID match, return first window
                    self.logger.warning("No window with session ID in title, using first window")
                    return parentPIDWindows.first
                }

                // If direct parent match fails, try to find grandparent or higher ancestors
                var currentPID = parentPID
                var depth = 0
                while depth < 10 { // Increased depth for nested shell sessions
                    if let grandParentPID = processTracker.getParentProcessID(of: currentPID) {
                        self.logger.debug("Checking ancestor process PID: \(grandParentPID) at depth \(depth + 2)")

                        let ancestorPIDWindows = filteredWindows.filter { window in
                            window.ownerPID == grandParentPID
                        }

                        if ancestorPIDWindows.count == 1 {
                            self.logger
                                .info(
                                    "Found single window by ancestor process match: PID \(grandParentPID) at depth \(depth + 2)")
                            return ancestorPIDWindows.first
                        } else if ancestorPIDWindows.count > 1 {
                            self.logger
                                .info(
                                    "Found \(ancestorPIDWindows.count) windows for ancestor PID \(grandParentPID), checking session ID")

                            // Multiple windows - try to match by session ID in title
                            if let matchingWindow = ancestorPIDWindows.first(where: { window in
                                window.title?.contains("Session \(sessionID)") ?? false
                            }) {
                                self.logger.info("Found window by session ID '\(sessionID)' in title")
                                return matchingWindow
                            }

                            // If no session ID match, return first window
                            return ancestorPIDWindows.first
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
        if let sessionInfo {
            let workingDir = sessionInfo.workingDir
            let dirName = (workingDir as NSString).lastPathComponent

            // Look for windows whose title contains the directory name
            if let matchingWindow = filteredWindows.first(where: { window in
                WindowEnumerator.windowTitleContains(window, identifier: dirName) ||
                    WindowEnumerator.windowTitleContains(window, identifier: workingDir)
            }) {
                self.logger.debug("Found window by directory match: \(dirName)")
                return matchingWindow
            }
        }

        // For Terminal.app with specific tab reference
        if terminal == .terminal, let tabRef = tabReference {
            if let windowID = WindowEnumerator.extractWindowID(from: tabRef) {
                if let matchingWindow = filteredWindows.first(where: { $0.windowID == windowID }) {
                    self.logger.debug("Found Terminal.app window by ID: \(windowID)")
                    return matchingWindow
                }
            }
        }

        // For iTerm2 with tab ID
        if terminal == .iTerm2, let tabID {
            // Try to match by window title which often includes the window ID
            if let matchingWindow = filteredWindows.first(where: { window in
                WindowEnumerator.windowTitleContains(window, identifier: tabID)
            }) {
                self.logger.debug("Found iTerm2 window by ID in title: \(tabID)")
                return matchingWindow
            }
        }

        // Fallback: return the most recently created window (highest window ID)
        if let latestWindow = filteredWindows.max(by: { $0.windowID < $1.windowID }) {
            self.logger.debug("Using most recent window as fallback for session: \(sessionID)")
            return latestWindow
        }

        return nil
    }

    /// Find a terminal window for a session that was attached via `vt`
    func findWindowForSession(
        _ sessionID: String,
        sessionInfo: ServerSessionInfo,
        allWindows: [WindowInfo])
        -> WindowInfo?
    {
        // First try to find window by process PID traversal
        if let sessionPID = sessionInfo.pid {
            self.logger.debug("Scanning for window by process PID: \(sessionPID) for session \(sessionID)")

            // Log the process tree for debugging
            self.processTracker.logProcessTree(for: pid_t(sessionPID))

            // Try to traverse up the process tree to find a terminal window
            var currentPID = pid_t(sessionPID)
            var depth = 0
            let maxDepth = 20 // Increased depth for deeply nested sessions

            while depth < maxDepth {
                // Check if any window is owned by this PID
                if let matchingWindow = allWindows.first(where: { window in
                    window.ownerPID == currentPID
                }) {
                    self.logger.info("Found window by PID \(currentPID) at depth \(depth) for session \(sessionID)")
                    return matchingWindow
                }

                // Move up to parent process
                if let parentPID = processTracker.getParentProcessID(of: currentPID) {
                    if parentPID == 0 || parentPID == 1 {
                        // Reached root process
                        break
                    }
                    currentPID = parentPID
                    depth += 1
                } else {
                    break
                }
            }

            self.logger.debug("Process traversal completed at depth \(depth) without finding window")
        }

        // Fallback: Find by working directory
        let workingDir = sessionInfo.workingDir
        let dirName = (workingDir as NSString).lastPathComponent

        self.logger.debug("Trying to match by directory: \(dirName) or full path: \(workingDir)")

        // Look for windows whose title contains the directory name
        if let matchingWindow = allWindows.first(where: { window in
            if let title = window.title {
                let matches = title.contains(dirName) || title.contains(workingDir)
                if matches {
                    logger.debug("Window title '\(title)' matches directory")
                }
                return matches
            }
            return false
        }) {
            self.logger.info("Found window by directory match: \(dirName) for session \(sessionID)")
            return matchingWindow
        }

        self.logger.warning("Could not find window for session \(sessionID) after all attempts")
        self.logger.debug("Available windows: \(allWindows.count)")
        for (index, window) in allWindows.enumerated() {
            self.logger
                .debug(
                    "  Window \(index): PID=\(window.ownerPID), Terminal=\(window.terminalApp.rawValue), Title=\(window.title ?? "<no title>")")
        }

        return nil
    }

    /// Find matching tab using accessibility APIs
    func findMatchingTab(tabs: [AXElement], sessionInfo: ServerSessionInfo?) -> AXElement? {
        self.findBestMatchingTab(tabs: tabs, sessionInfo: sessionInfo)?.tab
    }

    /// Find the strongest matching tab and its confidence score.
    func findBestMatchingTab(tabs: [AXElement], sessionInfo: ServerSessionInfo?) -> TabMatch? {
        guard let sessionInfo else { return nil }

        self.logger.debug("Looking for tab matching session \(sessionInfo.id) in \(tabs.count) tabs")
        var bestMatch: TabMatch?

        for (index, tab) in tabs.enumerated() {
            if let title = tab.title {
                self.logger.debug("Tab \(index) title: \(title)")

                if let score = self.tabMatchScore(for: title, sessionInfo: sessionInfo),
                   bestMatch == nil || score > bestMatch?.score ?? 0
                {
                    bestMatch = TabMatch(tab: tab, score: score)
                    self.logger.info("Tab \(index) is the best match with score \(score)")
                }
            } else {
                self.logger.debug("Tab \(index): Could not get title")
            }
        }

        if bestMatch == nil {
            self.logger.warning("No matching tab found for session \(sessionInfo.id)")
        }
        return bestMatch
    }

    /// Score tab-title evidence so precise session matches can beat stale window metadata.
    func tabMatchScore(for title: String, sessionInfo: ServerSessionInfo) -> Int? {
        if !sessionInfo.id.isEmpty,
           title.contains(sessionInfo.id) || title.contains("TTY_SESSION_ID=\(sessionInfo.id)")
        {
            return WindowMatchScore.sessionID
        }

        if !sessionInfo.name.isEmpty, title.contains(sessionInfo.name) {
            return WindowMatchScore.sessionName
        }

        let titleLower = title.lowercased()
        let workingDirLower = sessionInfo.workingDir.lowercased()
        if !workingDirLower.isEmpty, titleLower.contains(workingDirLower) {
            return WindowMatchScore.workingDirectory
        }

        let dirName = (sessionInfo.workingDir as NSString).lastPathComponent
        let dirNameLower = dirName.lowercased()
        if !dirNameLower.isEmpty,
           titleLower.contains(dirNameLower) ||
           title.hasSuffix(dirName) ||
           title.hasSuffix(" - \(dirName)")
        {
            return WindowMatchScore.directoryName
        }

        return nil
    }
}
