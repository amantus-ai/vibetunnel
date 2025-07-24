import Foundation

/// Server configuration.
///
/// This struct manages the configuration for the VibeTunnel web server,
/// including network settings and startup behavior.
struct ServerConfig {
    /// The port number the server listens on.
    ///
    /// Default is typically 4020 for production or 4021 for development.
    /// Users can customize this to avoid port conflicts with other services.
    let port: Int

    /// The dashboard access mode.
    ///
    /// Controls who can access the VibeTunnel web dashboard:
    /// - `"local"`: Only accessible from localhost
    /// - `"network"`: Accessible from any device on the local network
    /// - `"tunnel"`: Accessible through ngrok tunnel (requires authentication)
    let dashboardAccessMode: String

    /// Whether to clean up stale sessions on startup.
    ///
    /// When `true`, the server will remove any orphaned or inactive
    /// terminal sessions when it starts. This helps prevent resource
    /// leaks but may terminate sessions that were intended to persist.
    let cleanupOnStartup: Bool

    /// Creates a server configuration from current user defaults.
    ///
    /// This factory method reads the current server settings from user defaults
    /// to create a configuration instance that reflects the user's preferences.
    ///
    /// - Returns: A `ServerConfig` instance with current server settings.
    static func current() -> Self {
        Self(
            port: AppConstants.intValue(for: AppConstants.UserDefaultsKeys.serverPort),
            dashboardAccessMode: AppConstants.stringValue(for: AppConstants.UserDefaultsKeys.dashboardAccessMode),
            cleanupOnStartup: AppConstants.boolValue(for: AppConstants.UserDefaultsKeys.cleanupOnStartup)
        )
    }
}
