import AppKit
import OSLog

/// Centralized manager for dock icon visibility.
///
/// This manager ensures the dock icon is shown whenever any window is visible,
/// regardless of user preference. It uses KVO to monitor NSApplication.windows
/// and only hides the dock icon when no windows are open AND the user preference
/// is set to hide the dock icon.
final class DockIconManager: NSObject, @unchecked Sendable {
    /// Shared instance
    static let shared = DockIconManager()

    private var windowsObservation: NSKeyValueObservation?
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "DockIconManager")

    override private init() {
        super.init()
        setupObservers()
        Task { @MainActor in
            self.updateDockVisibility()
        }
    }

    deinit {
        windowsObservation?.invalidate()
        NotificationCenter.default.removeObserver(self)
    }

    // MARK: - Public Methods

    /// Update dock visibility based on current state.
    /// Call this when user preferences change or when you need to ensure proper state.
    func updateDockVisibility() {
        Task { @MainActor in
            // Ensure NSApp is available before proceeding
            guard NSApp != nil else {
                logger.warning("NSApp not available yet, skipping dock visibility update")
                return
            }

            let userWantsDockHidden = !UserDefaults.standard.bool(forKey: "showInDock")

            // Count visible windows (excluding panels and hidden windows)
            let visibleWindows = NSApp?.windows.filter { window in
                window.isVisible &&
                    window.frame.width > 1 && window.frame.height > 1 && // settings window hack
                    !window.isKind(of: NSPanel.self) &&
                    "\(type(of: window))" != "NSPopupMenuWindow" && // Filter out popup menus (menu bar sidebar)
                    window.contentViewController != nil
            } ?? []

            let hasVisibleWindows = !visibleWindows.isEmpty

            // logger.info("Updating dock visibility - User wants hidden: \(userWantsDockHidden), Visible windows:
            // \(visibleWindows.count)")

            // Log window details for debugging
            // for window in visibleWindows {
            //     logger.debug("  Visible window: \(window.title.isEmpty ? "(untitled)" : window.title, privacy:
            //     .public)")
            // }

            // Show dock if user wants it shown OR if any windows are open
            if !userWantsDockHidden || hasVisibleWindows {
                // logger.info("Showing dock icon")
                NSApp?.setActivationPolicy(.regular)
            } else {
                // logger.info("Hiding dock icon")
                NSApp?.setActivationPolicy(.accessory)
            }
        }
    }

    /// Force show the dock icon temporarily (e.g., when opening a window).
    /// The dock visibility will be properly managed automatically via KVO.
    func temporarilyShowDock() {
        Task { @MainActor in
            guard NSApp != nil else {
                logger.warning("NSApp not available, cannot temporarily show dock")
                return
            }
            NSApp.setActivationPolicy(.regular)
        }
    }

    // MARK: - Private Methods

    private func setupObservers() {
        Task { @MainActor in
            // Ensure NSApp is available before setting up observers
            guard NSApp != nil else {
                logger.warning("NSApp not available, delaying observer setup")
                try? await Task.sleep(for: .milliseconds(200))
                self.setupObservers()
                return
            }

            // Observe changes to NSApp.windows using KVO
            // Remove .initial option to avoid triggering during initialization
            if let app = NSApp {
                windowsObservation = app.observe(\.windows, options: [.new]) { [weak self] _, _ in
                    Task { @MainActor in
                        // Add a small delay to let window state settle
                        try? await Task.sleep(for: .milliseconds(50))
                        self?.updateDockVisibility()
                    }
                }
            }

            // Also observe individual window visibility changes
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(windowVisibilityChanged),
                name: NSWindow.didBecomeKeyNotification,
                object: nil
            )

            NotificationCenter.default.addObserver(
                self,
                selector: #selector(windowVisibilityChanged),
                name: NSWindow.didResignKeyNotification,
                object: nil
            )

            NotificationCenter.default.addObserver(
                self,
                selector: #selector(windowVisibilityChanged),
                name: NSWindow.willCloseNotification,
                object: nil
            )

            // Listen for preference changes
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(dockPreferenceChanged),
                name: UserDefaults.didChangeNotification,
                object: nil
            )
        }
    }

    @objc
    private func windowVisibilityChanged(_ notification: Notification) {
        Task { @MainActor in
            updateDockVisibility()
        }
    }

    @objc
    private func dockPreferenceChanged(_ notification: Notification) {
        // Only update if the specific dock preference changed
        guard let userDefaults = notification.object as? UserDefaults,
              userDefaults == UserDefaults.standard else { return }

        Task { @MainActor in
            self.updateDockVisibility()
        }
    }
}
