@preconcurrency import AppKit
import Foundation
import SwiftUI

/// Helper to open the Settings window programmatically.
///
/// This utility works with DockIconManager to ensure the Settings window
/// can be properly brought to front. The dock icon visibility is managed
/// centrally by DockIconManager.
@MainActor
enum SettingsOpener {
    /// SwiftUI's hardcoded settings window identifier
    private static let settingsWindowIdentifier = "com_apple_SwiftUI_Settings_window"

    /// Opens the Settings window using the environment action via notification
    /// This is needed for cases where we can't use SettingsLink (e.g., from notifications)
    static func openSettings() {
        // Ensure dock icon is visible for window activation
        DockIconManager.shared.temporarilyShowDock()

        // Simple activation and window opening
        Task { @MainActor in
            // Small delay to ensure dock icon is visible
            try? await Task.sleep(for: .milliseconds(50))

            // Activate the app
            NSApp.activate(ignoringOtherApps: true)

            // Always use notification approach since we have dock icon visible
            NotificationCenter.default.post(name: .openSettingsRequest, object: nil)

            // we center twice to reduce jump but also be more resilient against slow systems
            if let settingsWindow = findSettingsWindow() {
                WindowCenteringHelper.centerOnActiveScreen(settingsWindow)
            }

            // Wait for window to appear
            try? await Task.sleep(for: .milliseconds(100))

            // Find and bring settings window to front
            if let settingsWindow = findSettingsWindow() {
                // Center the window
                WindowCenteringHelper.centerOnActiveScreen(settingsWindow)

                // Ensure window is visible and in front
                settingsWindow.makeKeyAndOrderFront(nil)
                settingsWindow.orderFrontRegardless()

                // Temporarily raise window level to ensure it's on top
                settingsWindow.level = .floating

                // Reset level after a short delay
                Task { @MainActor in
                    try? await Task.sleep(for: .milliseconds(100))
                    settingsWindow.level = .normal
                }
            }
        }
    }

    /// Finds the settings window using multiple detection methods
    static func findSettingsWindow() -> NSWindow? {
        // Try multiple methods to find the window
        NSApp.windows.first { window in
            // Check by identifier
            if window.identifier?.rawValue == settingsWindowIdentifier {
                return true
            }

            // Check by title
            if window.isVisible && window.styleMask.contains(.titled) &&
                (
                    window.title.localizedCaseInsensitiveContains("settings") ||
                        window.title.localizedCaseInsensitiveContains("preferences")
                )
            {
                return true
            }

            // Check by content view controller type
            if let contentVC = window.contentViewController,
               String(describing: type(of: contentVC)).contains("Settings")
            {
                return true
            }

            return false
        }
    }

    /// Opens the Settings window and navigates to a specific tab
    static func openSettingsTab(_ tab: SettingsTab) {
        openSettings()

        Task {
            // Then switch to the specific tab
            NotificationCenter.default.post(
                name: .openSettingsTab,
                object: tab
            )
        }
    }
}

// MARK: - Hidden Window View

/// A minimal hidden window that enables Settings to work in MenuBarExtra apps.
///
/// This is a workaround for FB10184971. The window remains invisible and serves
/// only to enable the Settings command in apps that use MenuBarExtra as their
/// primary interface without a main window.
struct HiddenWindowView: View {
    @Environment(\.openSettings)
    private var openSettings

    var body: some View {
        Color.clear
            .frame(width: 1, height: 1)
            .onReceive(NotificationCenter.default.publisher(for: .openSettingsRequest)) { _ in
                // Another hack, if we don't wait a runloop we crash in some toolbar logic on macOS Tahoe b1.
                Task { @MainActor in
                    openSettings()
                }
            }
            .onAppear {
                // Hide this window from the dock menu and window lists
                if let window = NSApp.windows.first(where: { $0.title == "HiddenWindow" }) {
                    window.collectionBehavior = [.auxiliary, .ignoresCycle, .transient]
                    window.isExcludedFromWindowsMenu = true
                    window.level = .floating
                    window.isOpaque = false
                    window.backgroundColor = .clear
                    window.hasShadow = false
                    window.ignoresMouseEvents = true
                    window.canHide = false
                }
            }
    }
}

// MARK: - Notification Extensions

extension Notification.Name {
    static let openSettingsRequest = Notification.Name("openSettingsRequest")
}
