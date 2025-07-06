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
///
/// # Screen Recording Permission Deferral
///
/// This manager implements a two-stage approach for screen recording permissions to
/// avoid prompting users immediately on app launch:
///
/// ## Stage 1: Non-Triggering Check
/// - `checkScreenRecordingPermission()` checks UserDefaults for previous successful use
/// - Never calls SCShareableContent APIs that would trigger the permission dialog
/// - Returns false for unknown permission state (safe default)
///
/// ## Stage 2: Explicit Permission Request
/// - `checkScreenRecordingPermissionWithPrompt()` triggers the actual permission check
/// - Only called when user explicitly requests screen capture features
/// - Updates UserDefaults on success for future non-triggering checks
///
/// This approach ensures users aren't prompted for screen recording permission until
/// they actually need the feature, improving the onboarding experience.
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

    /// Check screen recording permission without triggering the system prompt.
    ///
    /// This method implements Stage 1 of our permission deferral strategy:
    /// - Checks UserDefaults for evidence of previous successful screen capture use
    /// - NEVER calls SCShareableContent APIs that would trigger the permission dialog
    /// - Returns false for unknown state (user hasn't explicitly granted permission yet)
    ///
    /// This allows the welcome screen to show permission status without prompting users.
    private func checkScreenRecordingPermission() async -> Bool {
        // Important: We cannot use SCShareableContent.current here as it triggers
        // the permission prompt if not already granted. Instead, we check if
        // the permission was previously granted by attempting a non-triggering
        // operation or checking stored permission state.

        // For now, we'll assume permission is not granted unless we have evidence
        // it was previously granted. The actual permission check will happen when
        // the user tries to use screen capture features.

        // Check if ScreencapService has been successfully used before
        let hasUsedScreencap = UserDefaults.standard.bool(forKey: "hasSuccessfullyUsedScreencap")

        if hasUsedScreencap {
            // User has successfully used screen capture before, so permission was granted
            logger.debug("Screen recording permission assumed granted (previously used)")
            return true
        }

        // Permission status unknown - will be checked when actually needed
        logger.debug("Screen recording permission status unknown (deferred check)")
        return false
    }

    /// Check screen recording permission with prompt if needed.
    ///
    /// This method implements Stage 2 of our permission deferral strategy:
    /// - WILL trigger the system permission prompt if not already granted
    /// - Updates UserDefaults on success for future non-triggering checks
    /// - Should only be called when user explicitly requests screen capture features
    ///
    /// Call this when:
    /// - User clicks "Grant Screen Recording Permission" in welcome screen
    /// - User attempts to start screen sharing
    /// - User accesses features that require screen capture
    func checkScreenRecordingPermissionWithPrompt() async -> Bool {
        do {
            // This will trigger the permission prompt if needed
            _ = try await SCShareableContent.current

            // If we get here, permission is granted
            UserDefaults.standard.set(true, forKey: "hasSuccessfullyUsedScreencap")
            logger.info("Screen recording permission verified and granted")

            // Update our cached permission state
            permissions[.screenRecording] = true
            NotificationCenter.default.post(name: .permissionsUpdated, object: nil)

            return true
        } catch {
            logger.info("Screen recording permission denied or not granted: \(error)")
            return false
        }
    }

    // MARK: - Accessibility Permission

    private func checkAccessibilityPermission() -> Bool {
        // First check the API
        let apiResult = AXIsProcessTrusted()

        // Then do a direct test - try to get the focused element
        // This will fail if we don't actually have permission
        let systemElement = AXUIElementCreateSystemWide()
        var focusedElement: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(
            systemElement,
            kAXFocusedUIElementAttribute as CFString,
            &focusedElement
        )

        // If we can get the focused element, we truly have permission
        if result == .success {
            logger.debug("Accessibility permission verified through direct test")
            return true
        } else if apiResult {
            // API says yes but direct test failed - permission might be pending
            logger.debug("Accessibility API reports true but direct test failed")
            return false
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
