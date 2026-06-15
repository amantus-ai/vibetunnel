import AppKit
import Foundation
import OSLog

/// Handles focusing specific terminal windows and tabs.
@MainActor
final class WindowFocuser {
    private struct WindowTabMatch {
        let window: AXElement
        let tabs: [AXElement]
        let score: WindowMatchEvidence
    }

    private let logger = Logger(
        subsystem: BundleIdentifiers.loggerSubsystem,
        category: "WindowFocuser")

    private let windowMatcher = WindowMatcher()
    private let highlightEffect: WindowHighlightEffect

    init() {
        // Load configuration from UserDefaults
        let config = Self.loadHighlightConfig()
        self.highlightEffect = WindowHighlightEffect(config: config)

        // Observe UserDefaults changes
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(self.userDefaultsDidChange),
            name: UserDefaults.didChangeNotification,
            object: nil)
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
                isEnabled: false)
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
               let nsColor = try? NSKeyedUnarchiver.unarchivedObject(ofClass: NSColor.self, from: colorData)
            {
                return WindowHighlightConfig(
                    color: nsColor,
                    duration: 0.8,
                    borderWidth: 4.0,
                    glowRadius: 12.0,
                    isEnabled: true)
            }
            return .default
        default:
            return .default
        }
    }

    /// Handle UserDefaults changes
    @objc
    private func userDefaultsDidChange(_ notification: Notification) {
        // Update highlight configuration when settings change
        let newConfig = Self.loadHighlightConfig()
        self.highlightEffect.updateConfig(newConfig)
    }

    /// Focus a window based on terminal type
    func focusWindow(_ windowInfo: WindowInfo) {
        switch windowInfo.terminalApp {
        case .terminal:
            // Terminal.app has special AppleScript support for tab selection
            self.focusTerminalAppWindow(windowInfo)
        case .iTerm2:
            // iTerm2 uses its own tab system, needs special handling
            self.focusiTerm2Window(windowInfo)
        default:
            // All other terminals that use macOS standard tabs
            self.focusWindowUsingAccessibility(windowInfo)
        }
    }

    /// Focuses a Terminal.app window/tab.
    private func focusTerminalAppWindow(_ windowInfo: WindowInfo) {
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
                self.logger.info("Focused Terminal.app tab using reference: \(tabRef)")
            } catch {
                self.logger.error("Failed to focus Terminal.app tab: \(error)")
                // Fallback to accessibility
                self.focusWindowUsingAccessibility(windowInfo)
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
                self.logger.error("Failed to focus Terminal.app window: \(error)")
                self.focusWindowUsingAccessibility(windowInfo)
            }
        }
    }

    /// Focuses an iTerm2 window.
    private func focusiTerm2Window(_ windowInfo: WindowInfo) {
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
            self.logger.info("iTerm2 focus result: \(result)")
        } catch {
            self.logger.error("Failed to focus iTerm2 window/tab: \(error)")
            // Fallback to accessibility
            self.focusWindowUsingAccessibility(windowInfo)
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

    /// Get tabs from a standard macOS tab group or directly from the window.
    private func getTabs(from window: AXElement) -> [AXElement]? {
        if let tabGroup = getTabGroup(from: window),
           let tabs = tabGroup.tabs,
           !tabs.isEmpty
        {
            return tabs
        }

        if let tabs = window.tabs, !tabs.isEmpty {
            return tabs
        }

        return nil
    }

    /// Select the correct tab in a window that uses macOS standard tabs
    private func selectTab(
        tabs: [AXElement],
        windowInfo: WindowInfo,
        sessionInfo: ServerSessionInfo?)
    {
        self.logger.debug("Attempting to select tab for session \(windowInfo.sessionID) from \(tabs.count) tabs")

        // Try to find the correct tab
        if let matchingTab = windowMatcher.findMatchingTab(tabs: tabs, sessionInfo: sessionInfo) {
            // Found matching tab - select it using kAXPressAction (most reliable)
            if matchingTab.press() {
                self.logger.info("Successfully selected matching tab for session \(windowInfo.sessionID)")
            } else {
                self.logger.warning("Failed to select tab with kAXPressAction")

                // Try alternative selection method - set as selected
                if matchingTab.isAttributeSettable(kAXSelectedAttribute) {
                    let setResult = matchingTab.setSelected(true)
                    if setResult == .success {
                        self.logger.info("Selected tab using AXSelected attribute")
                    } else {
                        self.logger.error("Failed to set AXSelected attribute, error: \(setResult.rawValue)")
                    }
                }
            }
        } else if tabs.count == 1 {
            // If only one tab, select it
            tabs[0].press()
            self.logger.info("Selected the only available tab")
        } else {
            // Multiple tabs but no match - try to find by index or select first
            self.logger
                .warning(
                    "Multiple tabs (\(tabs.count)) but could not identify correct one for session \(windowInfo.sessionID)")

            // Log tab titles for debugging
            for (index, tab) in tabs.enumerated() {
                if let title = tab.title {
                    self.logger.debug("  Tab \(index): \(title)")
                }
            }
        }
    }

    /// Focuses a window using Accessibility APIs.
    func focusWindowUsingAccessibility(
        _ windowInfo: WindowInfo,
        sessionInfo providedSessionInfo: ServerSessionInfo? = nil)
    {
        // First bring the application to front
        if let app = NSRunningApplication(processIdentifier: windowInfo.ownerPID) {
            app.activate()
            self.logger.info("Activated application with PID: \(windowInfo.ownerPID)")
        }

        // Use AXElement to focus the specific window
        let axApp = AXElement.application(pid: windowInfo.ownerPID)

        guard let windows = axApp.windows,
              !windows.isEmpty
        else {
            self.logger.error("Failed to get windows for application")
            return
        }

        self.logger
            .info(
                "Found \(windows.count) windows for \(windowInfo.terminalApp.rawValue), looking for window ID: \(windowInfo.windowID)")

        // Get session info for tab matching
        let sessionInfo = providedSessionInfo ?? SessionMonitor.shared.sessions[windowInfo.sessionID]

        // First, try to find window with matching tab content
        var bestTrackedWindow: (window: AXElement, score: WindowMatchEvidence)?
        var bestMatchWindow: (window: AXElement, score: WindowMatchEvidence)?
        var bestTabMatch: WindowTabMatch?

        for (index, window) in windows.enumerated() {
            var identityScore = 0
            var contentScore = 0

            // Try window ID attribute for matching
            if let axWindowID = window.windowID {
                if axWindowID == windowInfo.windowID {
                    identityScore += WindowMatchScore.windowID
                }
                self.logger
                    .debug(
                        "Window \(index) windowID: \(axWindowID), target: \(windowInfo.windowID), matches: \(axWindowID == windowInfo.windowID)")
            }

            // Check window position and size as secondary validation
            if let bounds = windowInfo.bounds,
               let windowFrame = window.frame()
            {
                // Check if bounds approximately match (within 5 pixels tolerance)
                let tolerance: CGFloat = 5.0
                if abs(windowFrame.origin.x - bounds.origin.x) < tolerance,
                   abs(windowFrame.origin.y - bounds.origin.y) < tolerance,
                   abs(windowFrame.width - bounds.width) < tolerance,
                   abs(windowFrame.height - bounds.height) < tolerance
                {
                    identityScore += WindowMatchScore.bounds
                    self.logger
                        .debug(
                            "Window \(index) bounds match! Position: (\(windowFrame.origin.x), \(windowFrame.origin.y)), Size: (\(windowFrame.width), \(windowFrame.height))")
                }
            }

            // Check window title for session information
            if let title = window.title {
                self.logger.debug("Window \(index) title: '\(title)'")

                if let sessionInfo,
                   let titleScore = self.windowMatcher.tabMatchScore(for: title, sessionInfo: sessionInfo)
                {
                    contentScore = max(contentScore, titleScore)
                    self.logger.debug("Window \(index) has session title evidence worth \(titleScore)")
                } else if !windowInfo.sessionID.isEmpty,
                          title.contains(windowInfo.sessionID) ||
                          title.contains("TTY_SESSION_ID=\(windowInfo.sessionID)")
                {
                    contentScore = max(contentScore, WindowMatchScore.sessionID)
                    self.logger.debug("Window \(index) has session ID in title")
                }

                // Original title match logic as fallback
                if !title
                    .isEmpty, windowInfo.title?.contains(title) ?? false || title.contains(windowInfo.title ?? "")
                {
                    contentScore = max(contentScore, WindowMatchScore.storedTitle)
                }
            }

            let trackedScore = WindowMatchScore.combined(identity: identityScore, content: 0)
            if identityScore > 0,
               bestTrackedWindow == nil || trackedScore > bestTrackedWindow?.score ?? trackedScore
            {
                bestTrackedWindow = (window, trackedScore)
            }

            let matchScore = WindowMatchScore.combined(identity: identityScore, content: contentScore)

            // Keep track of the best metadata match as a fallback.
            if matchScore.strongest > 0 {
                if bestMatchWindow == nil || matchScore > bestMatchWindow?.score ?? matchScore {
                    bestMatchWindow = (window, matchScore)
                    self.logger.debug("Window \(index) is new best match with score: \(matchScore)")
                }
            }

            if let tabs = getTabs(from: window),
               let tabMatch = self.windowMatcher.findBestMatchingTab(tabs: tabs, sessionInfo: sessionInfo)
            {
                let tabScore = WindowMatchScore.combined(identity: identityScore, content: tabMatch.score)
                if bestTabMatch == nil || tabScore > bestTabMatch?.score ?? tabScore {
                    bestTabMatch = WindowTabMatch(window: window, tabs: tabs, score: tabScore)
                    self.logger.debug("Window \(index) is new best tab match with score: \(tabScore)")
                }
            }
        }

        let noEvidence = WindowMatchScore.combined(identity: 0, content: 0)
        let trackedScore = bestTrackedWindow?.score ?? noEvidence
        let metadataScore = bestMatchWindow?.score ?? noEvidence

        if let bestTabMatch,
           bestTabMatch.score >= metadataScore,
           bestTabMatch.score > trackedScore
        {
            self.logger.info("Focusing matching tab in window with score \(bestTabMatch.score)")
            self.highlightEffect.highlightWindow(bestTabMatch.window, bounds: bestTabMatch.window.frame())
            bestTabMatch.window.setMain(true)
            bestTabMatch.window.setFocused(true)
            self.selectTab(tabs: bestTabMatch.tabs, windowInfo: windowInfo, sessionInfo: sessionInfo)
            return
        }

        if let bestMatch = bestMatchWindow, bestMatch.score > trackedScore {
            self.logger
                .info("Using best match window with score \(bestMatch.score) for window ID \(windowInfo.windowID)")
            self.highlightEffect.highlightWindow(bestMatch.window, bounds: bestMatch.window.frame())
            bestMatch.window.setMain(true)
            bestMatch.window.setFocused(true)

            if sessionInfo != nil, let tabs = getTabs(from: bestMatch.window) {
                self.selectTab(tabs: tabs, windowInfo: windowInfo, sessionInfo: sessionInfo)
            }

            self.logger.info("Focused best match window for session \(windowInfo.sessionID)")
            return
        }

        if let bestTrackedWindow {
            self.logger.info("Focusing tracked window with identity score \(bestTrackedWindow.score)")
            self.highlightEffect.highlightWindow(
                bestTrackedWindow.window,
                bounds: bestTrackedWindow.window.frame())
            bestTrackedWindow.window.setMain(true)
            bestTrackedWindow.window.setFocused(true)

            if sessionInfo != nil, let tabs = getTabs(from: bestTrackedWindow.window) {
                self.selectTab(tabs: tabs, windowInfo: windowInfo, sessionInfo: sessionInfo)
            }
            return
        }

        if windows.count == 1, let window = windows.first {
            self.logger.info("No metadata match; focusing the sole window for PID \(windowInfo.ownerPID)")
            self.highlightEffect.highlightWindow(window, bounds: window.frame())
            window.setMain(true)
            window.setFocused(true)
        } else {
            // No match found at all - log error but don't focus random window
            self.logger
                .error(
                    "Failed to find window with ID \(windowInfo.windowID) for session \(windowInfo.sessionID). No windows matched by ID, position, or title.")
        }
    }
}
