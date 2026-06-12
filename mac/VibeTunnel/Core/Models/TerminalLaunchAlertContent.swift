import Foundation

/// User-facing alert content for terminal launch failures.
struct TerminalLaunchAlertContent {
    let title: String
    let message: String
    let recoveryPermission: SystemPermission?

    private init(
        title: String,
        message: String,
        recoveryPermission: SystemPermission?)
    {
        self.title = title
        self.message = message
        self.recoveryPermission = recoveryPermission
    }

    init(error: Error, terminalName: String) {
        guard let terminalError = error as? TerminalLauncherError else {
            self.title = "Terminal Launch Failed"
            self.message = error.localizedDescription
            self.recoveryPermission = nil
            return
        }

        switch terminalError {
        case .appleScriptPermissionDenied:
            self = Self.automationPermissionDenied
        case .accessibilityPermissionDenied:
            self = Self.accessibilityPermissionDenied(terminalName: terminalName)
        case .terminalNotFound:
            self.title = "Terminal Not Found"
            self.message = "The selected terminal application could not be found. Please select a different terminal."
            self.recoveryPermission = nil
        case let .appleScriptExecutionFailed(details, errorCode):
            self = Self.appleScriptExecutionFailure(
                details: details,
                errorCode: errorCode,
                terminalName: terminalName)
        case let .processLaunchFailed(details):
            self.title = "Process Launch Failed"
            self.message = "Failed to start terminal process: \(details)"
            self.recoveryPermission = nil
        }
    }

    private static var automationPermissionDenied: Self {
        Self(
            title: "Permission Denied",
            message: """
            VibeTunnel needs permission to control terminal applications.

            Please grant Automation permission in System Settings > Privacy & Security > Automation.
            """,
            recoveryPermission: .appleScript)
    }

    private static func accessibilityPermissionDenied(terminalName: String) -> Self {
        Self(
            title: "Accessibility Permission Required",
            message: """
            VibeTunnel needs Accessibility permission to send keystrokes to \(terminalName).

            Please grant permission in System Settings > Privacy & Security > Accessibility.
            """,
            recoveryPermission: .accessibility)
    }

    private static func appleScriptExecutionFailure(
        details: String,
        errorCode: Int?,
        terminalName: String)
        -> Self
    {
        switch errorCode {
        case -1743:
            self.automationPermissionDenied
        case 1002, -25211, -1719:
            self.accessibilityPermissionDenied(terminalName: terminalName)
        case -1728:
            Self(
                title: "Terminal Not Available",
                message: "The terminal application is not running or cannot be controlled.\n\nDetails: \(details)",
                recoveryPermission: nil)
        case -1708:
            Self(
                title: "Terminal Communication Error",
                message: "The terminal did not respond to the command.\n\nDetails: \(details)",
                recoveryPermission: nil)
        case let code?:
            Self(
                title: "Terminal Launch Failed",
                message: "AppleScript error \(code): \(details)",
                recoveryPermission: nil)
        case nil:
            Self(
                title: "Terminal Launch Failed",
                message: "Failed to launch terminal: \(details)",
                recoveryPermission: nil)
        }
    }
}
