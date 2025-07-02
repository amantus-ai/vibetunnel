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
            focusTerminalAppWindow(windowInfo)
        case .iTerm2:
            focusiTerm2Window(windowInfo)
        case .ghostty:
            focusGhosttyWindow(windowInfo)
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
        if let windowID = windowInfo.tabID {
            // Use window ID for focusing (stored in tabID for consistency)
            // iTerm2 uses 'select' to bring window to front
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
                logger.info("Focused iTerm2 window using ID: \(windowID)")
            } catch {
                logger.error("Failed to focus iTerm2 window: \(error)")
                // Fallback to accessibility
                focusWindowUsingAccessibility(windowInfo)
            }
        } else {
            // Fallback to window focusing
            focusWindowUsingAccessibility(windowInfo)
        }
    }
    
    /// Focuses a Ghostty window with macOS standard tabs.
    private func focusGhosttyWindow(_ windowInfo: WindowEnumerator.WindowInfo) {
        logger.info("Attempting to focus Ghostty window - windowID: \(windowInfo.windowID), ownerPID: \(windowInfo.ownerPID), sessionID: \(windowInfo.sessionID)")
        
        // First bring the application to front
        if let app = NSRunningApplication(processIdentifier: windowInfo.ownerPID) {
            app.activate()
        }
        
        // Ghostty uses macOS standard tabs, so we need to:
        // 1. Focus the window
        // 2. Find and select the correct tab
        
        // Use Accessibility API to handle tab selection
        let axApp = AXUIElementCreateApplication(windowInfo.ownerPID)
        
        var windowsValue: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &windowsValue)
        
        guard result == .success,
              let windows = windowsValue as? [AXUIElement],
              !windows.isEmpty else {
            logger.error("Failed to get Ghostty windows via Accessibility API")
            focusWindowUsingAccessibility(windowInfo)
            return
        }
        
        logger.info("Found \(windows.count) Ghostty windows, looking for window ID \(windowInfo.windowID)")
        
        // Get session info for tab matching
        let sessionInfo = SessionMonitor.shared.sessions[windowInfo.sessionID]
        
        // Find windows with matching tabs
        var windowWithMatchingTab: (window: AXUIElement, tabs: [AXUIElement])?
        
        for (windowIndex, window) in windows.enumerated() {
            // Check if this window has tabs
            var tabsValue: CFTypeRef?
            if AXUIElementCopyAttributeValue(window, kAXTabsAttribute as CFString, &tabsValue) == .success,
               let tabs = tabsValue as? [AXUIElement],
               !tabs.isEmpty {
                
                logger.debug("Window \(windowIndex) has \(tabs.count) tabs")
                
                // Check if any tab matches our session
                if windowMatcher.findMatchingTab(tabs: tabs, sessionInfo: sessionInfo) != nil {
                    windowWithMatchingTab = (window, tabs)
                    logger.debug("Window \(windowIndex) has a matching tab")
                }
            }
            
            // Check if this is the window we're looking for by window ID
            var windowIDValue: CFTypeRef?
            let windowIDResult = AXUIElementCopyAttributeValue(window, "_AXWindowNumber" as CFString, &windowIDValue)
            
            if windowIDResult == .success {
                if let axWindowID = windowIDValue as? Int, axWindowID == windowInfo.windowID {
                    logger.debug("Window \(windowIndex): Matched by AX window ID: \(axWindowID)")
                    
                    // This is our window - make it main and focused
                    AXUIElementSetAttributeValue(window, kAXMainAttribute as CFString, true as CFTypeRef)
                    AXUIElementSetAttributeValue(window, kAXFocusedAttribute as CFString, true as CFTypeRef)
                    
                    // If it has tabs, select the correct one
                    if let tabsValue = tabsValue as? [AXUIElement], !tabsValue.isEmpty {
                        selectGhosttyTab(tabs: tabsValue, windowInfo: windowInfo, sessionInfo: sessionInfo)
                    }
                    
                    logger.info("Focused Ghostty window with ID \(windowInfo.windowID)")
                    return
                }
            }
        }
        
        // If we couldn't find by window ID but found a window with matching tab content, use that
        if let matchingWindow = windowWithMatchingTab {
            AXUIElementSetAttributeValue(matchingWindow.window, kAXMainAttribute as CFString, true as CFTypeRef)
            AXUIElementSetAttributeValue(matchingWindow.window, kAXFocusedAttribute as CFString, true as CFTypeRef)
            
            // Select the correct tab
            selectGhosttyTab(tabs: matchingWindow.tabs, windowInfo: windowInfo, sessionInfo: sessionInfo)
            
            logger.info("Focused Ghostty window by tab content match (no window ID match)")
            return
        }
        
        // Fallback if we couldn't find the specific window
        logger.warning("Could not find matching Ghostty window with ID \(windowInfo.windowID), using fallback")
        focusWindowUsingAccessibility(windowInfo)
    }
    
    /// Select the correct Ghostty tab
    private func selectGhosttyTab(tabs: [AXUIElement], windowInfo: WindowEnumerator.WindowInfo, sessionInfo: ServerSessionInfo?) {
        // Try to find the correct tab
        if let matchingTab = windowMatcher.findMatchingTab(tabs: tabs, sessionInfo: sessionInfo) {
            AXUIElementPerformAction(matchingTab, kAXPressAction as CFString)
            logger.info("Selected matching Ghostty tab")
        } else if tabs.count == 1 {
            // If only one tab, select it
            AXUIElementPerformAction(tabs[0], kAXPressAction as CFString)
            logger.info("Selected only Ghostty tab")
        } else {
            // Multiple tabs but no match - log warning
            logger.warning("Multiple Ghostty tabs but could not identify correct one")
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
              !windows.isEmpty else {
            logger.error("Failed to get windows for application")
            return
        }
        
        // Try to find the window by comparing window IDs
        for window in windows {
            var windowIDValue: CFTypeRef?
            if AXUIElementCopyAttributeValue(window, kAXWindowAttribute as CFString, &windowIDValue) == .success,
               let windowNumber = windowIDValue as? Int,
               windowNumber == windowInfo.windowID {
                
                // Found the matching window, make it main and focused
                AXUIElementSetAttributeValue(window, kAXMainAttribute as CFString, true as CFTypeRef)
                AXUIElementSetAttributeValue(window, kAXFocusedAttribute as CFString, true as CFTypeRef)
                
                // For terminals that use macOS standard tabs, try to select the correct tab
                var tabsValue: CFTypeRef?
                if AXUIElementCopyAttributeValue(window, kAXTabsAttribute as CFString, &tabsValue) == .success,
                   let tabs = tabsValue as? [AXUIElement],
                   !tabs.isEmpty {
                    
                    logger.info("Terminal has \(tabs.count) tabs, attempting to find correct one")
                    
                    // Try to find the tab with matching session info
                    let sessionInfo = SessionMonitor.shared.sessions[windowInfo.sessionID]
                    if let matchingTab = windowMatcher.findMatchingTab(tabs: tabs, sessionInfo: sessionInfo) {
                        AXUIElementPerformAction(matchingTab, kAXPressAction as CFString)
                        logger.info("Selected matching tab for terminal \(windowInfo.terminalApp.rawValue)")
                    }
                }
                
                logger.info("Focused window using Accessibility API")
                return
            }
        }
        
        logger.warning("Could not find matching window in AXUIElement list")
    }
}