import AppKit
import Combine
import Network
import Observation
import SwiftUI

/// Manages the macOS status bar item with custom left-click view and right-click menu.
@MainActor
final class StatusBarController: NSObject {
    // MARK: - Core Properties

    private var statusItem: NSStatusItem?
    let menuManager: StatusBarMenuManager

    // MARK: - Dependencies

    private let sessionMonitor: SessionMonitor
    private let serverManager: ServerManager
    private let ngrokService: NgrokService
    private let tailscaleService: TailscaleService
    private let terminalLauncher: TerminalLauncher

    // MARK: - State Tracking

    private var cancellables = Set<AnyCancellable>()
    private var updateTimer: Timer?
    private let monitor = NWPathMonitor()
    private let monitorQueue = DispatchQueue(label: "vibetunnel.network.monitor")
    private var hasNetworkAccess = true

    // MARK: - Initialization

    init(
        sessionMonitor: SessionMonitor,
        serverManager: ServerManager,
        ngrokService: NgrokService,
        tailscaleService: TailscaleService,
        terminalLauncher: TerminalLauncher
    ) {
        self.sessionMonitor = sessionMonitor
        self.serverManager = serverManager
        self.ngrokService = ngrokService
        self.tailscaleService = tailscaleService
        self.terminalLauncher = terminalLauncher

        self.menuManager = StatusBarMenuManager()

        super.init()

        setupStatusItem()
        setupMenuManager()
        setupObservers()
        startNetworkMonitoring()
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
            button.setAccessibilityTitle("VibeTunnel")
            button.setAccessibilityRole(.button)
            button.setAccessibilityHelp("Shows terminal sessions and server information")

            updateStatusItemDisplay()
        }
    }

    private func setupMenuManager() {
        let configuration = StatusBarMenuManager.Configuration(
            sessionMonitor: sessionMonitor,
            serverManager: serverManager,
            ngrokService: ngrokService,
            tailscaleService: tailscaleService,
            terminalLauncher: terminalLauncher
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

    private func startNetworkMonitoring() {
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                self?.hasNetworkAccess = path.status == .satisfied
                self?.updateStatusItemDisplay()
            }
        }
        monitor.start(queue: monitorQueue)
    }

    // MARK: - Display Updates

    func updateStatusItemDisplay() {
        guard let button = statusItem?.button else { return }

        // Update icon based on server and network status
        let iconName = (serverManager.isRunning && hasNetworkAccess) ? "menubar" : "menubar.inactive"
        if let image = NSImage(named: iconName) {
            image.isTemplate = true
            button.image = image
        } else {
            // Fallback to regular icon
            if let image = NSImage(named: "menubar") {
                image.isTemplate = true
                button.image = image
                button.alphaValue = (serverManager.isRunning && hasNetworkAccess) ? 1.0 : 0.5
            }
        }

        // Update session count display
        let sessions = sessionMonitor.sessions.values.filter(\.isRunning)
        let activeSessions = sessions.filter { session in
            // Check if session has recent activity (Claude Code or other custom actions)
            if let activityStatus = session.activityStatus?.specificStatus?.status {
                return !activityStatus.isEmpty
            }
            return false
        }

        let activeCount = activeSessions.count
        let totalCount = sessions.count
        let idleCount = totalCount - activeCount

        // Format the title with minimalist indicator
        let indicator = formatSessionIndicator(activeCount: activeCount, idleCount: idleCount)
        button.title = indicator.isEmpty ? "" : " " + indicator

        // Update tooltip
        updateTooltip()
    }

    private func updateTooltip() {
        guard let button = statusItem?.button else { return }

        var tooltipParts: [String] = []

        // Server status
        if serverManager.isRunning {
            let bindAddress = serverManager.bindAddress
            if bindAddress == "127.0.0.1" {
                tooltipParts.append("Server: 127.0.0.1:\(serverManager.port)")
            } else if let localIP = NetworkUtility.getLocalIPAddress() {
                tooltipParts.append("Server: \(localIP):\(serverManager.port)")
            }

            // ngrok status
            if ngrokService.isActive, let publicURL = ngrokService.publicUrl {
                tooltipParts.append("ngrok: \(publicURL)")
            }

            // Tailscale status
            if tailscaleService.isRunning, let hostname = tailscaleService.tailscaleHostname {
                tooltipParts.append("Tailscale: \(hostname)")
            }
        } else {
            tooltipParts.append("Server stopped")
        }

        // Session info
        let sessions = sessionMonitor.sessions.values.filter(\.isRunning)
        if !sessions.isEmpty {
            let activeSessions = sessions.filter { session in
                if let activityStatus = session.activityStatus?.specificStatus?.status {
                    return !activityStatus.isEmpty
                }
                return false
            }

            let idleCount = sessions.count - activeSessions.count
            if !activeSessions.isEmpty {
                if idleCount > 0 {
                    tooltipParts
                        .append(
                            "\(activeSessions.count) active, \(idleCount) idle session\(sessions.count == 1 ? "" : "s")"
                        )
                } else {
                    tooltipParts.append("\(activeSessions.count) active session\(activeSessions.count == 1 ? "" : "s")")
                }
            } else {
                tooltipParts.append("\(sessions.count) idle session\(sessions.count == 1 ? "" : "s")")
            }
        }

        button.toolTip = tooltipParts.joined(separator: "\n")
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

    // MARK: - Cleanup

    deinit {
        MainActor.assumeIsolated {
            updateTimer?.invalidate()
        }
        monitor.cancel()
    }
}
