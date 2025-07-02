import Foundation

/// Utility for building VibeTunnel dashboard URLs
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
