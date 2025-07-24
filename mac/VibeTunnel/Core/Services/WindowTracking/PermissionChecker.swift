import AppKit
import Foundation
import OSLog

/// Handles accessibility permission checks and requests.
@MainActor
final class PermissionChecker {
    private let logger = Logger(
        subsystem: BundleIdentifiers.loggerSubsystem,
        category: "PermissionChecker"
    )

    /// Check if we have the required permissions.
    func checkPermissions() -> Bool {
        if !checkPermissionsDirectly() {
            logger.warning("VibeTunnel needs accessibility permissions to focus terminal windows")

            let alert = NSAlert()
            alert.messageText = "Accessibility Permissions Required"
            alert.informativeText = """
            VibeTunnel needs accessibility permissions to focus terminal windows when you click on sessions.

            Please grant permission in System Settings > Privacy & Security > Accessibility.
            """
            alert.alertStyle = .informational
            alert.addButton(withTitle: "Open System Settings")
            alert.addButton(withTitle: "Later")

            if alert.runModal() == .alertFirstButtonReturn {
                requestPermissions()
            }

            return false
        }
        return true
    }

    /// Request accessibility permissions.
    func requestPermissions() {
        // Open System Settings directly to the right pane
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
    }

    /// Check permissions without prompting.
    private func checkPermissionsDirectly() -> Bool {
        AXIsProcessTrusted()
    }
}
