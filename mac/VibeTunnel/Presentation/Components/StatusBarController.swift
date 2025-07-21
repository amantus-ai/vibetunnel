import AppKit
import Combine
import Observation
import SwiftUI

/// Manages the macOS status bar item with custom left-click view and right-click menu.
///
/// Central controller for VibeTunnel's menu bar presence, handling status bar icon updates,
/// tooltip management, and coordination between the visual menu interface and context menu.
/// Monitors server and session states to update the status bar appearance accordingly.
@MainActor
final class StatusBarController: NSObject {
    // MARK: - Core Properties

    private var statusItem: NSStatusItem?
    let menuManager: StatusBarMenuManager
    private var iconController: StatusBarIconController?

    // MARK: - Dependencies

    private let sessionMonitor: SessionMonitor
    private let serverManager: ServerManager
    private let ngrokService: NgrokService
    private let tailscaleService: TailscaleService
    private let terminalLauncher: TerminalLauncher
    private let gitRepositoryMonitor: GitRepositoryMonitor
    private let repositoryDiscovery: RepositoryDiscoveryService

    // MARK: - State Tracking

    private var cancellables = Set<AnyCancellable>()
    private var updateTimer: Timer?
    private var hasNetworkAccess = true

    // MARK: - Initialization

    init(
        sessionMonitor: SessionMonitor,
        serverManager: ServerManager,
        ngrokService: NgrokService,
        tailscaleService: TailscaleService,
        terminalLauncher: TerminalLauncher,
        gitRepositoryMonitor: GitRepositoryMonitor,
        repositoryDiscovery: RepositoryDiscoveryService
    ) {
        self.sessionMonitor = sessionMonitor
        self.serverManager = serverManager
        self.ngrokService = ngrokService
        self.tailscaleService = tailscaleService
        self.terminalLauncher = terminalLauncher
        self.gitRepositoryMonitor = gitRepositoryMonitor
        self.repositoryDiscovery = repositoryDiscovery

        self.menuManager = StatusBarMenuManager()

        super.init()

        setupStatusItem()
        setupMenuManager()
        setupObservers()
        setupNetworkMonitoring()
    }

    // MARK: - Setup

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        if let button = statusItem?.button {
            button.imagePosition = .imageLeading
            button.action = #selector(handleClick(_:))
            button.target = self
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])

            // Use pushOnPushOff for proper state management
            button.setButtonType(.toggle)

            // Accessibility
            button.setAccessibilityTitle(getAppDisplayName())
            button.setAccessibilityRole(.button)
            button.setAccessibilityHelp("Shows terminal sessions and server information")

            // Initialize the icon controller
            iconController = StatusBarIconController(button: button)

            updateStatusItemDisplay()
        }
    }

    private func setupMenuManager() {
        let configuration = StatusBarMenuManager.Configuration(
            sessionMonitor: sessionMonitor,
            serverManager: serverManager,
            ngrokService: ngrokService,
            tailscaleService: tailscaleService,
            terminalLauncher: terminalLauncher,
            gitRepositoryMonitor: gitRepositoryMonitor,
            repositoryDiscovery: repositoryDiscovery
        )
        menuManager.setup(with: configuration)
    }

    private func setupObservers() {
        // Start observing server state changes
        observeServerState()

        // Create a timer to periodically update the display
        // since SessionMonitor doesn't have a publisher
        updateTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            Task { @MainActor in
                _ = await self?.sessionMonitor.getSessions()
                self?.updateStatusItemDisplay()
            }
        }
    }

    private func observeServerState() {
        withObservationTracking {
            _ = serverManager.isRunning
        } onChange: { [weak self] in
            Task { @MainActor in
                self?.updateStatusItemDisplay()
                // Re-register the observation for continuous tracking
                self?.observeServerState()
            }
        }
    }

    private func setupNetworkMonitoring() {
        // Start the network monitor
        NetworkMonitor.shared.startMonitoring()

        // Listen for network status changes
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(networkStatusChanged(_:)),
            name: .networkStatusChanged,
            object: nil
        )

        // Set initial state
        hasNetworkAccess = NetworkMonitor.shared.isConnected
    }

    @objc
    private func networkStatusChanged(_ notification: Notification) {
        hasNetworkAccess = NetworkMonitor.shared.isConnected
        updateStatusItemDisplay()
    }

    // MARK: - Display Updates

    func updateStatusItemDisplay() {
        guard let button = statusItem?.button else { return }

        // Update accessibility title (might have changed due to debug/dev server state)
        button.setAccessibilityTitle(getAppDisplayName())

        // Update icon and title using the dedicated controller
        iconController?.update(serverManager: serverManager, sessionMonitor: sessionMonitor)

        // Update tooltip using the dedicated provider
        button.toolTip = TooltipProvider.generateTooltip(
            serverManager: serverManager,
            ngrokService: ngrokService,
            tailscaleService: tailscaleService,
            sessionMonitor: sessionMonitor
        )
    }

    // MARK: - Click Handling

    @objc
    private func handleClick(_ sender: NSStatusBarButton) {
        guard let currentEvent = NSApp.currentEvent else {
            handleLeftClick(sender)
            return
        }

        switch currentEvent.type {
        case .leftMouseUp:
            handleLeftClick(sender)
        case .rightMouseUp:
            handleRightClick(sender)
        default:
            handleLeftClick(sender)
        }
    }

    private func handleLeftClick(_ button: NSStatusBarButton) {
        menuManager.toggleCustomWindow(relativeTo: button)
    }

    private func handleRightClick(_ button: NSStatusBarButton) {
        guard let statusItem else { return }
        menuManager.showContextMenu(for: button, statusItem: statusItem)
    }

    // MARK: - Public Methods

    func showCustomWindow() {
        guard let button = statusItem?.button else { return }
        menuManager.showCustomWindow(relativeTo: button)
    }

    func toggleCustomWindow() {
        guard let button = statusItem?.button else { return }
        menuManager.toggleCustomWindow(relativeTo: button)
    }

    // MARK: - Helpers

    private func getAppDisplayName() -> String {
        let (debugMode, useDevServer) = AppConstants.getDevelopmentStatus()

        var name = debugMode ? "VibeTunnel Debug" : "VibeTunnel"
        if useDevServer && serverManager.isRunning {
            name += " Dev Server"
        }
        return name
    }

    // MARK: - Cleanup

    deinit {
        MainActor.assumeIsolated {
            updateTimer?.invalidate()
            NotificationCenter.default.removeObserver(self)
        }
    }
}
