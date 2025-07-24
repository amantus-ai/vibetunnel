import Foundation

/// Server configuration
struct ServerConfig {
    let port: Int
    let dashboardAccessMode: String
    let cleanupOnStartup: Bool
    
    static func current() -> Self {
        Self(
            port: AppConstants.intValue(for: AppConstants.UserDefaultsKeys.serverPort),
            dashboardAccessMode: AppConstants.stringValue(for: AppConstants.UserDefaultsKeys.dashboardAccessMode),
            cleanupOnStartup: AppConstants.boolValue(for: AppConstants.UserDefaultsKeys.cleanupOnStartup)
        )
    }
}