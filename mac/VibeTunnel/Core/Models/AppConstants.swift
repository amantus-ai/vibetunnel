import Foundation

/// Central location for app-wide constants and configuration values
enum AppConstants {
    /// Current version of the welcome dialog
    /// Increment this when significant changes require re-showing the welcome flow
    static let currentWelcomeVersion = 3

    /// UserDefaults keys
    enum UserDefaultsKeys {
        static let welcomeVersion = "welcomeVersion"
        static let preventSleepWhenRunning = "preventSleepWhenRunning"
    }
}
