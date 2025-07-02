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

    /// Select the correct tab in a window that uses macOS standard tabs
    private func selectTab(
        tabs: [AXUIElement],
        windowInfo: WindowEnumerator.WindowInfo,
        sessionInfo: ServerSessionInfo?
    ) {
        logger.debug("Attempting to select tab for session \(windowInfo.sessionID) from \(tabs.count) tabs")
        
        // Try to find the correct tab
        if let matchingTab = windowMatcher.findMatchingTab(tabs: tabs, sessionInfo: sessionInfo) {
            // Found matching tab - select it
            let result = AXUIElementPerformAction(matchingTab, kAXPressAction as CFString)
            if result == .success {
                logger.info("Successfully selected matching tab for session \(windowInfo.sessionID)")
            } else {
                logger.warning("Failed to select tab, error: \(result.rawValue)")
                
                // Try alternative selection method - set as selected
                var selectedValue: CFTypeRef?
                if AXUIElementCopyAttributeValue(matchingTab, kAXSelectedAttribute as CFString, &selectedValue) == .success {
                    AXUIElementSetAttributeValue(matchingTab, kAXSelectedAttribute as CFString, true as CFTypeRef)
                    logger.info("Selected tab using AXSelected attribute")
                }
            }
        } else if tabs.count == 1 {
            // If only one tab, select it
            AXUIElementPerformAction(tabs[0], kAXPressAction as CFString)
            logger.info("Selected the only available tab")
        } else {
            // Multiple tabs but no match - try to find by index or select first
            logger.warning("Multiple tabs (\(tabs.count)) but could not identify correct one for session \(windowInfo.sessionID)")
            
            // Log tab titles for debugging
            for (index, tab) in tabs.enumerated() {
                var titleValue: CFTypeRef?
                if AXUIElementCopyAttributeValue(tab, kAXTitleAttribute as CFString, &titleValue) == .success,
                   let title = titleValue as? String {
                    logger.debug("  Tab \(index): \(title)")
                }
            }
        }
    }

    /// Focuses a window using Accessibility APIs.
    private func focusWindowUsingAccessibility(_ windowInfo: WindowEnumerator.WindowInfo) {
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

        logger.debug("Found \(windows.count) windows for \(windowInfo.terminalApp.rawValue)")

        // Get session info for tab matching
        let sessionInfo = SessionMonitor.shared.sessions[windowInfo.sessionID]
        
        // First, try to find window with matching tab content
        var foundWindowWithTab = false
        
        for (index, window) in windows.enumerated() {
            // Check different window ID attributes (different apps use different ones)
            var windowMatches = false
            
            // Try _AXWindowNumber (used by many apps)
            var windowIDValue: CFTypeRef?
            if AXUIElementCopyAttributeValue(window, "_AXWindowNumber" as CFString, &windowIDValue) == .success,
               let axWindowID = windowIDValue as? Int
            {
                windowMatches = (axWindowID == windowInfo.windowID)
                logger.debug("Window \(index) _AXWindowNumber: \(axWindowID), matches: \(windowMatches)")
            }
            
            // Check if this window has tabs
            var tabsValue: CFTypeRef?
            let hasTabsResult = AXUIElementCopyAttributeValue(window, kAXTabsAttribute as CFString, &tabsValue)
            
            if hasTabsResult == .success,
               let tabs = tabsValue as? [AXUIElement],
               !tabs.isEmpty
            {
                logger.info("Window \(index) has \(tabs.count) tabs")
                
                // Try to find matching tab
                if windowMatcher.findMatchingTab(tabs: tabs, sessionInfo: sessionInfo) != nil {
                    // Found the tab! Focus the window and select the tab
                    logger.info("Found matching tab in window \(index)")
                    
                    // Make window main and focused
                    AXUIElementSetAttributeValue(window, kAXMainAttribute as CFString, true as CFTypeRef)
                    AXUIElementSetAttributeValue(window, kAXFocusedAttribute as CFString, true as CFTypeRef)
                    
                    // Select the tab
                    selectTab(tabs: tabs, windowInfo: windowInfo, sessionInfo: sessionInfo)
                    
                    foundWindowWithTab = true
                    return
                }
            } else if windowMatches {
                // Window matches by ID but has no tabs (or tabs not accessible)
                logger.info("Window \(index) matches by ID but has no accessible tabs")
                
                // Focus the window anyway
                AXUIElementSetAttributeValue(window, kAXMainAttribute as CFString, true as CFTypeRef)
                AXUIElementSetAttributeValue(window, kAXFocusedAttribute as CFString, true as CFTypeRef)
                
                logger.info("Focused window \(windowInfo.windowID) without tab selection")
                return
            }
        }

        // If we didn't find a window with matching tab, just focus the first window
        if !foundWindowWithTab && !windows.isEmpty {
            logger.warning("No window found with matching tab, focusing first window")
            let firstWindow = windows[0]
            AXUIElementSetAttributeValue(firstWindow, kAXMainAttribute as CFString, true as CFTypeRef)
            AXUIElementSetAttributeValue(firstWindow, kAXFocusedAttribute as CFString, true as CFTypeRef)
        }
    }
}
