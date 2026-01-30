import CoreGraphics
import Foundation

/// Information about a tracked terminal window.
///
/// This struct encapsulates all the information needed to track and manage
/// terminal windows across different terminal applications (Terminal.app, iTerm2, etc.).
/// It combines window system information with application-specific identifiers.
struct WindowInfo {
    /// The Core Graphics window identifier.
    ///
    /// This is the unique identifier assigned by the window server to this window.
    let windowID: CGWindowID

    /// The process ID of the terminal application that owns this window.
    let ownerPID: pid_t

    /// The terminal application type that created this window.
    let terminalApp: Terminal

    /// The VibeTunnel session ID associated with this window.
    ///
    /// This links the terminal window to a specific VibeTunnel session.
    let sessionID: String

    /// The timestamp when this window was first tracked.
    let createdAt: Date

    // MARK: - Tab-specific information

    /// AppleScript reference for Terminal.app tabs.
    ///
    /// This is used to identify specific tabs within Terminal.app windows
    /// using AppleScript commands. Only populated for Terminal.app.
    let tabReference: String?

    /// Tab identifier for iTerm2.
    ///
    /// This is the unique identifier iTerm2 assigns to each tab.
    /// Only populated for iTerm2 windows.
    let tabID: String?

    // MARK: - Window properties from Accessibility APIs

    /// The window's position and size on screen.
    ///
    /// Retrieved using Accessibility APIs. May be `nil` if accessibility
    /// permissions are not granted or the window information is unavailable.
    let bounds: CGRect?

    /// The window's title as reported by Accessibility APIs.
    ///
    /// May be `nil` if accessibility permissions are not granted
    /// or the title cannot be determined.
    let title: String?
}
