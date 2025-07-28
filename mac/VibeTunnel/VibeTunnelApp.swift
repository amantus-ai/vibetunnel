import AppKit
import os.log
import SwiftUI
import UserNotifications

/// Main entry point for the VibeTunnel macOS application.
///
/// Manages the app's lifecycle and window hierarchy including the menu bar interface,
/// settings window, welcome screen, and session detail views. Coordinates shared services
/// across all windows and handles deep linking for terminal session URLs.
///
/// This application runs on macOS 14.0+ and requires Swift 6.
/// The app provides terminal access through web browsers.
@main
struct VibeTunnelApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self)
    var appDelegate
    @State var sessionMonitor = SessionMonitor.shared
    @State var serverManager = ServerManager.shared
    @State var ngrokService = NgrokService.shared
    @State var tailscaleService = TailscaleService.shared
    @State var cloudflareService = CloudflareService.shared
    @State var permissionManager = SystemPermissionManager.shared
    @State var terminalLauncher = TerminalLauncher.shared
    @State var gitRepositoryMonitor = GitRepositoryMonitor()
    @State var repositoryDiscoveryService = RepositoryDiscoveryService()
    @State var sessionService: SessionService?
    @State var worktreeService = WorktreeService(serverManager: ServerManager.shared)
    @State var configManager = ConfigManager.shared

    init() {
        // Connect the app delegate to this app instance
        _appDelegate.wrappedValue.app = self
    }

    var body: some Scene {
        // Hidden WindowGroup to make Settings work in MenuBarExtra-only apps
        // This is a workaround for FB10184971
        WindowGroup("HiddenWindow") {
            HiddenWindowView()
        }
        .windowResizability(.contentSize)
        .defaultSize(width: 1, height: 1)
        .windowStyle(.hiddenTitleBar)

        // Welcome Window
        WindowGroup("Welcome", id: "welcome") {
            WelcomeView()
                .environment(sessionMonitor)
                .environment(serverManager)
                .environment(ngrokService)
                .environment(tailscaleService)
                .environment(cloudflareService)
                .environment(permissionManager)
                .environment(terminalLauncher)
                .environment(gitRepositoryMonitor)
                .environment(repositoryDiscoveryService)
                .environment(configManager)
                .environment(worktreeService)
        }
        .windowResizability(.contentSize)
        .defaultSize(width: 580, height: 480)
        .windowStyle(.hiddenTitleBar)

        // Session Detail Window
        WindowGroup("Session Details", id: "session-detail", for: String.self) { $sessionId in
            if let sessionId,
               let session = sessionMonitor.sessions[sessionId]
            {
                SessionDetailView(session: session)
                    .environment(sessionMonitor)
                    .environment(serverManager)
                    .environment(ngrokService)
                    .environment(tailscaleService)
                    .environment(cloudflareService)
                    .environment(permissionManager)
                    .environment(terminalLauncher)
                    .environment(gitRepositoryMonitor)
                    .environment(repositoryDiscoveryService)
                    .environment(configManager)
                    .environment(sessionService ?? SessionService(
                        serverManager: serverManager,
                        sessionMonitor: sessionMonitor
                    ))
                    .environment(worktreeService)
            } else {
                Text("Session not found")
                    .frame(width: 400, height: 300)
            }
        }
        .windowResizability(.contentSize)

        // New Session is now integrated into the popover

        Settings {
            SettingsView()
                .environment(sessionMonitor)
                .environment(serverManager)
                .environment(ngrokService)
                .environment(tailscaleService)
                .environment(cloudflareService)
                .environment(permissionManager)
                .environment(terminalLauncher)
                .environment(gitRepositoryMonitor)
                .environment(repositoryDiscoveryService)
                .environment(configManager)
                .environment(sessionService ?? SessionService(
                    serverManager: serverManager,
                    sessionMonitor: sessionMonitor
                ))
                .environment(worktreeService)
        }
        .commands {
            CommandGroup(after: .appInfo) {
                Button("About VibeTunnel") {
                    SettingsOpener.openSettings()
                    // Navigate to About tab after settings opens
                    Task {
                        try? await Task.sleep(for: .milliseconds(100))
                        NotificationCenter.default.post(
                            name: .openSettingsTab,
                            object: SettingsTab.about
                        )
                    }
                }
            }
        }
    }
}

// MARK: - App Delegate

/// Manages app lifecycle, single instance enforcement, and core services.
///
/// Handles application-level responsibilities including server lifecycle management,
/// status bar setup, single instance enforcement via distributed notifications,
/// URL scheme handling, and user notification management. Acts as the central
/// coordinator for application-wide events and services.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, @preconcurrency UNUserNotificationCenterDelegate {
    // Needed for menu item highlight hack
    weak static var shared: AppDelegate?
    override init() {
        super.init()
        Self.shared = self
    }

    private(set) var sparkleUpdaterManager: SparkleUpdaterManager?
    var app: VibeTunnelApp?
    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "AppDelegate")
    private(set) var statusBarController: StatusBarController?
    private let notificationService = NotificationService.shared

    /// Distributed notification name used to ask an existing instance to show the Settings window.
    private static let showSettingsNotification = Notification.Name.showSettings

    func applicationDidFinishLaunching(_ notification: Notification) {
        let processInfo = ProcessInfo.processInfo
        let isRunningInTests = processInfo.environment["XCTestConfigurationFilePath"] != nil ||
            processInfo.environment["XCTestBundlePath"] != nil ||
            processInfo.environment["XCTestSessionIdentifier"] != nil ||
            processInfo.arguments.contains("-XCTest") ||
            NSClassFromString("XCTestCase") != nil
        let isRunningInPreview = processInfo.environment["XCODE_RUNNING_FOR_PREVIEWS"] == "1"
        #if DEBUG
            let isRunningInDebug = true
        #else
            let isRunningInDebug = processInfo.environment["DYLD_INSERT_LIBRARIES"]?
                .contains("libMainThreadChecker.dylib") ?? false ||
                processInfo.environment["__XCODE_BUILT_PRODUCTS_DIR_PATHS"] != nil
        #endif

        // Kill other VibeTunnel instances FIRST, before any other initialization
        // This ensures only the newest instance survives and prevents Unix socket conflicts
        if !isRunningInTests && !isRunningInPreview {
            ProcessKiller.killOtherInstances()
        }

        // Handle single instance check before doing anything else
        #if DEBUG
        // Skip single instance check in debug builds
        #else
            if !isRunningInPreview && !isRunningInTests && !isRunningInDebug {
                handleSingleInstanceCheck()
                registerForDistributedNotifications()

                // Check if app needs to be moved to Applications folder
                let applicationMover = ApplicationMover()
                applicationMover.checkAndOfferToMoveToApplications()
            }
        #endif

        // Register default values
        UserDefaults.standard.register(defaults: [
            "showInDock": true, // Default to showing in dock
            "dashboardAccessMode": AppConstants.Defaults.dashboardAccessMode
        ])

        // Initialize Sparkle updater manager
        sparkleUpdaterManager = SparkleUpdaterManager.shared

        // Set up notification center delegate
        UNUserNotificationCenter.current().delegate = self

        // Initialize dock icon visibility through DockIconManager
        DockIconManager.shared.updateDockVisibility()

        // Check CLI installation status
        let cliInstaller = CLIInstaller()
        cliInstaller.checkInstallationStatus()

        // Show welcome screen when version changes OR when vt script is outdated
        let storedWelcomeVersion = UserDefaults.standard.integer(forKey: AppConstants.UserDefaultsKeys.welcomeVersion)

        // Small delay to allow CLI check to complete
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            // Show welcome if version is different from current OR if vt script is outdated
            if (storedWelcomeVersion < AppConstants.currentWelcomeVersion || cliInstaller.isOutdated)
                && !isRunningInTests && !isRunningInPreview
            {
                self?.showWelcomeScreen()
            }
        }

        // Skip all service initialization during tests
        if isRunningInTests {
            logger.info("Running in test mode - skipping service initialization")
            return
        }

        // Verify preferred terminal is still available
        app?.terminalLauncher.verifyPreferredTerminal()

        // Listen for update check requests
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleCheckForUpdatesNotification),
            name: Notification.Name("checkForUpdates"),
            object: nil
        )

        // Initialize SessionService
        if let serverManager = app?.serverManager, let sessionMonitor = app?.sessionMonitor {
            app?.sessionService = SessionService(serverManager: serverManager, sessionMonitor: sessionMonitor)
        }

        // Start the terminal control handler (registers its handler)
        TerminalControlHandler.shared.start()

        // Initialize system control handler with ready callback
        SharedUnixSocketManager.shared.initializeSystemHandler {
            self.logger.info("🎉 System ready event received from server")
            // Could add any system-ready handling here if needed
        }

        // Start the shared unix socket manager after all handlers are registered
        SharedUnixSocketManager.shared.connect()

        // Start Git monitoring early
        app?.gitRepositoryMonitor.startMonitoring()

        // Initialize status bar controller IMMEDIATELY to show menu bar icon
        guard let app else {
            fatalError("VibeTunnelApp instance not connected to AppDelegate")
        }

        // Connect GitRepositoryMonitor to SessionMonitor for pre-caching
        app.sessionMonitor.gitRepositoryMonitor = app.gitRepositoryMonitor

        statusBarController = StatusBarController(
            sessionMonitor: app.sessionMonitor,
            serverManager: app.serverManager,
            ngrokService: app.ngrokService,
            tailscaleService: app.tailscaleService,
            terminalLauncher: app.terminalLauncher,
            gitRepositoryMonitor: app.gitRepositoryMonitor,
            repositoryDiscovery: app.repositoryDiscoveryService,
            configManager: app.configManager,
            worktreeService: app.worktreeService
        )

        // Initialize and start HTTP server using ServerManager
        Task {
            let serverManager = app.serverManager
            logger.info("Attempting to start HTTP server using ServerManager...")
            await serverManager.start()

            // Check if server actually started
            if serverManager.isRunning {
                logger.info("HTTP server started successfully on port \(serverManager.port)")

                // Update status bar icon to reflect server running state
                statusBarController?.updateStatusItemDisplay()

                // Session monitoring starts automatically

                // Start native notification service
                await notificationService.start()
            } else {
                logger.error("HTTP server failed to start")
                if let error = serverManager.lastError {
                    logger.error("Server start error: \(error.localizedDescription)")
                }
            }

            // Set up multi-layer cleanup for cloudflared processes
            setupMultiLayerCleanup()
        }
    }

    private func handleSingleInstanceCheck() {
        // Extra safety check - should never be called during tests
        let processInfo = ProcessInfo.processInfo
        let isRunningInTests = processInfo.environment["XCTestConfigurationFilePath"] != nil ||
            processInfo.environment["XCTestBundlePath"] != nil ||
            processInfo.environment["XCTestSessionIdentifier"] != nil ||
            processInfo.arguments.contains("-XCTest") ||
            NSClassFromString("XCTestCase") != nil

        if isRunningInTests {
            logger.info("Skipping single instance check - running in tests")
            return
        }

        let runningApps = NSRunningApplication
            .runningApplications(withBundleIdentifier: Bundle.main.bundleIdentifier ?? "")

        if runningApps.count > 1 {
            // Send notification to existing instance to show settings
            DistributedNotificationCenter.default().post(name: Self.showSettingsNotification, object: nil)

            // Show alert that another instance is running
            Task { @MainActor in
                let alert = NSAlert()
                alert.messageText = "VibeTunnel is already running"
                alert
                    .informativeText = "Another instance of VibeTunnel is already running. This instance will now quit."
                alert.alertStyle = .informational
                alert.addButton(withTitle: "OK")
                alert.runModal()

                // Terminate this instance
                NSApp.terminate(nil)
            }
            return
        }
    }

    private func registerForDistributedNotifications() {
        DistributedNotificationCenter.default().addObserver(
            self,
            selector: #selector(handleShowSettingsNotification),
            name: Self.showSettingsNotification,
            object: nil
        )
    }

    /// Shows the Settings window when another VibeTunnel instance asks us to.
    @objc
    private func handleShowSettingsNotification(_ notification: Notification) {
        SettingsOpener.openSettings()
    }

    @objc
    private func handleCheckForUpdatesNotification() {
        sparkleUpdaterManager?.checkForUpdates()
    }

    /// Shows the welcome screen
    private func showWelcomeScreen() {
        // Initialize the welcome window controller (singleton will handle the rest)
        _ = WelcomeWindowController.shared
        WelcomeWindowController.shared.show()
    }

    /// Public method to show welcome screen (can be called from settings)
    static func showWelcomeScreen() {
        WelcomeWindowController.shared.show()
    }

    /// Creates a custom dock menu when the user right-clicks on the dock icon.
    ///
    /// IMPORTANT: Due to a known SwiftUI bug with NSApplicationDelegateAdaptor, this method
    /// is NOT called when running the app from Xcode. However, it DOES work correctly when:
    /// - The app is launched manually from Finder
    /// - The app is launched from a built/archived version
    /// - The app is running in production
    ///
    /// This is a debugging limitation only and does not affect end users.
    /// See: https://github.com/feedback-assistant/reports/issues/246
    func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
        let dockMenu = NSMenu()

        // Dashboard menu item
        let dashboardItem = NSMenuItem(
            title: "Open Dashboard",
            action: #selector(openDashboard),
            keyEquivalent: ""
        )
        dashboardItem.target = self
        dockMenu.addItem(dashboardItem)

        // Settings menu item
        let settingsItem = NSMenuItem(
            title: "Settings...",
            action: #selector(openSettings),
            keyEquivalent: ""
        )
        settingsItem.target = self
        dockMenu.addItem(settingsItem)

        return dockMenu
    }

    @objc
    private func openDashboard() {
        if let serverManager = app?.serverManager,
           let url = URL(string: "http://localhost:\(serverManager.port)")
        {
            NSWorkspace.shared.open(url)
        }
    }

    @objc
    private func openSettings() {
        SettingsOpener.openSettings()
    }

    func applicationWillTerminate(_ notification: Notification) {
        logger.info("🚨 applicationWillTerminate called - starting cleanup process")

        let processInfo = ProcessInfo.processInfo
        let isRunningInTests = processInfo.environment["XCTestConfigurationFilePath"] != nil ||
            processInfo.environment["XCTestBundlePath"] != nil ||
            processInfo.environment["XCTestSessionIdentifier"] != nil ||
            processInfo.arguments.contains("-XCTest") ||
            NSClassFromString("XCTestCase") != nil

        // Skip cleanup during tests
        if isRunningInTests {
            logger.info("Running in test mode - skipping termination cleanup")
            return
        }

        // Ultra-fast cleanup for cloudflared - just send signals and exit
        if let cloudflareService = app?.cloudflareService, cloudflareService.isRunning {
            logger.info("🔥 Sending quick termination signal to Cloudflare")
            cloudflareService.sendTerminationSignal()
        }

        // Stop HTTP server with very short timeout
        if let serverManager = app?.serverManager {
            let semaphore = DispatchSemaphore(value: 0)
            Task {
                await serverManager.stop()
                semaphore.signal()
            }
            // Only wait 0.5 seconds max
            _ = semaphore.wait(timeout: .now() + .milliseconds(500))
        }

        // Remove observers (quick operations)
        #if !DEBUG
            if !isRunningInTests {
                DistributedNotificationCenter.default().removeObserver(
                    self,
                    name: Self.showSettingsNotification,
                    object: nil
                )
            }
        #endif

        NotificationCenter.default.removeObserver(
            self,
            name: Notification.Name("checkForUpdates"),
            object: nil
        )

        logger.info("🚨 applicationWillTerminate completed quickly")
    }

    // MARK: - UNUserNotificationCenterDelegate

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        logger.info("Received notification response: \(response.actionIdentifier)")

        // Handle update reminder actions
        if response.notification.request.content.categoryIdentifier == "UPDATE_REMINDER" {
            sparkleUpdaterManager?.userDriverDelegate?.handleNotificationAction(
                response.actionIdentifier,
                userInfo: response.notification.request.content.userInfo
            )
        }

        completionHandler()
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions)
            -> Void
    ) {
        // Show notifications even when app is in foreground
        completionHandler([.banner, .sound])
    }

    /// Set up lightweight cleanup system for cloudflared processes
    private func setupMultiLayerCleanup() {
        logger.info("🛡️ Setting up cloudflared cleanup system")

        // Only set up minimal cleanup - no atexit, no complex watchdog
        // The OS will clean up child processes automatically when parent dies

        logger.info("🛡️ Cleanup system initialized (minimal mode)")
    }
}
