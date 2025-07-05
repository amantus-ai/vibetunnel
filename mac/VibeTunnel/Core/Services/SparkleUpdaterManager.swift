import Foundation
import Observation
import os.log
import Sparkle
import UserNotifications

/// SparkleUpdaterManager with automatic update downloads enabled.
///
/// Manages application updates using the Sparkle framework. Handles automatic
/// update checking, downloading, and installation while respecting user preferences
/// and update channels. Integrates with macOS notifications for update announcements.
@MainActor
public final class SparkleUpdaterManager: NSObject, SPUUpdaterDelegate {
    public static let shared = SparkleUpdaterManager()

    fileprivate var updaterController: SPUStandardUpdaterController?
    private(set) var userDriverDelegate: SparkleUserDriverDelegate?
    private let logger = os.Logger(
        subsystem: "sh.vibetunnel.vibetunnel",
        category: "SparkleUpdater"
    )

    private nonisolated static let staticLogger = os.Logger(
        subsystem: "sh.vibetunnel.vibetunnel",
        category: "SparkleUpdater"
    )

    override public init() {
        super.init()

        // Skip initialization during tests
        let isRunningInTests = ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil ||
            ProcessInfo.processInfo.environment["XCTestBundlePath"] != nil ||
            ProcessInfo.processInfo.environment["XCTestSessionIdentifier"] != nil ||
            ProcessInfo.processInfo.arguments.contains("-XCTest") ||
            NSClassFromString("XCTestCase") != nil

        if isRunningInTests {
            logger.info("Running in test mode, skipping Sparkle initialization")
            return
        }

        // Check if installed from App Store
        if ProcessInfo.processInfo.installedFromAppStore {
            logger.info("App installed from App Store, skipping Sparkle initialization")
            return
        }

        // Create user driver delegate for gentle reminders
        userDriverDelegate = SparkleUserDriverDelegate()

        // Initialize Sparkle with standard configuration
        #if DEBUG
            // In debug mode, start the updater for testing
            updaterController = SPUStandardUpdaterController(
                startingUpdater: true,
                updaterDelegate: self,
                userDriverDelegate: userDriverDelegate
            )
        #else
            updaterController = SPUStandardUpdaterController(
                startingUpdater: true,
                updaterDelegate: self,
                userDriverDelegate: userDriverDelegate
            )
        #endif

        // Configure automatic updates
        if let updater = updaterController?.updater {
            #if DEBUG
                // Enable automatic checks in debug too
                updater.automaticallyChecksForUpdates = true
                updater.automaticallyDownloadsUpdates = false
                logger.info("Sparkle updater initialized in DEBUG mode - automatic updates enabled for testing")
            #else
                // Enable automatic checking for updates
                updater.automaticallyChecksForUpdates = true

                // Enable automatic downloading of updates
                updater.automaticallyDownloadsUpdates = true

                // Set update check interval to 24 hours
                updater.updateCheckInterval = 86_400

                logger.info("Sparkle updater initialized successfully with automatic downloads enabled")
            #endif

            // Start the updater for both debug and release builds
            if let controller = updaterController {
                do {
                    try controller.updater.start()
                } catch {
                    logger.error("Failed to start Sparkle updater: \(error)")
                }
            }

            // Note: feedURL configuration happens through delegate methods
        }
    }

    public func setUpdateChannel(_ channel: UpdateChannel) {
        // Save the channel preference
        UserDefaults.standard.set(channel.rawValue, forKey: "updateChannel")
        logger.info("Update channel set to: \(channel.rawValue)")

        // The actual feed URL will be provided by the delegate method
    }

    public func checkForUpdatesInBackground() {
        guard let updater = updaterController?.updater else { return }
        updater.checkForUpdatesInBackground()
        logger.info("Background update check initiated")
    }

    public func checkForUpdates() {
        guard updaterController != nil else {
            logger.warning("Cannot check for updates: updater not initialized")
            return
        }
        updaterController?.checkForUpdates(nil)
        logger.info("Manual update check initiated")
    }

    public func clearUserDefaults() {
        let sparkleDefaults = [
            "SUEnableAutomaticChecks",
            "SUHasLaunchedBefore",
            "SULastCheckTime",
            "SUSendProfileInfo",
            "SUUpdateRelaunchingMarker",
            "SUAutomaticallyUpdate",
            "SULastProfileSubmissionDate"
        ]

        for key in sparkleDefaults {
            UserDefaults.standard.removeObject(forKey: key)
        }

        logger.info("Sparkle user defaults cleared")
    }
}

// MARK: - SPUUpdaterDelegate

extension SparkleUpdaterManager {
    public nonisolated func updater(_ updater: SPUUpdater, mayPerformUpdateCheck updateCheck: SPUUpdateCheck) throws {
        // Allow update checks by default - not throwing an error means the check is allowed
        // We could add logic here to prevent checks during certain conditions
    }

    public nonisolated func allowedChannels(for updater: SPUUpdater) -> Set<String> {
        // Get the current update channel from UserDefaults
        if let savedChannel = UserDefaults.standard.string(forKey: "updateChannel"),
           let channel = UpdateChannel(rawValue: savedChannel)
        {
            return channel.includesPreReleases ? Set(["", "prerelease"]) : Set([""])
        }
        return Set([""]) // Default to stable channel only
    }

    public nonisolated func feedURLString(for updater: SPUUpdater) -> String? {
        // Provide the appropriate feed URL based on the current update channel
        if let savedChannel = UserDefaults.standard.string(forKey: "updateChannel"),
           let channel = UpdateChannel(rawValue: savedChannel)
        {
            return channel.appcastURL.absoluteString
        }
        return UpdateChannel.defaultChannel.appcastURL.absoluteString
    }
}

// MARK: - SparkleViewModel

@MainActor
@Observable
public final class SparkleViewModel {
    public var canCheckForUpdates = false
    public var isCheckingForUpdates = false
    public var automaticallyChecksForUpdates = true
    public var automaticallyDownloadsUpdates = true
    public var updateCheckInterval: TimeInterval = 86_400
    public var lastUpdateCheckDate: Date?
    public var updateChannel: UpdateChannel = .stable

    private let updaterManager = SparkleUpdaterManager.shared

    public init() {
        // Sync with actual Sparkle settings
        if let updater = updaterManager.updaterController?.updater {
            automaticallyChecksForUpdates = updater.automaticallyChecksForUpdates
            automaticallyDownloadsUpdates = updater.automaticallyDownloadsUpdates
            updateCheckInterval = updater.updateCheckInterval
            lastUpdateCheckDate = updater.lastUpdateCheckDate
            canCheckForUpdates = updater.canCheckForUpdates
        }

        // Load saved update channel
        if let savedChannel = UserDefaults.standard.string(forKey: "updateChannel"),
           let channel = UpdateChannel(rawValue: savedChannel)
        {
            updateChannel = channel
        } else {
            updateChannel = UpdateChannel.stable
        }
    }

    public func checkForUpdates() {
        updaterManager.checkForUpdates()
    }

    public func setUpdateChannel(_ channel: UpdateChannel) {
        updateChannel = channel
        updaterManager.setUpdateChannel(channel)
    }
}

// MARK: - ProcessInfo Extension

extension ProcessInfo {
    fileprivate var installedFromAppStore: Bool {
        // Check for App Store receipt
        let receiptURL = Bundle.main.appStoreReceiptURL
        if let receiptURL {
            return receiptURL.lastPathComponent == "receipt" && FileManager.default.fileExists(atPath: receiptURL.path)
        }
        return false
    }
}
