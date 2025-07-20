import Foundation

// MARK: - Terminal Control Payloads

struct TerminalSpawnRequest: Codable {
    let sessionId: String
    let workingDirectory: String?
    let command: String?
    let terminalPreference: String?
}

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

struct SystemReadyEvent: Codable {
    let timestamp: Double
    let version: String?

    init(timestamp: Double = Date().timeIntervalSince1970, version: String? = nil) {
        self.timestamp = timestamp
        self.version = version
    }
}

struct SystemPingRequest: Codable {
    let timestamp: Double

    init(timestamp: Double = Date().timeIntervalSince1970) {
        self.timestamp = timestamp
    }
}

struct SystemPingResponse: Codable {
    let status: String
    let timestamp: Double

    init(status: String = "ok", timestamp: Double = Date().timeIntervalSince1970) {
        self.status = status
        self.timestamp = timestamp
    }
}

struct RepositoryPathUpdateRequest: Codable {
    let path: String
}

struct RepositoryPathUpdateResponse: Codable {
    let success: Bool
    let path: String?
    let error: String?

    init(success: Bool, path: String? = nil, error: String? = nil) {
        self.success = success
        self.path = path
        self.error = error
    }
}

// MARK: - Git Control Payloads (placeholder for future use)

struct GitStatusRequest: Codable {
    let repositoryPath: String
}

struct GitStatusResponse: Codable {
    let status: String
    let branch: String?
    let changes: [String]
}
