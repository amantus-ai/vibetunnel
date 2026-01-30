import Foundation

/// Utility for building VibeTunnel dashboard URLs.
///
/// Provides a centralized location for constructing URLs to access the VibeTunnel
/// web dashboard, with support for direct session linking.
@MainActor
enum DashboardURLBuilder {
    /// Builds the base dashboard URL
    /// - Parameters:
    ///   - port: The server port
    ///   - sessionId: The session ID to open
    /// - Returns: The base dashboard URL
    static func dashboardURL(port: String, sessionId: String? = nil) -> URL? {
        let serverManager = ServerManager.shared
        if let sessionId {
            // Use path-based URL format: /session/sessionId
            return serverManager.buildURL(endpoint: "/session/\(sessionId)")
        } else {
            return serverManager.buildURL(endpoint: "/")
        }
    }
}
