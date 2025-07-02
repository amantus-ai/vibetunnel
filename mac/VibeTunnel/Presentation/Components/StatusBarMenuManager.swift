import AppKit
import SwiftUI

/// Manages status bar menu behavior, providing left-click custom view and right-click context menu functionality.
@MainActor
final class StatusBarMenuManager: NSObject {
    // MARK: - Menu State Management

    private enum MenuState {
        case none
        case customWindow
        case contextMenu
    }

    // MARK: - Private Properties

    private var sessionMonitor: SessionMonitor?
    private var serverManager: ServerManager?
    private var ngrokService: NgrokService?
    private var tailscaleService: TailscaleService?
    private var terminalLauncher: TerminalLauncher?

    // Custom window management
    private var customWindow: CustomMenuWindow?
    private weak var statusBarButton: NSStatusBarButton?
    private weak var currentStatusItem: NSStatusItem?

    // State management
    private var menuState: MenuState = .none
    private var highlightTask: Task<Void, Never>?

    // MARK: - Initialization

    override init() {
        super.init()
    }

    // MARK: - Configuration

    struct Configuration {
        let sessionMonitor: SessionMonitor
        let serverManager: ServerManager
        let ngrokService: NgrokService
        let tailscaleService: TailscaleService
        let terminalLauncher: TerminalLauncher
    }

    // MARK: - Setup

    func setup(with configuration: Configuration) {
        self.sessionMonitor = configuration.sessionMonitor
        self.serverManager = configuration.serverManager
        self.ngrokService = configuration.ngrokService
        self.tailscaleService = configuration.tailscaleService
        self.terminalLauncher = configuration.terminalLauncher
    }

    // MARK: - State Management

    private func updateMenuState(_ newState: MenuState, button: NSStatusBarButton? = nil) {
        // Cancel any pending highlight task
        highlightTask?.cancel()

        // Update state
        menuState = newState

        // Update button reference if provided
        if let button {
            statusBarButton = button
        }

        // Reset button state when no menu is active
        if newState == .none {
            statusBarButton?.state = .off
        }
    }

    // MARK: - Left-Click Custom Window Management

    func toggleCustomWindow(relativeTo button: NSStatusBarButton) {
        if let window = customWindow, window.isVisible {
            hideCustomWindow()
        } else {
            showCustomWindow(relativeTo: button)
        }
    }

    func showCustomWindow(relativeTo button: NSStatusBarButton) {
        guard let sessionMonitor,
              let serverManager,
              let ngrokService,
              let tailscaleService,
              let terminalLauncher else { return }

        // Update menu state to custom window FIRST before any async operations
        updateMenuState(.customWindow, button: button)

        // Ensure button state is set immediately and persistently
        button.state = .on

        // Force another button state update to ensure it sticks
        DispatchQueue.main.async {
            button.state = .on
        }

        // Create SessionService instance
        let sessionService = SessionService(serverManager: serverManager, sessionMonitor: sessionMonitor)

        // Create the main view with all dependencies
        let mainView = VibeTunnelMenuView()
            .environment(sessionMonitor)
            .environment(serverManager)
            .environment(ngrokService)
            .environment(tailscaleService)
            .environment(terminalLauncher)
            .environment(sessionService)

        // Wrap in custom container for proper styling
        let containerView = CustomMenuContainer {
            mainView
        }

        // Create custom window if needed
        if customWindow == nil {
            customWindow = CustomMenuWindow(contentView: containerView)

            // Set up callback to reset state when window hides
            customWindow?.onHide = { [weak self] in
                // Ensure state is reset on main thread
                Task { @MainActor in
                    self?.updateMenuState(.none)
                }
            }
        } else {
            // Hide and cleanup old window before creating new one
            customWindow?.hide()
            customWindow = nil

            // Create new window with updated content
            customWindow = CustomMenuWindow(contentView: containerView)
            customWindow?.onHide = { [weak self] in
                Task { @MainActor in
                    self?.updateMenuState(.none)
                }
            }
        }

        // Show the custom window
        customWindow?.show(relativeTo: button)
    }

    func hideCustomWindow() {
        customWindow?.hide()
        // Button state will be reset by updateMenuState(.none) in the onHide callback
    }

    var isCustomWindowVisible: Bool {
        customWindow?.isWindowVisible ?? false
    }

    // MARK: - Menu State Management

    func hideAllMenus() {
        hideCustomWindow()
        // If there's a context menu showing, dismiss it
        if menuState == .contextMenu, let statusItem = currentStatusItem {
            statusItem.menu = nil
        }
        // Reset state to none
        updateMenuState(.none)
    }

    var isAnyMenuVisible: Bool {
        // Check both the menu state and the actual window visibility
        menuState != .none || (customWindow?.isWindowVisible ?? false)
    }

    // MARK: - Right-Click Context Menu

    func showContextMenu(for button: NSStatusBarButton, statusItem: NSStatusItem) {
        // Hide custom window first if it's visible
        hideCustomWindow()

        // Store status item reference
        currentStatusItem = statusItem

        // Set the button's state to on for context menu
        button.state = .on

        // Update menu state to context menu
        updateMenuState(.contextMenu, button: button)

        let menu = NSMenu()
        menu.delegate = self

        // Server status
        if let serverManager {
            let statusText = serverManager.isRunning ? "Server running" : "Server stopped"
            let statusItem = NSMenuItem(title: statusText, action: nil, keyEquivalent: "")
            statusItem.isEnabled = false
            menu.addItem(statusItem)

            menu.addItem(NSMenuItem.separator())

            // Restart server
            let restartItem = NSMenuItem(title: "Restart", action: #selector(restartServer), keyEquivalent: "")
            restartItem.target = self
            menu.addItem(restartItem)

            menu.addItem(NSMenuItem.separator())
        }

        // Open Dashboard
        if let serverManager, serverManager.isRunning {
            let dashboardItem = NSMenuItem(title: "Open Dashboard", action: #selector(openDashboard), keyEquivalent: "")
            dashboardItem.target = self
            menu.addItem(dashboardItem)

            menu.addItem(NSMenuItem.separator())
        }

        // Help submenu
        let helpMenu = NSMenu()

        let tutorialItem = NSMenuItem(title: "Show Tutorial", action: #selector(showTutorial), keyEquivalent: "")
        tutorialItem.target = self
        helpMenu.addItem(tutorialItem)

        helpMenu.addItem(NSMenuItem.separator())

        let websiteItem = NSMenuItem(title: "Website", action: #selector(openWebsite), keyEquivalent: "")
        websiteItem.target = self
        helpMenu.addItem(websiteItem)

        let issueItem = NSMenuItem(title: "Report Issue", action: #selector(reportIssue), keyEquivalent: "")
        issueItem.target = self
        helpMenu.addItem(issueItem)

        helpMenu.addItem(NSMenuItem.separator())

        let updateItem = NSMenuItem(title: "Check for Updates…", action: #selector(checkForUpdates), keyEquivalent: "")
        updateItem.target = self
        helpMenu.addItem(updateItem)

        let versionItem = NSMenuItem(title: "Version \(appVersion)", action: nil, keyEquivalent: "")
        versionItem.isEnabled = false
        helpMenu.addItem(versionItem)

        helpMenu.addItem(NSMenuItem.separator())

        let aboutItem = NSMenuItem(title: "About VibeTunnel", action: #selector(showAbout), keyEquivalent: "")
        aboutItem.target = self
        helpMenu.addItem(aboutItem)

        let helpMenuItem = NSMenuItem(title: "Help", action: nil, keyEquivalent: "")
        helpMenuItem.submenu = helpMenu
        menu.addItem(helpMenuItem)

        // Settings
        let settingsItem = NSMenuItem(title: "Settings...", action: #selector(openSettings), keyEquivalent: ",")
        settingsItem.target = self
        menu.addItem(settingsItem)

        menu.addItem(NSMenuItem.separator())

        // Quit
        let quitItem = NSMenuItem(title: "Quit VibeTunnel", action: #selector(quitApp), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        // Show the context menu
        // Use popUpMenu for proper context menu display that doesn't interfere with button highlighting
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: button.bounds.height + 5), in: button)
    }

    // MARK: - Context Menu Actions

    @objc
    private func openDashboard() {
        guard let serverManager else { return }
        if let url = DashboardURLBuilder.dashboardURL(port: serverManager.port) {
            NSWorkspace.shared.open(url)
        }
    }

    @objc
    private func restartServer() {
        guard let serverManager else { return }
        Task {
            await serverManager.restart()
        }
    }

    @objc
    private func showTutorial() {
        #if !SWIFT_PACKAGE
            AppDelegate.showWelcomeScreen()
        #endif
    }

    @objc
    private func openWebsite() {
        if let url = URL(string: "http://vibetunnel.sh") {
            NSWorkspace.shared.open(url)
        }
    }

    @objc
    private func reportIssue() {
        if let url = URL(string: "https://github.com/amantus-ai/vibetunnel/issues") {
            NSWorkspace.shared.open(url)
        }
    }

    @objc
    private func checkForUpdates() {
        SparkleUpdaterManager.shared.checkForUpdates()
    }

    @objc
    private func showAbout() {
        SettingsOpener.openSettings()
        Task {
            try? await Task.sleep(for: .milliseconds(100))
            NotificationCenter.default.post(
                name: .openSettingsTab,
                object: SettingsTab.about
            )
        }
    }

    @objc
    private func openSettings() {
        SettingsOpener.openSettings()
    }

    @objc
    private func quitApp() {
        NSApplication.shared.terminate(nil)
    }

    private var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
    }
}

// MARK: - NSMenuDelegate

extension StatusBarMenuManager: NSMenuDelegate {
    func menuDidClose(_ menu: NSMenu) {
        // Reset button state
        statusBarButton?.state = .off

        // Reset menu state when context menu closes
        updateMenuState(.none)

        // Clean up the menu from status item
        if let statusItem = currentStatusItem {
            statusItem.menu = nil
        }

        // Clear the stored reference
        currentStatusItem = nil
    }
}
