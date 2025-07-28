import AppKit
import Observation
import SwiftUI

#if !SWIFT_PACKAGE
    /// gross hack: https://stackoverflow.com/questions/26004684/nsstatusbarbutton-keep-highlighted?rq=4
    /// Didn't manage to keep the highlighted state reliable active with any other way.
    /// DO NOT CHANGE THIS! Yes, accessing AppDelegate is ugly, but it's the ONLY reliable way
    /// to maintain button highlight state. All other approaches have been tried and failed.
    extension NSStatusBarButton {
        override public func mouseDown(with event: NSEvent) {
            super.mouseDown(with: event)
            self.highlight(true)
            DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(100)) {
                self
                    .highlight(
                        AppDelegate.shared?.statusBarController?.menuManager.customWindow?
                            .isWindowVisible ?? false
                    )
            }
        }
    }
#endif

/// Manages status bar menu behavior, providing left-click custom view and right-click context menu functionality.
///
/// Coordinates between the status bar button, custom popover window, and context menu,
/// handling mouse events and window state transitions. Provides special handling for
/// maintaining button highlight state during custom window display.
@MainActor
@Observable
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
    private var gitRepositoryMonitor: GitRepositoryMonitor?
    private var repositoryDiscovery: RepositoryDiscoveryService?
    private var configManager: ConfigManager?
    private var worktreeService: WorktreeService?

    // Custom window management
    fileprivate var customWindow: CustomMenuWindow?
    private weak var statusBarButton: NSStatusBarButton?
    private weak var currentStatusItem: NSStatusItem?

    /// State management
    private var menuState: MenuState = .none

    /// Track new session state
    private var isNewSessionActive = false {
        didSet {
            // Update window when state changes
            customWindow?.isNewSessionActive = isNewSessionActive
        }
    }

    // MARK: - Initialization

    override init() {
        super.init()
    }

    // MARK: - Setup

    func setup(with configuration: StatusBarMenuConfiguration) {
        self.sessionMonitor = configuration.sessionMonitor
        self.serverManager = configuration.serverManager
        self.ngrokService = configuration.ngrokService
        self.tailscaleService = configuration.tailscaleService
        self.terminalLauncher = configuration.terminalLauncher
        self.gitRepositoryMonitor = configuration.gitRepositoryMonitor
        self.repositoryDiscovery = configuration.repositoryDiscovery
        self.configManager = configuration.configManager
        self.worktreeService = configuration.worktreeService
    }

    // MARK: - State Management

    private func updateMenuState(_ newState: MenuState, button: NSStatusBarButton? = nil) {
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
              let terminalLauncher,
              let gitRepositoryMonitor,
              let repositoryDiscovery,
              let configManager,
              let worktreeService else { return }

        // Update menu state to custom window FIRST before any async operations
        updateMenuState(.customWindow, button: button)

        // Create SessionService instance
        let sessionService = SessionService(serverManager: serverManager, sessionMonitor: sessionMonitor)

        // Create the main view with all dependencies and binding
        let sessionBinding = Binding(
            get: { [weak self] in self?.isNewSessionActive ?? false },
            set: { [weak self] in self?.isNewSessionActive = $0 }
        )
        let mainView = VibeTunnelMenuView(isNewSessionActive: sessionBinding)
            .environment(sessionMonitor)
            .environment(serverManager)
            .environment(ngrokService)
            .environment(tailscaleService)
            .environment(terminalLauncher)
            .environment(sessionService)
            .environment(gitRepositoryMonitor)
            .environment(repositoryDiscovery)
            .environment(configManager)
            .environment(worktreeService)

        // Wrap in custom container for proper styling
        let containerView = CustomMenuContainer {
            mainView
        }

        // Hide and cleanup old window before creating new one
        customWindow?.hide()
        customWindow = nil
        customWindow = CustomMenuWindow(contentView: containerView)

        // Set up callbacks for window show/hide
        customWindow?.onShow = { [weak self] in
            // Start monitoring git repositories for updates every 5 seconds
            self?.gitRepositoryMonitor?.startMonitoring()
        }

        customWindow?.onHide = { [weak self] in
            self?.statusBarButton?.highlight(false)

            // Stop monitoring git repositories when menu closes
            self?.gitRepositoryMonitor?.stopMonitoring()

            // Ensure state is reset on main thread
            Task { @MainActor in
                self?.updateMenuState(.none)
            }
        }

        // Sync the new session state with the window
        if let window = customWindow {
            window.isNewSessionActive = isNewSessionActive
        }

        // Show the custom window
        customWindow?.show(relativeTo: button)
        statusBarButton?.highlight(true)
    }

    func hideCustomWindow() {
        if customWindow?.isWindowVisible ?? false {
            customWindow?.hide()
        }
        // Reset new session state when hiding
        isNewSessionActive = false
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
