import Foundation

/// Centralized API endpoints for the VibeTunnel server
enum APIEndpoints {
    // MARK: - Session Management

    static let sessions = "/api/sessions"

    static func sessionDetail(id: String) -> String {
        "/api/sessions/\(id)"
    }

    static func sessionInput(id: String) -> String {
        "/api/sessions/\(id)/input"
    }

    static func sessionStream(id: String) -> String {
        "/api/sessions/\(id)/stream"
    }

    static func sessionResize(id: String) -> String {
        "/api/sessions/\(id)/resize"
    }

    // MARK: - Cleanup

    static let cleanupExited = "/api/cleanup-exited"

    // MARK: - WebSocket

    static let buffers = "/buffers"
}
