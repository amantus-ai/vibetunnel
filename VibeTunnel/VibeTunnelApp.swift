import AppKit
import os.log
import SwiftUI

/// Main entry point for the VibeTunnel macOS application
@main
struct VibeTunnelApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self)
    var appDelegate
    @State private var sessionMonitor = SessionMonitor.shared
    @State private var serverMonitor = ServerMonitor.shared

    init() {
        // No special initialization needed
    }

    var body: some Scene {
        #if os(macOS)
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
            }
            .windowResizability(.contentSize)
            .defaultSize(width: 580, height: 480)
            .windowStyle(.hiddenTitleBar)

            Settings {
                SettingsView()
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

            MenuBarExtra {
                MenuBarView()
                    .environment(sessionMonitor)
                    .environment(serverMonitor)
            } label: {
                Image("menubar")
                    .renderingMode(.template)
            }
        #endif
    }
}

// MARK: - App Delegate

/// Manages app lifecycle, single instance enforcement, and core services
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private(set) var sparkleUpdaterManager: SparkleUpdaterManager?
    private let serverManager = ServerManager.shared
    private let sessionMonitor = SessionMonitor.shared
    private let serverMonitor = ServerMonitor.shared
    private let ngrokService = NgrokService.shared
    private let logger = Logger(subsystem: "com.steipete.VibeTunnel", category: "AppDelegate")

    /// Distributed notification name used to ask an existing instance to show the Settings window.
    private static let showSettingsNotification = Notification.Name("sh.vibetunnel.vibetunnel.showSettings")

    func applicationDidFinishLaunching(_ notification: Notification) {
        let processInfo = ProcessInfo.processInfo
        let isRunningInTests = processInfo.environment["XCTestConfigurationFilePath"] != nil ||
            processInfo.environment["XCTestBundlePath"] != nil ||
            processInfo.environment["XCTestSessionIdentifier"] != nil ||
            processInfo.arguments.contains("-XCTest") ||
            NSClassFromString("XCTestCase") != nil
        let isRunningInPreview = processInfo.environment["XCODE_RUNNING_FOR_PREVIEWS"] == "1"
        let isRunningInDebug = processInfo.environment["DYLD_INSERT_LIBRARIES"]?
            .contains("libMainThreadChecker.dylib") ?? false

        // Handle single instance check before doing anything else
        if !isRunningInPreview, !isRunningInTests, !isRunningInDebug {
            handleSingleInstanceCheck()
            registerForDistributedNotifications()

            // Check if app needs to be moved to Applications folder
            let applicationMover = ApplicationMover()
            applicationMover.checkAndOfferToMoveToApplications()
        }

        // Initialize Sparkle updater manager
        sparkleUpdaterManager = SparkleUpdaterManager.shared

        // Initialize dock icon visibility through DockIconManager
        DockIconManager.shared.updateDockVisibility()

        // Show welcome screen when version changes
        let storedWelcomeVersion = UserDefaults.standard.integer(forKey: AppConstants.UserDefaultsKeys.welcomeVersion)

        // Show welcome if version is different from current
        if storedWelcomeVersion < AppConstants.currentWelcomeVersion && !isRunningInTests && !isRunningInPreview {
            showWelcomeScreen()
        }

        // Skip all service initialization during tests
        if isRunningInTests {
            logger.info("Running in test mode - skipping service initialization")
            return
        }

        // Verify preferred terminal is still available
        TerminalLauncher.shared.verifyPreferredTerminal()

        // Listen for update check requests
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleCheckForUpdatesNotification),
            name: Notification.Name("checkForUpdates"),
            object: nil
        )

        // Start the terminal spawn service
        TerminalSpawnService.shared.start()

        // Initialize and start HTTP server using ServerManager
        Task {
            do {
                logger.info("Attempting to start HTTP server using ServerManager...")
                await serverManager.start()

                logger.info("HTTP server started successfully on port \(self.serverManager.port)")
                logger.info("Server is running: \(self.serverManager.isRunning)")
                logger.info("Server mode: \(self.serverManager.serverMode.displayName)")

                // Start monitoring sessions after server starts
                sessionMonitor.startMonitoring()

                // Test the server after a short delay
                try await Task.sleep(for: .milliseconds(500))
                if let url = URL(string: "http://127.0.0.1:\(serverManager.port)/api/health") {
                    let (_, response) = try await URLSession.shared.data(from: url)
                    if let httpResponse = response as? HTTPURLResponse {
                        logger.info("Server health check response: \(httpResponse.statusCode)")
                    }
                }
            } catch {
                logger.error("Failed to start HTTP server: \(error)")
                logger.error("Error type: \(type(of: error))")
                logger.error("Error description: \(error.localizedDescription)")
                if let nsError = error as NSError? {
                    logger.error("NSError domain: \(nsError.domain)")
                    logger.error("NSError code: \(nsError.code)")
                    logger.error("NSError userInfo: \(nsError.userInfo)")
                }
            }
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

    func applicationWillTerminate(_ notification: Notification) {
        let processInfo = ProcessInfo.processInfo
        let isRunningInTests = processInfo.environment["XCTestConfigurationFilePath"] != nil ||
            processInfo.environment["XCTestBundlePath"] != nil ||
            processInfo.environment["XCTestSessionIdentifier"] != nil ||
            processInfo.arguments.contains("-XCTest") ||
            NSClassFromString("XCTestCase") != nil
        let isRunningInPreview = processInfo.environment["XCODE_RUNNING_FOR_PREVIEWS"] == "1"
        let isRunningInDebug = processInfo.environment["DYLD_INSERT_LIBRARIES"]?
            .contains("libMainThreadChecker.dylib") ?? false

        // Skip cleanup during tests
        if isRunningInTests {
            logger.info("Running in test mode - skipping termination cleanup")
            return
        }

        // Stop session monitoring
        sessionMonitor.stopMonitoring()

        // Stop terminal spawn service
        TerminalSpawnService.shared.stop()

        // Stop HTTP server
        Task {
            await serverManager.stop()
        }

        // Remove distributed notification observer
        if !isRunningInPreview, !isRunningInTests, !isRunningInDebug {
            DistributedNotificationCenter.default().removeObserver(
                self,
                name: Self.showSettingsNotification,
                object: nil
            )
        }

        // Remove update check notification observer
        NotificationCenter.default.removeObserver(
            self,
            name: Notification.Name("checkForUpdates"),
            object: nil
        )
    }
}
