import AppKit
import Foundation
import OSLog

/// Handles window matching and session-to-window mapping algorithms.
@MainActor
final class WindowMatcher {
    private let logger = Logger(
        subsystem: "sh.vibetunnel.vibetunnel",
        category: "WindowMatcher"
    )
    
    private let processTracker = ProcessTracker()
    
    /// Find a window for a specific terminal and session
    func findWindow(
        for terminal: Terminal,
        sessionID: String,
        sessionInfo: ServerSessionInfo?,
        tabReference: String?,
        tabID: String?,
        terminalWindows: [WindowEnumerator.WindowInfo]
    ) -> WindowEnumerator.WindowInfo? {
        // Filter windows for the specific terminal
        let filteredWindows = terminalWindows.filter { $0.terminalApp == terminal }
        
        // First try to find window by process PID traversal
        if let sessionInfo = sessionInfo, let sessionPID = sessionInfo.pid {
            logger.debug("Attempting to find window by process PID: \(sessionPID)")
            
            // For debugging: log the process tree
            processTracker.logProcessTree(for: pid_t(sessionPID))
            
            // Try to find the parent process (shell) that owns this session
            if let parentPID = processTracker.getParentProcessID(of: pid_t(sessionPID)) {
                logger.debug("Found parent process PID: \(parentPID)")
                
                // Look for a window owned by the parent process
                if let matchingWindow = filteredWindows.first(where: { window in
                    window.ownerPID == parentPID
                }) {
                    logger.info("Found window by parent process match: PID \(parentPID)")
                    return matchingWindow
                }
                
                // If direct parent match fails, try to find grandparent or higher ancestors
                var currentPID = parentPID
                var depth = 0
                while depth < 10 { // Increased depth for nested shell sessions
                    if let grandParentPID = processTracker.getParentProcessID(of: currentPID) {
                        logger.debug("Checking ancestor process PID: \(grandParentPID) at depth \(depth + 2)")
                        
                        if let matchingWindow = filteredWindows.first(where: { window in
                            window.ownerPID == grandParentPID
                        }) {
                            logger.info("Found window by ancestor process match: PID \(grandParentPID) at depth \(depth + 2)")
                            return matchingWindow
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
        if let sessionInfo = sessionInfo {
            let workingDir = sessionInfo.workingDir
            let dirName = (workingDir as NSString).lastPathComponent
            
            // Look for windows whose title contains the directory name
            if let matchingWindow = filteredWindows.first(where: { window in
                WindowEnumerator.windowTitleContains(window, identifier: dirName) ||
                WindowEnumerator.windowTitleContains(window, identifier: workingDir)
            }) {
                logger.debug("Found window by directory match: \(dirName)")
                return matchingWindow
            }
        }
        
        // For Terminal.app with specific tab reference
        if terminal == .terminal, let tabRef = tabReference {
            if let windowID = WindowEnumerator.extractWindowID(from: tabRef) {
                if let matchingWindow = filteredWindows.first(where: { $0.windowID == windowID }) {
                    logger.debug("Found Terminal.app window by ID: \(windowID)")
                    return matchingWindow
                }
            }
        }
        
        // For iTerm2 with tab ID
        if terminal == .iTerm2, let tabID = tabID {
            // Try to match by window title which often includes the window ID
            if let matchingWindow = filteredWindows.first(where: { window in
                WindowEnumerator.windowTitleContains(window, identifier: tabID)
            }) {
                logger.debug("Found iTerm2 window by ID in title: \(tabID)")
                return matchingWindow
            }
        }
        
        // Fallback: return the most recently created window (highest window ID)
        if let latestWindow = filteredWindows.max(by: { $0.windowID < $1.windowID }) {
            logger.debug("Using most recent window as fallback for session: \(sessionID)")
            return latestWindow
        }
        
        return nil
    }
    
    /// Find a terminal window for a session that was attached via `vt`
    func findWindowForSession(
        _ sessionID: String,
        sessionInfo: ServerSessionInfo,
        allWindows: [WindowEnumerator.WindowInfo]
    ) -> WindowEnumerator.WindowInfo? {
        // First try to find window by process PID traversal
        if let sessionPID = sessionInfo.pid {
            logger.debug("Scanning by process PID: \(sessionPID)")
            
            // Try to find the parent process (shell) that owns this session
            if let parentPID = processTracker.getParentProcessID(of: pid_t(sessionPID)) {
                logger.debug("Found parent process PID (scan): \(parentPID)")
                
                // Look for a window owned by the parent process
                if let matchingWindow = allWindows.first(where: { window in
                    window.ownerPID == parentPID
                }) {
                    logger.info("Found window by parent process match (scan): PID \(parentPID) for session \(sessionID)")
                    return matchingWindow
                }
            }
        }
        
        // Fallback: Find by working directory
        let workingDir = sessionInfo.workingDir
        let dirName = (workingDir as NSString).lastPathComponent
        
        // Look for windows whose title contains the directory name
        if let matchingWindow = allWindows.first(where: { window in
            WindowEnumerator.windowTitleContains(window, identifier: dirName) ||
            WindowEnumerator.windowTitleContains(window, identifier: workingDir)
        }) {
            logger.info("Found window by directory match (scan): \(dirName) for session \(sessionID)")
            return matchingWindow
        }
        
        // Try to match by activity status (for sessions with specific activities)
        if let activity = sessionInfo.activityStatus?.specificStatus?.status {
            if let matchingWindow = allWindows.first(where: { window in
                WindowEnumerator.windowTitleContains(window, identifier: activity)
            }) {
                logger.info("Found window by activity match (scan): \(activity) for session \(sessionID)")
                return matchingWindow
            }
        }
        
        logger.warning("Could not find window for session \(sessionID) during scan")
        return nil
    }
    
    /// Find matching tab using accessibility APIs
    func findMatchingTab(tabs: [AXUIElement], sessionInfo: ServerSessionInfo?) -> AXUIElement? {
        guard let sessionInfo = sessionInfo else { return nil }
        
        let workingDir = sessionInfo.workingDir
        let dirName = (workingDir as NSString).lastPathComponent
        let sessionID = sessionInfo.id
        let activityStatus = sessionInfo.activityStatus?.specificStatus?.status
        
        for tab in tabs {
            var titleValue: CFTypeRef?
            if AXUIElementCopyAttributeValue(tab, kAXTitleAttribute as CFString, &titleValue) == .success,
               let title = titleValue as? String {
                
                // Check for session ID match first (most precise)
                if title.contains(sessionID) || title.contains("TTY_SESSION_ID=\(sessionID)") {
                    logger.info("Found tab by session ID match")
                    return tab
                }
                
                // Check for activity status match
                if let activity = activityStatus, !activity.isEmpty, title.contains(activity) {
                    logger.info("Found tab by activity match: \(activity)")
                    return tab
                }
                
                // Check for directory match
                if title.contains(dirName) || title.contains(workingDir) {
                    logger.info("Found tab by directory match")
                    return tab
                }
            }
        }
        
        return nil
    }
}