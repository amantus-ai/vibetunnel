import Foundation

/// Authentication configuration
struct AuthConfig {
    let mode: String

    static func current() -> Self {
        Self(
            mode: AppConstants.stringValue(for: AppConstants.UserDefaultsKeys.authenticationMode)
        )
    }
}
