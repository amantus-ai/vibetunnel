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
            let script = """
            tell application "Terminal"
                activate
                set selected of \(tabRef) to true
                set frontmost of window id \(windowInfo.windowID) to true
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
    private func focusiTerm2Window(_ windowInfo: WindowEnumerator.WindowInfo) {
        // iTerm2 has its own tab system that doesn't use standard macOS tabs
        // We need to use AppleScript to find and select the correct tab

        let sessionInfo = SessionMonitor.shared.sessions[windowInfo.sessionID]
        let workingDir = sessionInfo?.workingDir ?? ""
        let dirName = (workingDir as NSString).lastPathComponent

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
                        if sessionName contains "\(windowInfo.sessionID)" or sessionName contains "\(dirName)" then
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
            if "\(windowInfo.tabID ?? "")" is not "" then
                try
                    tell window id "\(windowInfo.tabID ?? "")"
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
    private func getTabGroup(from window: AXUIElement) -> AXUIElement? {
        var childrenRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(
            window,
            kAXChildrenAttribute as CFString,
            &childrenRef
        ) == .success,
            let children = childrenRef as? [AXUIElement]
        else {
            return nil
        }

        // Find the first element with role kAXTabGroupRole
        return children.first { elem in
            var roleRef: CFTypeRef?
            AXUIElementCopyAttributeValue(elem, kAXRoleAttribute as CFString, &roleRef)
            return (roleRef as? String) == kAXTabGroupRole as String
        }
    }

    /// Select the correct tab in a window that uses macOS standard tabs
    private func selectTab(
        tabs: [AXUIElement],
        windowInfo: WindowEnumerator.WindowInfo,
        sessionInfo: ServerSessionInfo?
    ) {
        logger.debug("Attempting to select tab for session \(windowInfo.sessionID) from \(tabs.count) tabs")

        // Try to find the correct tab
        if let matchingTab = windowMatcher.findMatchingTab(tabs: tabs, sessionInfo: sessionInfo) {
            // Found matching tab - select it using kAXPressAction (most reliable)
            let result = AXUIElementPerformAction(matchingTab, kAXPressAction as CFString)
            if result == .success {
                logger.info("Successfully selected matching tab for session \(windowInfo.sessionID)")
            } else {
                logger.warning("Failed to select tab with kAXPressAction, error: \(result.rawValue)")

                // Try alternative selection method - set as selected
                var selectedValue: CFTypeRef?
                if AXUIElementCopyAttributeValue(matchingTab, kAXSelectedAttribute as CFString, &selectedValue) ==
                    .success
                {
                    let setResult = AXUIElementSetAttributeValue(
                        matchingTab,
                        kAXSelectedAttribute as CFString,
                        true as CFTypeRef
                    )
                    if setResult == .success {
                        logger.info("Selected tab using AXSelected attribute")
                    } else {
                        logger.error("Failed to set AXSelected attribute, error: \(setResult.rawValue)")
                    }
                }
            }
        } else if tabs.count == 1 {
            // If only one tab, select it
            AXUIElementPerformAction(tabs[0], kAXPressAction as CFString)
            logger.info("Selected the only available tab")
        } else {
            // Multiple tabs but no match - try to find by index or select first
            logger
                .warning(
                    "Multiple tabs (\(tabs.count)) but could not identify correct one for session \(windowInfo.sessionID)"
                )

            // Log tab titles for debugging
            for (index, tab) in tabs.enumerated() {
                var titleValue: CFTypeRef?
                if AXUIElementCopyAttributeValue(tab, kAXTitleAttribute as CFString, &titleValue) == .success,
                   let title = titleValue as? String
                {
                    logger.debug("  Tab \(index): \(title)")
                }
            }
        }
    }

    /// Select a tab by index in a tab group (helper method from screenshot)
    private func selectTab(at index: Int, in group: AXUIElement) -> Bool {
        var tabsRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(
            group,
            "AXTabs" as CFString,
            &tabsRef
        ) == .success,
            let tabs = tabsRef as? [AXUIElement],
            index < tabs.count
        else {
            logger.warning("Could not get tabs from group or index out of bounds")
            return false
        }

        let result = AXUIElementPerformAction(tabs[index], kAXPressAction as CFString)
        return result == .success
    }

    /// Focuses a window by using the process PID directly
    private func focusWindowUsingPID(_ windowInfo: WindowEnumerator.WindowInfo) -> Bool {
        // Create AXUIElement directly from the PID
        let axProcess = AXUIElementCreateApplication(windowInfo.ownerPID)
        
        // Get windows from this specific process
        var windowsValue: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(axProcess, kAXWindowsAttribute as CFString, &windowsValue)
        
        guard result == .success,
              let windows = windowsValue as? [AXUIElement],
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
            
            // Focus the window
            AXUIElementSetAttributeValue(window, kAXMainAttribute as CFString, true as CFTypeRef)
            AXUIElementSetAttributeValue(window, kAXFocusedAttribute as CFString, true as CFTypeRef)
            
            // Bring app to front
            if let app = NSRunningApplication(processIdentifier: windowInfo.ownerPID) {
                app.activate()
            }
            
            return true
        }
        
        // Multiple windows - need to be smarter
        logger.info("Multiple windows found for PID \(windowInfo.ownerPID), using scoring system")
        
        // Use our existing scoring logic but only on these PID-specific windows
        var bestMatch: (window: AXUIElement, score: Int)?
        
        for (index, window) in windows.enumerated() {
            var matchScore = 0
            
            // Check window ID
            var windowIDValue: CFTypeRef?
            if AXUIElementCopyAttributeValue(window, "_AXWindowNumber" as CFString, &windowIDValue) == .success,
               let axWindowID = windowIDValue as? Int
            {
                if axWindowID == windowInfo.windowID {
                    matchScore += 100
                    logger.debug("Window \(index) has matching ID: \(axWindowID)")
                }
            }
            
            // Check bounds if available
            if let bounds = windowInfo.bounds {
                var positionValue: CFTypeRef?
                var sizeValue: CFTypeRef?
                if AXUIElementCopyAttributeValue(window, kAXPositionAttribute as CFString, &positionValue) == .success,
                   AXUIElementCopyAttributeValue(window, kAXSizeAttribute as CFString, &sizeValue) == .success,
                   let position = positionValue as? CGPoint,
                   let size = sizeValue as? CGSize
                {
                    let tolerance: CGFloat = 5.0
                    if abs(position.x - bounds.origin.x) < tolerance &&
                       abs(position.y - bounds.origin.y) < tolerance &&
                       abs(size.width - bounds.width) < tolerance &&
                       abs(size.height - bounds.height) < tolerance
                    {
                        matchScore += 50
                        logger.debug("Window \(index) bounds match")
                    }
                }
            }
            
            if matchScore > 0 && (bestMatch == nil || matchScore > bestMatch!.score) {
                bestMatch = (window, matchScore)
            }
        }
        
        if let best = bestMatch {
            logger.info("Focusing best match window with score \(best.score) for PID \(windowInfo.ownerPID)")
            
            // Focus the window
            AXUIElementSetAttributeValue(best.window, kAXMainAttribute as CFString, true as CFTypeRef)
            AXUIElementSetAttributeValue(best.window, kAXFocusedAttribute as CFString, true as CFTypeRef)
            
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

        logger
            .info(
                "Found \(windows.count) windows for \(windowInfo.terminalApp.rawValue), looking for window ID: \(windowInfo.windowID)"
            )

        // Get session info for tab matching
        let sessionInfo = SessionMonitor.shared.sessions[windowInfo.sessionID]

        // First, try to find window with matching tab content
        var bestMatchWindow: (window: AXUIElement, score: Int)?

        for (index, window) in windows.enumerated() {
            var matchScore = 0
            var windowMatches = false

            // Try multiple window ID attributes for robust matching

            // 1. Try _AXWindowNumber (most common)
            var windowIDValue: CFTypeRef?
            if AXUIElementCopyAttributeValue(window, "_AXWindowNumber" as CFString, &windowIDValue) == .success,
               let axWindowID = windowIDValue as? Int
            {
                if axWindowID == windowInfo.windowID {
                    windowMatches = true
                    matchScore += 100 // High score for exact ID match
                }
                logger
                    .debug(
                        "Window \(index) _AXWindowNumber: \(axWindowID), target: \(windowInfo.windowID), matches: \(windowMatches)"
                    )
            }

            // 2. Try kAXWindowAttribute (some apps use this)
            if !windowMatches {
                var windowNumValue: CFTypeRef?
                if AXUIElementCopyAttributeValue(window, "AXWindow" as CFString, &windowNumValue) == .success,
                   let axWindowNum = windowNumValue as? Int
                {
                    if axWindowNum == windowInfo.windowID {
                        windowMatches = true
                        matchScore += 100
                    }
                    logger
                        .debug(
                            "Window \(index) AXWindow: \(axWindowNum), target: \(windowInfo.windowID), matches: \(windowMatches)"
                        )
                }
            }

            // 3. Check window position and size as secondary validation
            if let bounds = windowInfo.bounds {
                var positionValue: CFTypeRef?
                var sizeValue: CFTypeRef?
                if AXUIElementCopyAttributeValue(window, kAXPositionAttribute as CFString, &positionValue) == .success,
                   AXUIElementCopyAttributeValue(window, kAXSizeAttribute as CFString, &sizeValue) == .success,
                   let position = positionValue as? CGPoint,
                   let size = sizeValue as? CGSize
                {
                    // Check if bounds approximately match (within 5 pixels tolerance)
                    let tolerance: CGFloat = 5.0
                    if abs(position.x - bounds.origin.x) < tolerance &&
                        abs(position.y - bounds.origin.y) < tolerance &&
                        abs(size.width - bounds.width) < tolerance &&
                        abs(size.height - bounds.height) < tolerance
                    {
                        matchScore += 50 // Medium score for bounds match
                        logger
                            .debug(
                                "Window \(index) bounds match! Position: (\(position.x), \(position.y)), Size: (\(size.width), \(size.height))"
                            )
                    }
                }
            }

            // 4. Check window title
            var titleValue: CFTypeRef?
            if AXUIElementCopyAttributeValue(window, kAXTitleAttribute as CFString, &titleValue) == .success,
               let title = titleValue as? String
            {
                logger.debug("Window \(index) title: '\(title)'")
                if !title
                    .isEmpty && (windowInfo.title?.contains(title) ?? false || title.contains(windowInfo.title ?? ""))
                {
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
                var tabsValue: CFTypeRef?
                if AXUIElementCopyAttributeValue(tabGroup, "AXTabs" as CFString, &tabsValue) == .success,
                   let tabs = tabsValue as? [AXUIElement],
                   !tabs.isEmpty
                {
                    logger.info("Window \(index) has tab group with \(tabs.count) tabs")

                    // Try to find matching tab
                    if windowMatcher.findMatchingTab(tabs: tabs, sessionInfo: sessionInfo) != nil {
                        // Found the tab! Focus the window and select the tab
                        logger.info("Found matching tab in window \(index)")

                        // Make window main and focused
                        AXUIElementSetAttributeValue(window, kAXMainAttribute as CFString, true as CFTypeRef)
                        AXUIElementSetAttributeValue(window, kAXFocusedAttribute as CFString, true as CFTypeRef)

                        // Select the tab
                        selectTab(tabs: tabs, windowInfo: windowInfo, sessionInfo: sessionInfo)

                        return
                    }
                }
            } else {
                // Fallback: Try direct tabs attribute (older approach)
                var tabsValue: CFTypeRef?
                let hasTabsResult = AXUIElementCopyAttributeValue(window, kAXTabsAttribute as CFString, &tabsValue)

                if hasTabsResult == .success,
                   let tabs = tabsValue as? [AXUIElement],
                   !tabs.isEmpty
                {
                    logger.info("Window \(index) has \(tabs.count) tabs (direct attribute)")

                    // Try to find matching tab
                    if windowMatcher.findMatchingTab(tabs: tabs, sessionInfo: sessionInfo) != nil {
                        // Found the tab! Focus the window and select the tab
                        logger.info("Found matching tab in window \(index)")

                        // Make window main and focused
                        AXUIElementSetAttributeValue(window, kAXMainAttribute as CFString, true as CFTypeRef)
                        AXUIElementSetAttributeValue(window, kAXFocusedAttribute as CFString, true as CFTypeRef)

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

            // Focus the best matching window
            AXUIElementSetAttributeValue(bestMatch.window, kAXMainAttribute as CFString, true as CFTypeRef)
            AXUIElementSetAttributeValue(bestMatch.window, kAXFocusedAttribute as CFString, true as CFTypeRef)

            // Try to select tab if available
            if sessionInfo != nil {
                // Try to get tabs and select the right one
                if let tabGroup = getTabGroup(from: bestMatch.window) {
                    var tabsValue: CFTypeRef?
                    if AXUIElementCopyAttributeValue(tabGroup, "AXTabs" as CFString, &tabsValue) == .success,
                       let tabs = tabsValue as? [AXUIElement],
                       !tabs.isEmpty
                    {
                        selectTab(tabs: tabs, windowInfo: windowInfo, sessionInfo: sessionInfo)
                    }
                } else {
                    // Try direct tabs attribute
                    var tabsValue: CFTypeRef?
                    if AXUIElementCopyAttributeValue(bestMatch.window, kAXTabsAttribute as CFString, &tabsValue) ==
                        .success,
                        let tabs = tabsValue as? [AXUIElement],
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
