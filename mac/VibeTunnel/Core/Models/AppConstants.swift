import Foundation

/// Central location for app-wide constants and configuration values.
///
/// Provides a single source of truth for application constants, UserDefaults keys,
/// and default values. This helps maintain consistency across the app and makes
/// configuration changes easier to manage.
enum AppConstants {
    /// Current version of the welcome dialog
    /// Increment this when significant changes require re-showing the welcome flow
    static let currentWelcomeVersion = 4

    /// UserDefaults keys
    enum UserDefaultsKeys {
        static let welcomeVersion = "welcomeVersion"
        static let preventSleepWhenRunning = "preventSleepWhenRunning"
        static let enableScreencapService = "enableScreencapService"
        static let repositoryBasePath = "repositoryBasePath"
        // New Session keys
        static let newSessionCommand = "NewSession.command"
        static let newSessionWorkingDirectory = "NewSession.workingDirectory"
        static let newSessionSpawnWindow = "NewSession.spawnWindow"
        static let newSessionTitleMode = "NewSession.titleMode"
    }

    /// Default values for UserDefaults
    enum Defaults {
        /// Sleep prevention is enabled by default for better user experience
        static let preventSleepWhenRunning = true
        /// Screencap service is enabled by default for screen sharing
        static let enableScreencapService = true
        /// Default repository base path for auto-discovery
        static let repositoryBasePath = "~/"
    }

    /// Helper to get boolean value with proper default
    static func boolValue(for key: String) -> Bool {
        // If the key doesn't exist in UserDefaults, return our default
        if UserDefaults.standard.object(forKey: key) == nil {
            switch key {
            case UserDefaultsKeys.preventSleepWhenRunning:
                return Defaults.preventSleepWhenRunning
            case UserDefaultsKeys.enableScreencapService:
                return Defaults.enableScreencapService
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
            case UserDefaultsKeys.repositoryBasePath:
                return Defaults.repositoryBasePath
            default:
                return ""
            }
        }
        
        // Key exists but contains non-string value, return empty string
        return ""
    }
}
