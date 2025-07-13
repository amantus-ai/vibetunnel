import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import Observation
import OSLog
@preconcurrency import ScreenCaptureKit

extension Notification.Name {
    static let permissionsUpdated = Notification.Name("sh.vibetunnel.permissionsUpdated")
}

/// Types of system permissions that VibeTunnel requires.
///
/// Represents the various macOS system permissions needed for full functionality,
/// including automation, screen recording, and accessibility access.
enum SystemPermission {
    case appleScript
    case screenRecording
    case accessibility

    var displayName: String {
        switch self {
        case .appleScript:
            "Automation"
        case .screenRecording:
            "Screen Recording"
        case .accessibility:
            "Accessibility"
        }
    }

    var explanation: String {
        switch self {
        case .appleScript:
            "Required to launch and control terminal applications"
        case .screenRecording:
            "Required for screen capture and tracking terminal windows"
        case .accessibility:
            "Required to send keystrokes to terminal windows"
        }
    }

    fileprivate var settingsURLString: String {
        switch self {
        case .appleScript:
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"
        case .screenRecording:
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
        case .accessibility:
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        }
    }
}

/// Unified manager for all system permissions required by VibeTunnel.
///
/// Monitors and manages macOS system permissions including Apple Script automation,
/// screen recording, and accessibility access. Provides a centralized interface for
/// checking permission status and guiding users through the granting process.
@MainActor
@Observable
final class SystemPermissionManager {
    static let shared = SystemPermissionManager()

    /// Permission states
    private(set) var permissions: [SystemPermission: Bool] = [
        .appleScript: false,
        .screenRecording: false,
        .accessibility: false
    ]

    private let logger = Logger(
        subsystem: "sh.vibetunnel.vibetunnel",
        category: "SystemPermissions"
    )

    /// Timer for monitoring permission changes
    private var monitorTimer: Timer?

    /// Count of views that have registered for monitoring
    private var monitorRegistrationCount = 0

    init() {
        // No automatic monitoring - UI components will register when visible
    }

    // MARK: - Public API

    /// Check if a specific permission is granted
    func hasPermission(_ permission: SystemPermission) -> Bool {
        permissions[permission] ?? false
    }

    /// Check if all permissions are granted
    var hasAllPermissions: Bool {
        permissions.values.allSatisfy(\.self)
    }

    /// Get list of missing permissions
    var missingPermissions: [SystemPermission] {
        permissions.compactMap { permission, granted in
            granted ? nil : permission
        }
    }

    /// Request a specific permission
    func requestPermission(_ permission: SystemPermission) {
        logger.info("Requesting \(permission.displayName) permission")

        switch permission {
        case .appleScript:
            requestAppleScriptPermission()
        case .screenRecording:
            openSystemSettings(for: permission)
        case .accessibility:
            requestAccessibilityPermission()
        }
    }

    /// Request all missing permissions
    func requestAllMissingPermissions() {
        for permission in missingPermissions {
            requestPermission(permission)
        }
    }

    /// Force a permission recheck (useful when user manually changes settings)
    func forcePermissionRecheck() {
        logger.info("Force permission recheck requested")

        // Clear any cached values
        permissions[.accessibility] = false
        permissions[.screenRecording] = false
        permissions[.appleScript] = false

        // Immediate check
        Task { @MainActor in
            await checkAllPermissions()

            // Double-check after a delay to catch any async updates
            try? await Task.sleep(for: .milliseconds(500))
            await checkAllPermissions()
        }
    }

    /// Show alert explaining why a permission is needed
    func showPermissionAlert(for permission: SystemPermission) {
        let alert = NSAlert()
        alert.messageText = "\(permission.displayName) Permission Required"
        alert.informativeText = """
        VibeTunnel needs \(permission.displayName) permission.

        \(permission.explanation)

        Please grant permission in System Settings > Privacy & Security > \(permission.displayName).
        """
        alert.alertStyle = .informational
        alert.addButton(withTitle: "Open System Settings")
        alert.addButton(withTitle: "Cancel")

        if alert.runModal() == .alertFirstButtonReturn {
            requestPermission(permission)
        }
    }

    // MARK: - Permission Monitoring

    /// Register for permission monitoring (call when a view appears)
    func registerForMonitoring() {
        monitorRegistrationCount += 1
        logger.debug("Registered for monitoring, count: \(self.monitorRegistrationCount)")

        if monitorRegistrationCount == 1 {
            // First registration, start monitoring
            startMonitoring()
        }
    }

    /// Unregister from permission monitoring (call when a view disappears)
    func unregisterFromMonitoring() {
        monitorRegistrationCount = max(0, monitorRegistrationCount - 1)
        logger.debug("Unregistered from monitoring, count: \(self.monitorRegistrationCount)")

        if monitorRegistrationCount == 0 {
            // No more registrations, stop monitoring
            stopMonitoring()
        }
    }

    private func startMonitoring() {
        logger.info("Starting permission monitoring")

        // Initial check
        Task {
            await checkAllPermissions()
        }

        // Start timer for periodic checks
        monitorTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in
                await self.checkAllPermissions()
            }
        }
    }

    private func stopMonitoring() {
        logger.info("Stopping permission monitoring")
        monitorTimer?.invalidate()
        monitorTimer = nil
    }

    // MARK: - Permission Checking

    func checkAllPermissions() async {
        let oldPermissions = permissions

        // Check each permission type
        permissions[.appleScript] = await checkAppleScriptPermission()
        permissions[.screenRecording] = await checkScreenRecordingPermission()
        permissions[.accessibility] = checkAccessibilityPermission()

        // Post notification if any permissions changed
        if oldPermissions != permissions {
            NotificationCenter.default.post(name: .permissionsUpdated, object: nil)
        }
    }

    // MARK: - AppleScript Permission

    private func checkAppleScriptPermission() async -> Bool {
        // Try a simple AppleScript that doesn't require automation permission
        let testScript = "return \"test\""

        do {
            _ = try await AppleScriptExecutor.shared.executeAsync(testScript, timeout: 1.0)
            return true
        } catch {
            logger.debug("AppleScript check failed: \(error)")
            return false
        }
    }

    private func requestAppleScriptPermission() {
        Task {
            // Trigger permission dialog by targeting Terminal
            let triggerScript = """
                tell application "Terminal"
                    exists
                end tell
            """

            do {
                _ = try await AppleScriptExecutor.shared.executeAsync(triggerScript, timeout: 15.0)
            } catch {
                logger.info("AppleScript permission dialog triggered")
            }

            // Open System Settings after a delay
            try? await Task.sleep(for: .milliseconds(500))
            openSystemSettings(for: .appleScript)
        }
    }

    // MARK: - Screen Recording Permission

    private func checkScreenRecordingPermission() async -> Bool {
        do {
            // This will trigger the permission prompt if needed
            _ = try await SCShareableContent.current
            return true
        } catch {
            logger.debug("Screen recording permission not granted: \(error)")
            return false
        }
    }

    // MARK: - Accessibility Permission

    private func checkAccessibilityPermission() -> Bool {
        // First check the API
        let apiResult = AXIsProcessTrusted()
        logger.debug("AXIsProcessTrusted returned: \(apiResult)")

        // More comprehensive test - try to get focused application and its windows
        // This definitely requires accessibility permission
        let systemElement = AXUIElementCreateSystemWide()
        var focusedApp: CFTypeRef?
        let appResult = AXUIElementCopyAttributeValue(
            systemElement,
            kAXFocusedApplicationAttribute as CFString,
            &focusedApp
        )

        if appResult == .success, let app = focusedApp {
            // Try to get windows from the app - this definitely needs accessibility
            var windows: CFTypeRef?
            let windowResult = AXUIElementCopyAttributeValue(
                app as! AXUIElement, // swiftlint:disable:this force_cast
                kAXWindowsAttribute as CFString,
                &windows
            )

            let hasAccess = windowResult == .success
            logger.debug("Comprehensive accessibility test result: \(hasAccess), can get windows: \(windows != nil)")

            if hasAccess {
                logger.debug("Accessibility permission verified through comprehensive test")
                return true
            } else if apiResult {
                // API says yes but comprehensive test failed - permission not actually working
                logger.debug("Accessibility API reports true but comprehensive test failed")
                return false
            }
        } else {
            // Can't even get focused app
            logger.debug("Cannot get focused application - accessibility permission not granted")
            if apiResult {
                logger.debug("API reports true but cannot access UI elements")
            }
        }

        return false
    }

    private func requestAccessibilityPermission() {
        // Trigger the system dialog
        let options: NSDictionary = ["AXTrustedCheckOptionPrompt": true]
        let alreadyTrusted = AXIsProcessTrustedWithOptions(options)

        if alreadyTrusted {
            logger.info("Accessibility permission already granted")
        } else {
            logger.info("Accessibility permission dialog triggered")

            // Also open System Settings as a fallback
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
                self?.openSystemSettings(for: .accessibility)
            }
        }
    }

    // MARK: - Utilities

    private func openSystemSettings(for permission: SystemPermission) {
        if let url = URL(string: permission.settingsURLString) {
            NSWorkspace.shared.open(url)
        }
    }
}
