import Foundation

/// Development server configuration
struct DevServerConfig {
    let useDevServer: Bool
    let devServerPath: String
    
    static func current() -> Self {
        Self(
            useDevServer: AppConstants.boolValue(for: AppConstants.UserDefaultsKeys.useDevServer),
            devServerPath: AppConstants.stringValue(for: AppConstants.UserDefaultsKeys.devServerPath)
        )
    }
}