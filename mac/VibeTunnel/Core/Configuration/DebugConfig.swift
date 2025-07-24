import Foundation

/// Debug configuration.
///
/// This struct manages debug and logging settings for VibeTunnel,
/// controlling diagnostic output and development features.
struct DebugConfig {
    /// Whether debug mode is enabled.
    ///
    /// When `true`, additional debugging features are enabled such as:
    /// - More verbose logging output
    /// - Development-only UI elements
    /// - Diagnostic information in the interface
    /// - Relaxed security restrictions for testing
    let debugMode: Bool

    /// The current logging level.
    ///
    /// Controls the verbosity of log output. Common values include:
    /// - `"error"`: Only log errors
    /// - `"warning"`: Log warnings and errors
    /// - `"info"`: Log informational messages, warnings, and errors
    /// - `"debug"`: Log all messages including debug information
    /// - `"verbose"`: Maximum verbosity for detailed troubleshooting
    let logLevel: String

    /// Creates a debug configuration from current user defaults.
    ///
    /// This factory method reads the current debug settings from user defaults
    /// to create a configuration instance that reflects the user's preferences.
    ///
    /// - Returns: A `DebugConfig` instance with current debug settings.
    static func current() -> Self {
        Self(
            debugMode: AppConstants.boolValue(for: AppConstants.UserDefaultsKeys.debugMode),
            logLevel: AppConstants.stringValue(for: AppConstants.UserDefaultsKeys.logLevel)
        )
    }
}
