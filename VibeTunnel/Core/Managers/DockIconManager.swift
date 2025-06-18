import AppKit

/// Centralized manager for dock icon visibility.
///
/// This manager ensures the dock icon is shown whenever any window is visible,
/// regardless of user preference. It tracks all application windows and only
/// hides the dock icon when no windows are open AND the user preference is
/// set to hide the dock icon.
@MainActor
final class DockIconManager {
    static let shared = DockIconManager()
    
    private var windowObservers: [NSObjectProtocol] = []
    private var activeWindows = Set<NSWindow>()
    
    private init() {
        setupNotifications()
    }
    
    deinit {
        // Observers are cleaned up when windows close
        // No need to access windowObservers here due to Sendable constraints
    }
    
    // MARK: - Public Methods
    
    /// Register a window to be tracked for dock icon visibility.
    /// The dock icon will remain visible as long as any registered window is open.
    func trackWindow(_ window: NSWindow) {
        activeWindows.insert(window)
        updateDockVisibility()
        
        // Observe when this window closes
        let observer = NotificationCenter.default.addObserver(
            forName: NSWindow.willCloseNotification,
            object: window,
            queue: .main
        ) { [weak self, weak window] _ in
            Task { @MainActor in
                guard let self, let window else { return }
                self.activeWindows.remove(window)
                self.updateDockVisibility()
            }
        }
        
        windowObservers.append(observer)
    }
    
    /// Update dock visibility based on current state.
    /// Call this when user preferences change or when you need to ensure proper state.
    func updateDockVisibility() {
        let userWantsDockHidden = !UserDefaults.standard.bool(forKey: "showInDock")
        let hasActiveWindows = !activeWindows.isEmpty
        
        // Show dock if user wants it shown OR if any windows are open
        if !userWantsDockHidden || hasActiveWindows {
            NSApp.setActivationPolicy(.regular)
        } else {
            NSApp.setActivationPolicy(.accessory)
        }
    }
    
    /// Force show the dock icon temporarily (e.g., when opening a window).
    /// The dock visibility will be properly managed once the window is tracked.
    func temporarilyShowDock() {
        NSApp.setActivationPolicy(.regular)
    }
    
    // MARK: - Private Methods
    
    private func setupNotifications() {
        // Listen for preference changes
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(dockPreferenceChanged),
            name: UserDefaults.didChangeNotification,
            object: nil
        )
    }
    
    @objc
    private func dockPreferenceChanged(_ notification: Notification) {
        // Only update if no windows are open
        if activeWindows.isEmpty {
            updateDockVisibility()
        }
    }
}