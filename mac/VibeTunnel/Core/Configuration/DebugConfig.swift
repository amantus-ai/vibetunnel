import Foundation

/// Debug configuration
struct DebugConfig {
    let debugMode: Bool
    let logLevel: String
    
    static func current() -> Self {
        Self(
            debugMode: AppConstants.boolValue(for: AppConstants.UserDefaultsKeys.debugMode),
            logLevel: AppConstants.stringValue(for: AppConstants.UserDefaultsKeys.logLevel)
        )
    }
}