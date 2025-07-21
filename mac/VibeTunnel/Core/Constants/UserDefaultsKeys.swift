import Foundation

/// Centralized UserDefaults keys
enum UserDefaultsKeys {
    // MARK: - Server Settings

    static let serverPort = "serverPort"
    static let dashboardAccessMode = "dashboardAccessMode"
    static let cleanupOnStartup = "cleanupOnStartup"
    static let preventSleepWhenRunning = "preventSleepWhenRunning"
    static let useDevelopmentServer = "useDevelopmentServer"

    // MARK: - App Preferences

    static let debugMode = "debugMode"
    static let showDockIcon = "showDockIcon"
    static let launchAtLogin = "launchAtLogin"
    static let preferredTerminal = "preferredTerminal"
    static let preferredGitApp = "preferredGitApp"

    // MARK: - UI Preferences

    static let showIconInDock = "showIconInDock"
    static let hideOnStartup = "hideOnStartup"
    static let menuBarIconStyle = "menuBarIconStyle"

    // MARK: - First Run

    static let hasShownWelcome = "hasShownWelcome"
    static let hasCompletedOnboarding = "hasCompletedOnboarding"

    // MARK: - Update Settings

    static let automaticallyCheckForUpdates = "automaticallyCheckForUpdates"
    static let automaticallyDownloadUpdates = "automaticallyDownloadUpdates"
    static let updateChannelPreference = "updateChannelPreference"

    // MARK: - Path Sync

    static let pathSyncShouldRun = "pathSyncShouldRun"
    static let pathSyncTerminalPath = "pathSyncTerminalPath"
}
