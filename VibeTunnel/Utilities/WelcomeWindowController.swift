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
        let hostingController = NSHostingController(rootView: welcomeView)

        let window = NSWindow(contentViewController: hostingController)
        window.title = ""
        window.styleMask = [.titled, .closable, .fullSizeContentView]
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isMovableByWindowBackground = true
        window.setFrameAutosaveName("WelcomeWindow")
        window.isReleasedWhenClosed = false
        // Use normal window level instead of floating
        window.level = .normal

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

        // Check if dock icon is currently hidden
        let showInDock = UserDefaults.standard.bool(forKey: "showInDock")

        // Temporarily show dock icon if it's hidden
        // This is necessary for proper window activation
        if !showInDock {
            NSApp.setActivationPolicy(.regular)
        }

        // Center window on the active screen (screen with mouse cursor)
        WindowCenteringHelper.centerOnActiveScreen(window)

        window.makeKeyAndOrderFront(nil)
        // Force activation to bring window to front
        NSApp.activate(ignoringOtherApps: true)

        // Set up observer to restore dock visibility when window closes
        setupWindowCloseObserver()
    }

    @objc
    private func handleShowWelcomeNotification() {
        show()
    }

    private func setupWindowCloseObserver() {
        // Remove any existing observer
        if let observer = windowObserver {
            NotificationCenter.default.removeObserver(observer)
        }

        // Observe window close notifications
        windowObserver = NotificationCenter.default.addObserver(
            forName: NSWindow.willCloseNotification,
            object: window,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.restoreDockVisibility()
            }
        }
    }

    private func restoreDockVisibility() {
        // Check the current dock visibility preference
        // User might have changed it while window was open
        let showInDock = UserDefaults.standard.bool(forKey: "showInDock")

        // Apply the current preference
        if !showInDock {
            NSApp.setActivationPolicy(.accessory)
        } else {
            NSApp.setActivationPolicy(.regular)
        }

        // Clean up observer
        if let observer = windowObserver {
            NotificationCenter.default.removeObserver(observer)
            windowObserver = nil
        }
    }

    deinit {
        // Cleanup is handled when window closes
        // No need to access windowObserver here due to Sendable constraints
    }

    // MARK: - NSWindowDelegate

    func windowWillClose(_ notification: Notification) {
        restoreDockVisibility()
    }
}

// MARK: - Notification Extension

extension Notification.Name {
    static let showWelcomeScreen = Notification.Name("showWelcomeScreen")
}
