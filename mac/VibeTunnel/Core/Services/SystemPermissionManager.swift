import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import Observation
import OSLog

extension Notification.Name {
    static let permissionsUpdated = Notification.Name("sh.vibetunnel.permissionsUpdated")
}

/// Types of system permissions that VibeTunnel requires.
///
/// Represents the various macOS system permissions needed for full functionality,
/// including automation and accessibility access.
enum SystemPermission {
    case appleScript
    case accessibility

    var displayName: String {
        switch self {
        case .appleScript:
            "Automation"
        case .accessibility:
            "Accessibility"
        }
    }

    var explanation: String {
        switch self {
        case .appleScript:
            "Required to launch and control terminal applications"
        case .accessibility:
            "Required to track and interact with terminal windows"
        }
    }

    fileprivate var settingsURLString: String {
        switch self {
        case .appleScript:
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"
        case .accessibility:
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        }
    }
}

/// Unified manager for all system permissions required by VibeTunnel.
///
/// Monitors and manages macOS system permissions including Apple Script automation
/// and accessibility access. Provides a centralized interface for
/// checking permission status and guiding users through the granting process.
@MainActor
@Observable
final class SystemPermissionManager {
    static let shared = SystemPermissionManager()

    /// Permission states
    private(set) var permissions: [SystemPermission: Bool] = [
        .appleScript: false,
        .accessibility: false,
    ]

    private let logger = Logger(
        subsystem: BundleIdentifiers.loggerSubsystem,
        category: "SystemPermissions")

    /// Timer for monitoring permission changes
    private var monitorTimer: Timer?

    /// Count of views that have registered for monitoring
    private var monitorRegistrationCount = 0

    /// Last time permissions were checked to avoid excessive checking
    private var lastPermissionCheck: Date?

    /// Minimum interval between permission checks (in seconds)
    private let minimumCheckInterval: TimeInterval = 0.5

    init() {
        // No automatic monitoring - UI components will register when visible
    }

    // MARK: - Public API

    /// Check if a specific permission is granted
    func hasPermission(_ permission: SystemPermission) -> Bool {
        self.permissions[permission] ?? false
    }

    /// Check if all permissions are granted
    var hasAllPermissions: Bool {
        self.permissions.values.allSatisfy(\.self)
    }

    /// Get list of missing permissions
    var missingPermissions: [SystemPermission] {
        self.permissions.compactMap { permission, granted in
            granted ? nil : permission
        }
    }

    /// Request a specific permission
    func requestPermission(_ permission: SystemPermission) {
        self.logger.info("Requesting \(permission.displayName) permission")

        switch permission {
        case .appleScript:
            self.requestAppleScriptPermission()
        case .accessibility:
            self.requestAccessibilityPermission()
        }
    }

    /// Request all missing permissions
    func requestAllMissingPermissions() {
        for permission in self.missingPermissions {
            self.requestPermission(permission)
        }
    }

    /// Force a permission recheck (useful when user manually changes settings)
    func forcePermissionRecheck() {
        self.logger.info("Force permission recheck requested")

        // Clear any cached values
        self.permissions[.accessibility] = false
        self.permissions[.appleScript] = false

        // Immediate check
        Task { @MainActor in
            await self.checkAllPermissions()

            // Double-check after a delay to catch any async updates
            try? await Task.sleep(for: .milliseconds(500))
            await self.checkAllPermissions()
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
            self.requestPermission(permission)
        }
    }

    // MARK: - Permission Monitoring

    /// Register for permission monitoring (call when a view appears)
    func registerForMonitoring() {
        self.monitorRegistrationCount += 1
        self.logger.debug("Registered for monitoring, count: \(self.monitorRegistrationCount)")

        if self.monitorRegistrationCount == 1 {
            // First registration, start monitoring
            self.startMonitoring()
        }
    }

    /// Unregister from permission monitoring (call when a view disappears)
    func unregisterFromMonitoring() {
        self.monitorRegistrationCount = max(0, self.monitorRegistrationCount - 1)
        self.logger.debug("Unregistered from monitoring, count: \(self.monitorRegistrationCount)")

        if self.monitorRegistrationCount == 0 {
            // No more registrations, stop monitoring
            self.stopMonitoring()
        }
    }

    private func startMonitoring() {
        self.logger.info("Starting permission monitoring (registration count: \(self.monitorRegistrationCount))")

        // Initial check
        Task {
            await self.checkAllPermissions()
        }

        // Start timer for periodic checks
        self.monitorTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in
                await self.checkAllPermissions()
            }
        }

        self.logger.debug("Permission monitoring timer created: \(String(describing: self.monitorTimer))")
    }

    private func stopMonitoring() {
        self.logger.info("Stopping permission monitoring (registration count: \(self.monitorRegistrationCount))")
        self.monitorTimer?.invalidate()
        self.monitorTimer = nil
        // Clear the last check time to ensure immediate check on next start
        self.lastPermissionCheck = nil
    }

    // MARK: - Permission Checking

    func checkAllPermissions() async {
        // Avoid checking too frequently
        if let lastCheck = lastPermissionCheck,
           Date().timeIntervalSince(lastCheck) < minimumCheckInterval
        {
            return
        }

        self.lastPermissionCheck = Date()
        let oldPermissions = self.permissions

        // Check each permission type
        self.permissions[.appleScript] = await self.checkAppleScriptPermission()
        self.permissions[.accessibility] = self.checkAccessibilityPermission()

        // Post notification if any permissions changed
        if oldPermissions != self.permissions {
            NotificationCenter.default.post(name: .permissionsUpdated, object: nil)
        }
    }

    // MARK: - AppleScript Permission

    private func checkAppleScriptPermission() async -> Bool {
        // Try a simple AppleScript that doesn't require automation permission
        let testScript = "return \"test\""

        do {
            // Use a short timeout since this script is very simple
            // This script is very simple and should complete quickly if permissions are granted
            _ = try await AppleScriptExecutor.shared.executeAsync(testScript, timeout: 1.0)
            return true
        } catch let error as AppleScriptError {
            // Only log actual errors, not timeouts which are expected when permissions are denied
            if case .timeout = error {
                logger.debug("AppleScript permission check timed out - likely no permission")
            } else {
                logger.debug("AppleScript check failed: \(error)")
            }
            return false
        } catch {
            self.logger.debug("AppleScript check failed with unexpected error: \(error)")
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
                self.logger.info("AppleScript permission dialog triggered")
            }

            // Open System Settings after a delay
            try? await Task.sleep(for: .milliseconds(500))
            self.openSystemSettings(for: .appleScript)
        }
    }

    // MARK: - Accessibility Permission

    private func checkAccessibilityPermission() -> Bool {
        // First check the API
        let apiResult = AXIsProcessTrusted()
        self.logger.debug("AXIsProcessTrusted returned: \(apiResult)")

        // More comprehensive test - try to get focused application and its windows
        // This definitely requires accessibility permission
        let systemElement = AXUIElementCreateSystemWide()
        var focusedApp: CFTypeRef?
        let appResult = AXUIElementCopyAttributeValue(
            systemElement,
            kAXFocusedApplicationAttribute as CFString,
            &focusedApp)

        if appResult == .success, let app = focusedApp {
            // Try to get windows from the app - this definitely needs accessibility
            var windows: CFTypeRef?
            // Use unsafeBitCast for CFTypeRef to AXUIElement conversion
            // This is safe because AXUIElementCopyAttributeValue guarantees the result is an AXUIElement
            let axElement = unsafeDowncast(app, to: AXUIElement.self)
            let windowResult = AXUIElementCopyAttributeValue(
                axElement,
                kAXWindowsAttribute as CFString,
                &windows)

            let hasAccess = windowResult == .success
            self.logger
                .debug("Comprehensive accessibility test result: \(hasAccess), can get windows: \(windows != nil)")

            if hasAccess {
                self.logger.debug("Accessibility permission verified through comprehensive test")
                return true
            } else if apiResult {
                // API says yes but comprehensive test failed - permission not actually working
                self.logger.debug("Accessibility API reports true but comprehensive test failed")
                return false
            }
        } else {
            // Can't even get focused app
            self.logger.debug("Cannot get focused application - accessibility permission not granted")
            if apiResult {
                self.logger.debug("API reports true but cannot access UI elements")
            }
        }

        return false
    }

    private func requestAccessibilityPermission() {
        // Trigger the system dialog
        let options: NSDictionary = ["AXTrustedCheckOptionPrompt": true]
        let alreadyTrusted = AXIsProcessTrustedWithOptions(options)

        if alreadyTrusted {
            self.logger.info("Accessibility permission already granted")
        } else {
            self.logger.info("Accessibility permission dialog triggered")

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
