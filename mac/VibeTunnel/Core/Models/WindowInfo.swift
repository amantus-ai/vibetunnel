import CoreGraphics
import Foundation

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