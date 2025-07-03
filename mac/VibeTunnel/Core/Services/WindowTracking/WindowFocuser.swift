import AppKit
import Foundation
import OSLog

/// Handles focusing specific terminal windows and tabs.
@MainActor
final class WindowFocuser {
    private let logger = Logger(
        subsystem: "sh.vibetunnel.vibetunnel",
        category: "WindowFocuser"
    )

    private let windowMatcher = WindowMatcher()
    private let highlightEffect: WindowHighlightEffect
    
    init() {
        // Load configuration from UserDefaults
        let config = Self.loadHighlightConfig()
        self.highlightEffect = WindowHighlightEffect(config: config)
        
        // Observe UserDefaults changes
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(userDefaultsDidChange),
            name: UserDefaults.didChangeNotification,
            object: nil
        )
    }
    
    deinit {
        NotificationCenter.default.removeObserver(self)
    }
    
    /// Load highlight configuration from UserDefaults
    private static func loadHighlightConfig() -> WindowHighlightConfig {
        let defaults = UserDefaults.standard
        let isEnabled = defaults.object(forKey: "windowHighlightEnabled") as? Bool ?? true
        let style = defaults.string(forKey: "windowHighlightStyle") ?? "default"
        
        guard isEnabled else {
            return WindowHighlightConfig(
                color: .clear,
                duration: 0,
                borderWidth: 0,
                glowRadius: 0,
                isEnabled: false
            )
        }
        
        switch style {
        case "subtle":
            return .subtle
        case "neon":
            return .neon
        case "custom":
            // Load custom color
            let colorData = defaults.data(forKey: "windowHighlightColor") ?? Data()
            if !colorData.isEmpty,
               let nsColor = try? NSKeyedUnarchiver.unarchivedObject(ofClass: NSColor.self, from: colorData) {
                return WindowHighlightConfig(
                    color: nsColor,
                    duration: 0.8,
                    borderWidth: 4.0,
                    glowRadius: 12.0,
                    isEnabled: true
                )
            }
            return .default
        default:
            return .default
        }
    }
    
    /// Handle UserDefaults changes
    @objc private func userDefaultsDidChange(_ notification: Notification) {
        // Update highlight configuration when settings change
        let newConfig = Self.loadHighlightConfig()
        highlightEffect.updateConfig(newConfig)
    }

    /// Focus a window based on terminal type
    func focusWindow(_ windowInfo: WindowEnumerator.WindowInfo) {
        switch windowInfo.terminalApp {
        case .terminal:
            // Terminal.app has special AppleScript support for tab selection
            focusTerminalAppWindow(windowInfo)
        case .iTerm2:
            // iTerm2 uses its own tab system, needs special handling
            focusiTerm2Window(windowInfo)
        default:
            // All other terminals that use macOS standard tabs
            focusWindowUsingAccessibility(windowInfo)
        }
    }

    /// Focuses a Terminal.app window/tab.
    private func focusTerminalAppWindow(_ windowInfo: WindowEnumerator.WindowInfo) {
        if let tabRef = windowInfo.tabReference {
            // Use stored tab reference to select the tab
            // The tabRef format is "tab id X of window id Y"
            // Escape the tab reference to prevent injection
            let escapedTabRef = tabRef.replacingOccurrences(of: "\"", with: "\\\"")
                .replacingOccurrences(of: "\n", with: "\\n")
                .replacingOccurrences(of: "\r", with: "\\r")
            
            let script = """
            tell application "Terminal"
                activate
                set selected of \(escapedTabRef) to true
                set frontmost of window id \(AppleScriptSecurity.escapeNumber(windowInfo.windowID)) to true
            end tell
            """

            do {
                try AppleScriptExecutor.shared.execute(script)
                logger.info("Focused Terminal.app tab using reference: \(tabRef)")
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
                    if id of w is \(AppleScriptSecurity.escapeNumber(windowInfo.windowID)) then
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
    private func focusiTerm2Window(_ windowInfo: WindowEnumerator.WindowInfo) {
        // iTerm2 has its own tab system that doesn't use standard macOS tabs
        // We need to use AppleScript to find and select the correct tab

        let sessionInfo = SessionMonitor.shared.sessions[windowInfo.sessionID]
        let workingDir = sessionInfo?.workingDir ?? ""
        let dirName = (workingDir as NSString).lastPathComponent
        
        // Escape all user-provided values to prevent injection
        let escapedSessionID = AppleScriptSecurity.escapeString(windowInfo.sessionID)
        let escapedDirName = AppleScriptSecurity.escapeString(dirName)
        let escapedTabID = windowInfo.tabID.map { AppleScriptSecurity.escapeString($0) } ?? ""

        // Try to find and focus the tab with matching content
        let script = """
        tell application "iTerm2"
            activate

            -- Look through all windows
            repeat with w in windows
                -- Look through all tabs in the window
                repeat with t in tabs of w
                    -- Look through all sessions in the tab
                    repeat with s in sessions of t
                        -- Check if the session's name or working directory matches
                        set sessionName to name of s

                        -- Try to match by session content
                        if sessionName contains "\(escapedSessionID)" or sessionName contains "\(escapedDirName)" then
                            -- Found it! Select this tab and window
                            select w
                            select t
                            select s
                            return "Found and selected session"
                        end if
                    end repeat
                end repeat
            end repeat

            -- If we have a window ID, at least focus that window
            if "\(escapedTabID)" is not "" then
                try
                    tell window id "\(escapedTabID)"
                        select
                    end tell
                end try
            end if
        end tell
        """

        do {
            let result = try AppleScriptExecutor.shared.executeWithResult(script)
            logger.info("iTerm2 focus result: \(result)")
        } catch {
            logger.error("Failed to focus iTerm2 window/tab: \(error)")
            // Fallback to accessibility
            focusWindowUsingAccessibility(windowInfo)
        }
    }

    /// Get the first tab group in a window (improved approach based on screenshot)
    private func getTabGroup(from window: AXElement) -> AXElement? {
        guard let children = window.children else {
            return nil
        }
        
        // Find the first element with role kAXTabGroupRole
        return children.first { elem in
            elem.role == kAXTabGroupRole
        }
    }

    /// Select the correct tab in a window that uses macOS standard tabs
    private func selectTab(
        tabs: [AXElement],
        windowInfo: WindowEnumerator.WindowInfo,
        sessionInfo: ServerSessionInfo?
    ) {
        logger.debug("Attempting to select tab for session \(windowInfo.sessionID) from \(tabs.count) tabs")

        // Try to find the correct tab
        if let matchingTab = windowMatcher.findMatchingTab(tabs: tabs, sessionInfo: sessionInfo) {
            // Found matching tab - select it using kAXPressAction (most reliable)
            if matchingTab.press() {
                logger.info("Successfully selected matching tab for session \(windowInfo.sessionID)")
            } else {
                logger.warning("Failed to select tab with kAXPressAction")

                // Try alternative selection method - set as selected
                if matchingTab.isAttributeSettable(kAXSelectedAttribute) {
                    let setResult = matchingTab.setSelected(true)
                    if setResult == .success {
                        logger.info("Selected tab using AXSelected attribute")
                    } else {
                        logger.error("Failed to set AXSelected attribute, error: \(setResult.rawValue)")
                    }
                }
            }
        } else if tabs.count == 1 {
            // If only one tab, select it
            tabs[0].press()
            logger.info("Selected the only available tab")
        } else {
            // Multiple tabs but no match - try to find by index or select first
            logger
                .warning(
                    "Multiple tabs (\(tabs.count)) but could not identify correct one for session \(windowInfo.sessionID)"
                )

            // Log tab titles for debugging
            for (index, tab) in tabs.enumerated() {
                if let title = tab.title {
                    logger.debug("  Tab \(index): \(title)")
                }
            }
        }
    }

    /// Select a tab by index in a tab group (helper method from screenshot)
    private func selectTab(at index: Int, in group: AXElement) -> Bool {
        guard let tabs = group.tabs,
              index < tabs.count
        else {
            logger.warning("Could not get tabs from group or index out of bounds")
            return false
        }
        
        return tabs[index].press()
    }

    /// Focuses a window by using the process PID directly
    private func focusWindowUsingPID(_ windowInfo: WindowEnumerator.WindowInfo) -> Bool {
        // Get session info for better matching
        let sessionInfo = SessionMonitor.shared.sessions[windowInfo.sessionID]
        // Create AXElement directly from the PID
        let axProcess = AXElement.application(pid: windowInfo.ownerPID)
        
        // Get windows from this specific process
        guard let windows = axProcess.windows,
              !windows.isEmpty
        else {
            logger.debug("PID-based lookup failed for PID \(windowInfo.ownerPID), no windows found")
            return false
        }
        
        logger.info("Found \(windows.count) window(s) for PID \(windowInfo.ownerPID)")
        
        // Single window case - simple!
        if windows.count == 1 {
            logger.info("Single window found for PID \(windowInfo.ownerPID), focusing it directly")
            let window = windows[0]
            
            // Show highlight effect
            highlightEffect.highlightWindow(window, bounds: window.frame())
            
            // Focus the window
            window.setMain(true)
            window.setFocused(true)
            
            // Bring app to front
            if let app = NSRunningApplication(processIdentifier: windowInfo.ownerPID) {
                app.activate()
            }
            
            return true
        }
        
        // Multiple windows - need to be smarter
        logger.info("Multiple windows found for PID \(windowInfo.ownerPID), using scoring system")
        
        // Use our existing scoring logic but only on these PID-specific windows
        var bestMatch: (window: AXElement, score: Int)?
        
        for (index, window) in windows.enumerated() {
            var matchScore = 0
            
            // Check window title for session ID or working directory (most reliable)
            if let title = window.title {
                logger.debug("Window \(index) title: '\(title)'")
                
                // Check for session ID in title
                if title.contains(windowInfo.sessionID) || title.contains("TTY_SESSION_ID=\(windowInfo.sessionID)") {
                    matchScore += 200 // Highest score for session ID match
                    logger.debug("Window \(index) has session ID in title!")
                }
                
                // Check for working directory in title
                if let sessionInfo = sessionInfo {
                    let workingDir = sessionInfo.workingDir
                    let dirName = (workingDir as NSString).lastPathComponent
                    
                    if !dirName.isEmpty && (title.contains(dirName) || title.hasSuffix(dirName) || title.hasSuffix(" - \(dirName)")) {
                        matchScore += 100 // High score for directory match
                        logger.debug("Window \(index) has working directory in title: \(dirName)")
                    }
                    
                    // Check for session name
                    if let sessionName = sessionInfo.name, !sessionName.isEmpty && title.contains(sessionName) {
                        matchScore += 150 // High score for session name match
                        logger.debug("Window \(index) has session name in title: \(sessionName)")
                    }
                }
            }
            
            // Check window ID (less reliable for terminals)
            if let axWindowID = window.windowID {
                if axWindowID == windowInfo.windowID {
                    matchScore += 50 // Lower score since window IDs can be unreliable
                    logger.debug("Window \(index) has matching ID: \(axWindowID)")
                }
            }
            
            // Check bounds if available (least reliable as windows can move)
            if let bounds = windowInfo.bounds,
               let windowFrame = window.frame() {
                let tolerance: CGFloat = 5.0
                if abs(windowFrame.origin.x - bounds.origin.x) < tolerance &&
                   abs(windowFrame.origin.y - bounds.origin.y) < tolerance &&
                   abs(windowFrame.width - bounds.width) < tolerance &&
                   abs(windowFrame.height - bounds.height) < tolerance
                {
                    matchScore += 25 // Lowest score for bounds match
                    logger.debug("Window \(index) bounds match")
                }
            }
            
            if matchScore > 0 && (bestMatch == nil || matchScore > bestMatch!.score) {
                bestMatch = (window, matchScore)
            }
        }
        
        if let best = bestMatch {
            logger.info("Focusing best match window with score \(best.score) for PID \(windowInfo.ownerPID)")
            
            // Show highlight effect
            highlightEffect.highlightWindow(best.window, bounds: best.window.frame())
            
            // Focus the window
            best.window.setMain(true)
            best.window.setFocused(true)
            
            // Bring app to front
            if let app = NSRunningApplication(processIdentifier: windowInfo.ownerPID) {
                app.activate()
            }
            
            return true
        }
        
        logger.error("No matching window found for PID \(windowInfo.ownerPID)")
        return false
    }

    /// Focuses a window using Accessibility APIs.
    private func focusWindowUsingAccessibility(_ windowInfo: WindowEnumerator.WindowInfo) {
        // First try PID-based approach
        if focusWindowUsingPID(windowInfo) {
            logger.info("Successfully focused window using PID-based approach")
            return
        }
        
        // Fallback to the original approach if PID-based fails
        logger.info("Falling back to terminal app-based window search")
        
        // First bring the application to front
        if let app = NSRunningApplication(processIdentifier: windowInfo.ownerPID) {
            app.activate()
            logger.info("Activated application with PID: \(windowInfo.ownerPID)")
        }

        // Use AXElement to focus the specific window
        let axApp = AXElement.application(pid: windowInfo.ownerPID)

        guard let windows = axApp.windows,
              !windows.isEmpty
        else {
            logger.error("Failed to get windows for application")
            return
        }

        logger
            .info(
                "Found \(windows.count) windows for \(windowInfo.terminalApp.rawValue), looking for window ID: \(windowInfo.windowID)"
            )

        // Get session info for tab matching
        let sessionInfo = SessionMonitor.shared.sessions[windowInfo.sessionID]

        // First, try to find window with matching tab content
        var bestMatchWindow: (window: AXElement, score: Int)?

        for (index, window) in windows.enumerated() {
            var matchScore = 0
            var windowMatches = false

            // Try window ID attribute for matching
            if let axWindowID = window.windowID {
                if axWindowID == windowInfo.windowID {
                    windowMatches = true
                    matchScore += 100 // High score for exact ID match
                }
                logger
                    .debug(
                        "Window \(index) windowID: \(axWindowID), target: \(windowInfo.windowID), matches: \(windowMatches)"
                    )
            }

            // Check window position and size as secondary validation
            if let bounds = windowInfo.bounds,
               let windowFrame = window.frame()
            {
                // Check if bounds approximately match (within 5 pixels tolerance)
                let tolerance: CGFloat = 5.0
                if abs(windowFrame.origin.x - bounds.origin.x) < tolerance &&
                    abs(windowFrame.origin.y - bounds.origin.y) < tolerance &&
                    abs(windowFrame.width - bounds.width) < tolerance &&
                    abs(windowFrame.height - bounds.height) < tolerance
                {
                    matchScore += 50 // Medium score for bounds match
                    logger
                        .debug(
                            "Window \(index) bounds match! Position: (\(windowFrame.origin.x), \(windowFrame.origin.y)), Size: (\(windowFrame.width), \(windowFrame.height))"
                        )
                }
            }

            // Check window title for session information
            if let title = window.title {
                logger.debug("Window \(index) title: '\(title)'")
                
                // Check for session ID in title (most reliable)
                if title.contains(windowInfo.sessionID) || title.contains("TTY_SESSION_ID=\(windowInfo.sessionID)") {
                    matchScore += 200 // Highest score
                    logger.debug("Window \(index) has session ID in title!")
                }
                
                // Check for session-specific information
                if let sessionInfo = sessionInfo {
                    let workingDir = sessionInfo.workingDir
                    let dirName = (workingDir as NSString).lastPathComponent
                    
                    if !dirName.isEmpty && (title.contains(dirName) || title.hasSuffix(dirName)) {
                        matchScore += 100
                        logger.debug("Window \(index) has working directory in title")
                    }
                    
                    if let sessionName = sessionInfo.name, !sessionName.isEmpty && title.contains(sessionName) {
                        matchScore += 150
                        logger.debug("Window \(index) has session name in title")
                    }
                }
                
                // Original title match logic as fallback
                if !title.isEmpty && (windowInfo.title?.contains(title) ?? false || title.contains(windowInfo.title ?? "")) {
                    matchScore += 25 // Low score for title match
                }
            }

            // Keep track of best match
            if matchScore > 0 && (bestMatchWindow == nil || matchScore > bestMatchWindow!.score) {
                bestMatchWindow = (window, matchScore)
                logger.debug("Window \(index) is new best match with score: \(matchScore)")
            }

            // Try the improved approach: get tab group first
            if let tabGroup = getTabGroup(from: window) {
                // Get tabs from the tab group
                if let tabs = tabGroup.tabs,
                   !tabs.isEmpty
                {
                    logger.info("Window \(index) has tab group with \(tabs.count) tabs")

                    // Try to find matching tab
                    if windowMatcher.findMatchingTab(tabs: tabs, sessionInfo: sessionInfo) != nil {
                        // Found the tab! Focus the window and select the tab
                        logger.info("Found matching tab in window \(index)")

                        // Show highlight effect
                        highlightEffect.highlightWindow(window, bounds: window.frame())

                        // Make window main and focused
                        window.setMain(true)
                        window.setFocused(true)

                        // Select the tab
                        selectTab(tabs: tabs, windowInfo: windowInfo, sessionInfo: sessionInfo)

                        return
                    }
                }
            } else {
                // Fallback: Try direct tabs attribute (older approach)
                if let tabs = window.tabs,
                   !tabs.isEmpty
                {
                    logger.info("Window \(index) has \(tabs.count) tabs (direct attribute)")

                    // Try to find matching tab
                    if windowMatcher.findMatchingTab(tabs: tabs, sessionInfo: sessionInfo) != nil {
                        // Found the tab! Focus the window and select the tab
                        logger.info("Found matching tab in window \(index)")

                        // Show highlight effect
                        highlightEffect.highlightWindow(window, bounds: window.frame())

                        // Make window main and focused
                        window.setMain(true)
                        window.setFocused(true)

                        // Select the tab
                        selectTab(tabs: tabs, windowInfo: windowInfo, sessionInfo: sessionInfo)

                        return
                    }
                }
            }
        }

        // After checking all windows, use the best match if we found one
        if let bestMatch = bestMatchWindow {
            logger.info("Using best match window with score \(bestMatch.score) for window ID \(windowInfo.windowID)")

            // Show highlight effect
            highlightEffect.highlightWindow(bestMatch.window, bounds: bestMatch.window.frame())

            // Focus the best matching window
            bestMatch.window.setMain(true)
            bestMatch.window.setFocused(true)

            // Try to select tab if available
            if sessionInfo != nil {
                // Try to get tabs and select the right one
                if let tabGroup = getTabGroup(from: bestMatch.window) {
                    if let tabs = tabGroup.tabs,
                       !tabs.isEmpty
                    {
                        selectTab(tabs: tabs, windowInfo: windowInfo, sessionInfo: sessionInfo)
                    }
                } else {
                    // Try direct tabs attribute
                    if let tabs = bestMatch.window.tabs,
                       !tabs.isEmpty
                    {
                        selectTab(tabs: tabs, windowInfo: windowInfo, sessionInfo: sessionInfo)
                    }
                }
            }

            logger.info("Focused best match window for session \(windowInfo.sessionID)")
        } else {
            // No match found at all - log error but don't focus random window
            logger
                .error(
                    "Failed to find window with ID \(windowInfo.windowID) for session \(windowInfo.sessionID). No windows matched by ID, position, or title."
                )
        }
    }
}
