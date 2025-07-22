import AppKit
import Foundation
import OSLog

/// Handles window enumeration using Accessibility APIs.
@MainActor
final class WindowEnumerator {
    private let logger = Logger(
        subsystem: "sh.vibetunnel.vibetunnel",
        category: "WindowEnumerator"
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

        // Window properties from Accessibility APIs
        let bounds: CGRect?
        let title: String?
    }

    /// Gets all terminal windows currently visible on screen using Accessibility APIs.
    static func getAllTerminalWindows() -> [WindowInfo] {
        // Get bundle identifiers for all terminal types
        let terminalBundleIDs = Terminal.allCases.compactMap(\.bundleIdentifier)
        
        // Use AXElement to enumerate windows
        let axWindows = AXElement.enumerateWindows(
            bundleIdentifiers: terminalBundleIDs,
            includeMinimized: false
        )
        
        // Convert AXElement.WindowInfo to our WindowInfo
        return axWindows.compactMap { axWindow in
            // Find the matching Terminal enum
            guard let terminal = Terminal.allCases.first(where: { 
                $0.bundleIdentifier == axWindow.bundleIdentifier 
            }) else {
                return nil
            }
            
            return WindowInfo(
                windowID: axWindow.windowID,
                ownerPID: axWindow.pid,
                terminalApp: terminal,
                sessionID: "", // Will be filled by caller
                createdAt: Date(),
                tabReference: nil,
                tabID: nil,
                bounds: axWindow.bounds,
                title: axWindow.title
            )
        }
    }

    /// Extract window ID from Terminal.app tab reference
    static func extractWindowID(from tabReference: String) -> CGWindowID? {
        // Extract window ID from tab reference (format: "tab id X of window id Y")
        if let windowIDMatch = tabReference.firstMatch(of: /window id (\d+)/),
           let windowID = CGWindowID(windowIDMatch.output.1)
        {
            return windowID
        }
        return nil
    }

    /// Check if a window title contains a specific identifier
    static func windowTitleContains(_ window: WindowInfo, identifier: String) -> Bool {
        if let title = window.title {
            return title.contains(identifier)
        }
        return false
    }
}
