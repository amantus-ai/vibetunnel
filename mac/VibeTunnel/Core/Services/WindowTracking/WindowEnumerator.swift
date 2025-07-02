import AppKit
import Foundation
import OSLog

/// Handles window enumeration using Core Graphics APIs.
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

        // Window properties from Core Graphics
        let bounds: CGRect?
        let title: String?
    }

    /// Gets all terminal windows currently visible on screen.
    static func getAllTerminalWindows() -> [WindowInfo] {
        let options: CGWindowListOption = [.excludeDesktopElements, .optionOnScreenOnly]

        guard let windowList = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
            return []
        }

        var terminalWindows: [WindowInfo] = []
        let terminalAppNames = Terminal.allCases.map(\.applicationName)

        for window in windowList {
            // Check if this is a terminal window
            guard let ownerName = window[kCGWindowOwnerName as String] as? String,
                  terminalAppNames.contains(ownerName)
            else {
                continue
            }

            // Skip windows that aren't normal windows (e.g., menus, tooltips)
            if let windowLayer = window[kCGWindowLayer as String] as? Int, windowLayer != 0 {
                continue
            }

            // Get window properties
            let windowID = window[kCGWindowNumber as String] as? CGWindowID ?? 0
            let ownerPID = window[kCGWindowOwnerPID as String] as? pid_t ?? 0
            let title = window[kCGWindowName as String] as? String

            // Get window bounds
            var bounds: CGRect?
            if let boundsDict = window[kCGWindowBounds as String] as? [String: CGFloat] {
                bounds = CGRect(
                    x: boundsDict["X"] ?? 0,
                    y: boundsDict["Y"] ?? 0,
                    width: boundsDict["Width"] ?? 0,
                    height: boundsDict["Height"] ?? 0
                )
            }

            // Determine terminal app type
            let terminal = Terminal.allCases.first { $0.applicationName == ownerName } ?? .terminal

            let windowInfo = WindowInfo(
                windowID: windowID,
                ownerPID: ownerPID,
                terminalApp: terminal,
                sessionID: "", // Will be filled by caller
                createdAt: Date(),
                tabReference: nil,
                tabID: nil,
                bounds: bounds,
                title: title
            )

            terminalWindows.append(windowInfo)
        }

        return terminalWindows
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
