import Foundation

/// Central location for app-wide constants and configuration values.
///
/// Provides a single source of truth for application constants, UserDefaults keys,
/// and default values. This helps maintain consistency across the app and makes
/// configuration changes easier to manage.
enum AppConstants {
    /// Current version of the welcome dialog
    /// Increment this when significant changes require re-showing the welcome flow
    static let currentWelcomeVersion = 5

    /// UserDefaults keys
    enum UserDefaultsKeys {
        static let welcomeVersion = "welcomeVersion"
        static let preventSleepWhenRunning = "preventSleepWhenRunning"

        // Server Configuration
        static let serverPort = "serverPort"
        static let dashboardAccessMode = "dashboardAccessMode"
        static let cleanupOnStartup = "cleanupOnStartup"
        static let authenticationMode = "authenticationMode"

        // Development Settings
        static let debugMode = "debugMode"
        static let useDevServer = "useDevServer"
        static let devServerPath = "devServerPath"
        static let logLevel = "logLevel"

        // Application Preferences
        static let preferredGitApp = "preferredGitApp"
        static let preferredTerminal = "preferredTerminal"
        static let showInDock = "showInDock"
        static let updateChannel = "updateChannel"

        /// Remote Access Settings
        static let tailscaleServeEnabled = "tailscaleServeEnabled"
        static let tailscaleFunnelEnabled = "tailscaleFunnelEnabled"

        // New Session keys
        static let newSessionCommand = "NewSession.command"
        static let newSessionWorkingDirectory = "NewSession.workingDirectory"
        static let newSessionSpawnWindow = "NewSession.spawnWindow"
        static let newSessionTitleMode = "NewSession.titleMode"

        /// Quick Start Commands
        static let quickStartCommands = "quickStartCommands"
    }

    /// Raw string values for DashboardAccessMode
    enum DashboardAccessModeRawValues {
        static let localhost = "localhost"
        static let network = "network"
    }

    /// Default values for UserDefaults
    enum Defaults {
        /// Sleep prevention is enabled by default for better user experience
        static let preventSleepWhenRunning = true

        // Server Configuration
        static let serverPort = 4020
        static let dashboardAccessMode = DashboardAccessModeRawValues.network
        static let cleanupOnStartup = true
        static let authenticationMode = "os"

        // Development Settings
        static let debugMode = false
        static let useDevServer = false
        static let devServerPath = ""
        static let logLevel = "info"

        // Application Preferences
        static let showInDock = false
        static let updateChannel = "stable"

        /// Tailscale Settings
        static let tailscaleServeEnabled: Bool? = nil // Use existing UserDefaults value if set
        static let tailscaleFunnelEnabled = false // Default to OFF for security
    }

    /// Helper to get boolean value with proper default
    static func boolValue(for key: String) -> Bool {
        // If the key doesn't exist in UserDefaults, return our default
        if UserDefaults.standard.object(forKey: key) == nil {
            switch key {
            case UserDefaultsKeys.preventSleepWhenRunning:
                return Defaults.preventSleepWhenRunning
            case UserDefaultsKeys.cleanupOnStartup:
                return Defaults.cleanupOnStartup
            case UserDefaultsKeys.debugMode:
                return Defaults.debugMode
            case UserDefaultsKeys.useDevServer:
                return Defaults.useDevServer
            case UserDefaultsKeys.showInDock:
                return Defaults.showInDock
            case UserDefaultsKeys.tailscaleServeEnabled:
                return Defaults.tailscaleServeEnabled ?? false
            case UserDefaultsKeys.tailscaleFunnelEnabled:
                return Defaults.tailscaleFunnelEnabled
            default:
                return false
            }
        }
        return UserDefaults.standard.bool(forKey: key)
    }

    /// Helper to get string value with proper default
    static func stringValue(for key: String) -> String {
        // First check if we have a string value
        if let value = UserDefaults.standard.string(forKey: key) {
            return value
        }

        // If the key doesn't exist at all, return our default
        if UserDefaults.standard.object(forKey: key) == nil {
            switch key {
            case UserDefaultsKeys.dashboardAccessMode:
                return Defaults.dashboardAccessMode
            case UserDefaultsKeys.authenticationMode:
                return Defaults.authenticationMode
            case UserDefaultsKeys.devServerPath:
                return Defaults.devServerPath
            case UserDefaultsKeys.logLevel:
                return Defaults.logLevel
            case UserDefaultsKeys.updateChannel:
                return Defaults.updateChannel
            default:
                return ""
            }
        }

        // Key exists but contains non-string value, return empty string
        return ""
    }

    /// Helper to get integer value with proper default
    static func intValue(for key: String) -> Int {
        // If the key doesn't exist in UserDefaults, return our default
        if UserDefaults.standard.object(forKey: key) == nil {
            switch key {
            case UserDefaultsKeys.serverPort:
                return Defaults.serverPort
            default:
                return 0
            }
        }
        return UserDefaults.standard.integer(forKey: key)
    }
}

// MARK: - Convenience Methods

extension AppConstants {
    /// Check if the app is in development mode (debug or dev server enabled)
    static func isInDevelopmentMode() -> Bool {
        let debug = DebugConfig.current()
        let devServer = DevServerConfig.current()
        return debug.debugMode || devServer.useDevServer
    }

    /// Get development status for UI display
    static func getDevelopmentStatus() -> (debugMode: Bool, useDevServer: Bool) {
        let debug = DebugConfig.current()
        let devServer = DevServerConfig.current()
        return (debug.debugMode, devServer.useDevServer)
    }

    /// Preference helpers
    static func getPreferredGitApp() -> String? {
        UserDefaults.standard.string(forKey: UserDefaultsKeys.preferredGitApp)
    }

    static func setPreferredGitApp(_ app: String?) {
        if let app {
            UserDefaults.standard.set(app, forKey: UserDefaultsKeys.preferredGitApp)
        } else {
            UserDefaults.standard.removeObject(forKey: UserDefaultsKeys.preferredGitApp)
        }
    }

    static func getPreferredTerminal() -> String? {
        UserDefaults.standard.string(forKey: UserDefaultsKeys.preferredTerminal)
    }

    static func setPreferredTerminal(_ terminal: String?) {
        if let terminal {
            UserDefaults.standard.set(terminal, forKey: UserDefaultsKeys.preferredTerminal)
        } else {
            UserDefaults.standard.removeObject(forKey: UserDefaultsKeys.preferredTerminal)
        }
    }

    /// Get current dashboard access mode
    static func getDashboardAccessMode() -> DashboardAccessMode {
        let rawValue = self.stringValue(for: UserDefaultsKeys.dashboardAccessMode)
        return DashboardAccessMode(rawValue: rawValue) ?? .network
    }

    /// Set dashboard access mode
    static func setDashboardAccessMode(_ mode: DashboardAccessMode) {
        UserDefaults.standard.set(mode.rawValue, forKey: UserDefaultsKeys.dashboardAccessMode)
    }
}
