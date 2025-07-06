import Foundation

/// Central location for app-wide constants and configuration values.
///
/// Provides a single source of truth for application constants, UserDefaults keys,
/// and default values. This helps maintain consistency across the app and makes
/// configuration changes easier to manage.
enum AppConstants {
    /// Current version of the welcome dialog
    /// Increment this when significant changes require re-showing the welcome flow
    static let currentWelcomeVersion = 3

    /// UserDefaults keys
    enum UserDefaultsKeys {
        static let welcomeVersion = "welcomeVersion"
        static let preventSleepWhenRunning = "preventSleepWhenRunning"
        static let enableScreencapService = "enableScreencapService"
    }

    /// Default values for UserDefaults
    enum Defaults {
        /// Sleep prevention is enabled by default for better user experience
        static let preventSleepWhenRunning = true
        /// Screencap service is enabled by default for screen sharing
        static let enableScreencapService = true
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
}
