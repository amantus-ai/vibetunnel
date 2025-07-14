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

// MARK: - Screen Capture Control Payloads

struct ScreenCaptureApiRequest: Codable {
    let sessionId: String
    let method: String
    let endpoint: String
    let data: String? // JSON string for dynamic data
}

struct ScreenCaptureWebRTCSignal: Codable {
    let sessionId: String
    let data: String // JSON string for WebRTC data
}

struct ScreenCaptureGetInitialDataRequest: Codable {
    // Empty for now, can be extended
}

struct ScreenCaptureStartCaptureRequest: Codable {
    let sessionId: String?
}

struct ScreenCapturePingResponse: Codable {
    let timestamp: Double
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

// MARK: - Git Control Payloads (placeholder for future use)

struct GitStatusRequest: Codable {
    let repositoryPath: String
}

struct GitStatusResponse: Codable {
    let status: String
    let branch: String?
    let changes: [String]
}