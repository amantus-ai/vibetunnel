import Foundation

// MARK: - Terminal Control Payloads

/// Request payload for spawning a new terminal window
struct TerminalSpawnRequest: Codable {
    let sessionId: String
    let workingDirectory: String?
    let command: String?
    let terminalPreference: String?
}

/// Response payload for terminal spawn operations
struct TerminalSpawnResponse: Codable {
    let success: Bool
    let pid: Int?
    let error: String?

    init(success: Bool, pid: Int? = nil, error: String? = nil) {
        self.success = success
        self.pid = pid
        self.error = error
    }
}

// MARK: - System Control Payloads

/// Event payload indicating the system is ready
struct SystemReadyEvent: Codable {
    let timestamp: Double
    let version: String?

    init(timestamp: Double = Date().timeIntervalSince1970, version: String? = nil) {
        self.timestamp = timestamp
        self.version = version
    }
}

/// Request payload for system health check ping
struct SystemPingRequest: Codable {
    let timestamp: Double

    init(timestamp: Double = Date().timeIntervalSince1970) {
        self.timestamp = timestamp
    }
}

/// Response payload for system health check ping
struct SystemPingResponse: Codable {
    let status: String
    let timestamp: Double

    init(status: String = "ok", timestamp: Double = Date().timeIntervalSince1970) {
        self.status = status
        self.timestamp = timestamp
    }
}

// MARK: - Git Control Payloads (placeholder for future use)

/// Request payload for Git repository status
struct GitStatusRequest: Codable {
    let repositoryPath: String
}

/// Response payload containing Git repository status information
struct GitStatusResponse: Codable {
    let status: String
    let branch: String?
    let changes: [String]
}
