import AppKit
import SwiftUI

/// Handles the presentation of the welcome screen window.
///
/// Manages the lifecycle and presentation of the onboarding welcome window,
/// including window configuration, positioning, and notification-based showing.
/// Configured as a floating panel with transparent titlebar for modern appearance.
@MainActor
final class WelcomeWindowController: NSWindowController, NSWindowDelegate {
    static let shared = WelcomeWindowController()

    private var windowObserver: NSObjectProtocol?

    private init() {
        let welcomeView = WelcomeView()
            .environment(SessionMonitor.shared)
            .environment(ServerManager.shared)
            .environment(NgrokService.shared)
            .environment(SystemPermissionManager.shared)
            .environment(TerminalLauncher.shared)
        let hostingController = NSHostingController(rootView: welcomeView)

        let window = NSWindow(contentViewController: hostingController)
        window.title = UIStrings.welcomeTitle
        window.styleMask = [.titled, .closable, .fullSizeContentView]
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isMovableByWindowBackground = true
        window.setFrameAutosaveName("WelcomeWindow")
        window.isReleasedWhenClosed = false
        // Use normal window level instead of floating
        window.level = .normal

        // Set content view mode to ensure proper cleanup
        hostingController.sizingOptions = [.preferredContentSize]

        super.init(window: window)

        // Set self as window delegate
        window.delegate = self

        // Listen for notification to show welcome screen
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleShowWelcomeNotification),
            name: .showWelcomeScreen,
            object: nil
        )
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func show() {
        guard let window else { return }

        // Ensure dock icon is visible for window activation
        DockIconManager.shared.temporarilyShowDock()

        // Center window on the active screen (screen with mouse cursor)
        WindowCenteringHelper.centerOnActiveScreen(window)

        // Ensure window is visible and in front
        window.makeKeyAndOrderFront(nil)
        window.orderFrontRegardless()

        // Force activation to bring window to front
        NSApp.activate(ignoringOtherApps: true)

        // Temporarily raise window level to ensure it's on top
        window.level = .floating

        // Reset level after a short delay
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(100))
            window.level = .normal
        }
    }

    @objc
    private func handleShowWelcomeNotification() {
        show()
    }

    // MARK: - NSWindowDelegate

    func windowWillClose(_ notification: Notification) {
        // Ensure any async tasks are cancelled
        Task { @MainActor in
            // Give SwiftUI time to clean up
            try? await Task.sleep(for: .milliseconds(100))
        }
    }
}

// MARK: - Notification Extension

// Notification names are now in NotificationNames.swift
