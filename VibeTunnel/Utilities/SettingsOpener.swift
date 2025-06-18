@preconcurrency import AppKit
import Foundation
import SwiftUI

/// Helper to open the Settings window programmatically.
///
/// This utility manages dock icon visibility to ensure the Settings window
/// can be properly brought to front in menu bar apps. It temporarily shows
/// the dock icon when settings opens and restores the user's preference
/// when the window closes.
@MainActor
enum SettingsOpener {
    /// SwiftUI's hardcoded settings window identifier
    private static let settingsWindowIdentifier = "com_apple_SwiftUI_Settings_window"
    private static var windowObserver: NSObjectProtocol?

    /// Opens the Settings window using the environment action via notification
    /// This is needed for cases where we can't use SettingsLink (e.g., from notifications)
    static func openSettings() {
        // Store the current dock visibility preference
        let showInDock = UserDefaults.standard.bool(forKey: "showInDock")

        // Temporarily show dock icon to ensure settings window can be brought to front
        if !showInDock {
            NSApp.setActivationPolicy(.regular)
        }

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

            // Set up observer to apply dock visibility preference when settings window closes
            setupDockVisibilityRestoration()
        }
    }

    // MARK: - Dock Visibility Restoration

    private static func setupDockVisibilityRestoration() {
        // Remove any existing observer
        if let observer = windowObserver {
            NotificationCenter.default.removeObserver(observer)
            windowObserver = nil
        }

        // Set up observer for window closing
        windowObserver = NotificationCenter.default.addObserver(
            forName: NSWindow.willCloseNotification,
            object: nil,
            queue: .main
        ) { [weak windowObserver] notification in
            guard let window = notification.object as? NSWindow else { return }

            Task { @MainActor in
                guard window.title.contains("Settings") || window.identifier?.rawValue
                    .contains(settingsWindowIdentifier) == true
                else {
                    return
                }

                // Window is closing, apply the current dock visibility preference
                let showInDock = UserDefaults.standard.bool(forKey: "showInDock")
                NSApp.setActivationPolicy(showInDock ? .regular : .accessory)

                // Clean up observer
                if let observer = windowObserver {
                    NotificationCenter.default.removeObserver(observer)
                    Self.windowObserver = nil
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
                (window.title.localizedCaseInsensitiveContains("settings") ||
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
/// This is a workaround for FB10184971.
struct HiddenWindowView: View {
    @Environment(\.openSettings)
    private var openSettings

    var body: some View {
        Color.clear
            .frame(width: 1, height: 1)
            .onReceive(NotificationCenter.default.publisher(for: .openSettingsRequest)) { _ in
                openSettings()
            }
    }
}

// MARK: - Notification Extensions

extension Notification.Name {
    static let openSettingsRequest = Notification.Name("openSettingsRequest")
}
