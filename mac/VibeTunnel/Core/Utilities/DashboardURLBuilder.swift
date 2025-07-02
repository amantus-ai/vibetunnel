import Foundation

/// Utility for building VibeTunnel dashboard URLs.
///
/// Provides a centralized location for constructing URLs to access the VibeTunnel
/// web dashboard, with support for direct session linking.
enum DashboardURLBuilder {
    /// Builds the base dashboard URL
    /// - Parameters:
    ///   - port: The server port\
    ///   - sessionId: The session ID to open
    /// - Returns: The base dashboard URL
    static func dashboardURL(port: String, sessionId: String? = nil) -> URL? {
        let sessionIDQueryParameter = sessionId.map { "/?session=\($0)" } ?? ""
        return URL(string: "http://127.0.0.1:\(port)\(sessionIDQueryParameter)")
    }
}
