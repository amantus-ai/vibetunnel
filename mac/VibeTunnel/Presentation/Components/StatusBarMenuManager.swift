import AppKit
import SwiftUI

/// Manages status bar menu behavior, providing left-click custom view and right-click context menu functionality.
@MainActor
final class StatusBarMenuManager {
    // MARK: - Private Properties

    private var sessionMonitor: SessionMonitor?
    private var serverManager: ServerManager?
    private var ngrokService: NgrokService?
    private var tailscaleService: TailscaleService?
    private var terminalLauncher: TerminalLauncher?

    // Custom window management
    private var customWindow: CustomMenuWindow?
    private weak var statusBarButton: NSStatusBarButton?

    // MARK: - Initialization

    init() {}

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

        // Store button reference
        self.statusBarButton = button

        // Highlight the button immediately to show active state
        button.highlight(true)

        // Create the main view with all dependencies
        let mainView = VibeTunnelMenuView()
            .environment(sessionMonitor)
            .environment(serverManager)
            .environment(ngrokService)
            .environment(tailscaleService)
            .environment(terminalLauncher)

        // Wrap in custom container for proper styling
        let containerView = CustomMenuContainer {
            mainView
        }

        // Create custom window if needed
        if customWindow == nil {
            customWindow = CustomMenuWindow(contentView: containerView)

            // Set up callback to unhighlight button when window hides
            customWindow?.onHide = { [weak self] in
                // Ensure button is unhighlighted on main thread
                Task { @MainActor in
                    self?.statusBarButton?.highlight(false)
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
                    self?.statusBarButton?.highlight(false)
                }
            }
        }

        // Show the custom window
        customWindow?.show(relativeTo: button)
    }

    func hideCustomWindow() {
        customWindow?.hide()
    }

    var isCustomWindowVisible: Bool {
        customWindow?.isVisible ?? false
    }

    // MARK: - Menu State Management

    func hideAllMenus() {
        hideCustomWindow()
    }

    var isAnyMenuVisible: Bool {
        isCustomWindowVisible
    }

    // MARK: - Right-Click Context Menu

    func showContextMenu(for button: NSStatusBarButton, statusItem: NSStatusItem) {
        // Hide custom window first if it's visible
        hideCustomWindow()

        let menu = NSMenu()

        // Server status
        if let serverManager {
            let statusText = serverManager.isRunning ? "Server running" : "Server stopped"
            let statusItem = NSMenuItem(title: statusText, action: nil, keyEquivalent: "")
            statusItem.isEnabled = false
            menu.addItem(statusItem)

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
        statusItem.menu = menu
        button.performClick(nil)
        statusItem.menu = nil
    }

    // MARK: - Context Menu Actions

    @objc
    private func openDashboard() {
        guard let serverManager else { return }
        if let url = URL(string: "http://127.0.0.1:\(serverManager.port)") {
            NSWorkspace.shared.open(url)
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
