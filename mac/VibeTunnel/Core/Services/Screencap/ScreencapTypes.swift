import AppKit
import CoreGraphics
import Foundation
@preconcurrency import ScreenCaptureKit

// MARK: - Error Types

/// Errors that can occur during screen capture operations
public enum ScreencapError: LocalizedError {
    case invalidServerURL
    case webSocketNotConnected
    case windowNotFound(Int)
    case noDisplay
    case notCapturing
    case failedToStartCapture(Error)
    case failedToCreateEvent
    case invalidCoordinates(x: Double, y: Double)
    case invalidKeyInput(String)
    case failedToGetContent(Error)
    case permissionDenied
    case noScreenRecordingPermission
    case invalidWindowIndex
    case invalidApplicationIndex
    case invalidCaptureType
    case invalidConfiguration
    case serviceNotReady

    public var errorDescription: String? {
        switch self {
        case .invalidServerURL:
            "Invalid server URL for WebSocket connection"
        case .webSocketNotConnected:
            "WebSocket connection not established"
        case .windowNotFound(let id):
            "Window with ID \(id) not found"
        case .noDisplay:
            "No display available"
        case .notCapturing:
            "Screen capture is not active"
        case .failedToStartCapture(let error):
            "Failed to start capture: \(error.localizedDescription)"
        case .failedToCreateEvent:
            "Failed to create system event"
        case .invalidCoordinates(let x, let y):
            "Invalid coordinates: (\(x), \(y))"
        case .invalidKeyInput(let key):
            "Invalid key input: \(key)"
        case .failedToGetContent(let error):
            "Failed to get shareable content: \(error.localizedDescription)"
        case .permissionDenied:
            "Screen recording permission is required. Please grant permission in System Settings > Privacy & Security > Screen Recording > VibeTunnel"
        case .noScreenRecordingPermission:
            "Screen recording permission is required. Please grant permission in System Settings > Privacy & Security > Screen Recording > VibeTunnel"
        case .invalidWindowIndex:
            "Invalid window index"
        case .invalidApplicationIndex:
            "Invalid application index"
        case .invalidCaptureType:
            "Invalid capture type"
        case .invalidConfiguration:
            "Invalid capture configuration"
        case .serviceNotReady:
            "Screen capture service is not ready. Connection may still be initializing."
        }
    }
}

// MARK: - Capture Types

/// Defines the various modes for screen capture
public enum CaptureMode {
    /// Capture a specific display by index
    case desktop(displayIndex: Int = 0)
    /// Capture all displays as a single image
    case allDisplays
    /// Capture a specific window
    case window(SCWindow)
    /// Capture all windows of a specific application
    case application(SCRunningApplication)
}

// MARK: - Data Structures

/// Information about a display
public struct DisplayInfo: Codable {
    /// Unique identifier for the display
    public let id: String
    /// Width of the display in pixels
    public let width: Int
    /// Height of the display in pixels
    public let height: Int
    /// Scale factor (e.g., 2.0 for Retina displays)
    public let scaleFactor: Double
    /// Refresh rate in Hz
    public let refreshRate: Double
    /// X coordinate of the display in the global coordinate space
    public let x: Double
    /// Y coordinate of the display in the global coordinate space
    public let y: Double
    /// Human-readable name of the display (if available)
    public let name: String?
}

/// Information about a window
public struct WindowInfo: Codable {
    /// CoreGraphics window ID
    public let cgWindowID: Int
    /// Title of the window (if available)
    public let title: String?
    /// X coordinate of the window
    public let x: Double
    /// Y coordinate of the window
    public let y: Double
    /// Width of the window
    public let width: Double
    /// Height of the window
    public let height: Double
}

/// Groups windows by their owning process
public struct ProcessGroup: Codable {
    /// Name of the process
    public let processName: String
    /// Process identifier
    public let pid: Int32
    /// Bundle identifier (if available)
    public let bundleIdentifier: String?
    /// Base64 encoded PNG icon data
    public let iconData: String?
    /// Windows owned by this process
    public let windows: [WindowInfo]
}

// MARK: - Display Extensions

extension NSScreen {
    /// Gets the CGDirectDisplayID for this screen
    public var displayID: CGDirectDisplayID {
        // NSScreen.deviceDescription contains "NSScreenNumber" which is the CGDirectDisplayID
        let key = NSDeviceDescriptionKey("NSScreenNumber")
        return deviceDescription[key] as? CGDirectDisplayID ?? 0
    }

    /// Gets the corresponding SCDisplay for this NSScreen
    public func scDisplay(from displays: [SCDisplay]) -> SCDisplay? {
        displays.first { display in
            display.displayID == self.displayID
        }
    }
}

extension SCDisplay {
    /// Gets the corresponding NSScreen for this SCDisplay
    public var nsScreen: NSScreen? {
        // SCDisplay.displayID is a CGDirectDisplayID
        NSScreen.screens.first { screen in
            screen.displayID == self.displayID
        }
    }
}
