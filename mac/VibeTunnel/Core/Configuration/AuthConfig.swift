import Foundation

/// Authentication configuration.
///
/// This struct manages the authentication settings for VibeTunnel,
/// controlling how users authenticate when accessing terminal sessions.
struct AuthConfig {
    /// The authentication mode currently in use.
    ///
    /// Common values include:
    /// - `"password"`: Traditional password authentication
    /// - `"biometric"`: Touch ID or other biometric authentication
    /// - `"none"`: No authentication required (development/testing only)
    ///
    /// The exact values depend on the authentication providers configured
    /// in the application.
    let mode: String

    /// Creates an authentication configuration from current user defaults.
    ///
    /// This factory method reads the current authentication mode setting
    /// from user defaults to create a configuration instance.
    ///
    /// - Returns: An `AuthConfig` instance with the current authentication mode.
    static func current() -> Self {
        Self(
            mode: AppConstants.stringValue(for: AppConstants.UserDefaultsKeys.authenticationMode)
        )
    }
}
