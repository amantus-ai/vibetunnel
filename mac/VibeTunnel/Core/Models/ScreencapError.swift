import Foundation

/// Standardized error types for screen capture functionality
/// Matches the TypeScript ScreencapErrorCode enum for cross-layer consistency
enum ScreencapErrorCode: String, Codable {
    // Connection errors
    case connectionFailed = "CONNECTION_FAILED"
    case connectionTimeout = "CONNECTION_TIMEOUT"
    case websocketClosed = "WEBSOCKET_CLOSED"
    case unixSocketError = "UNIX_SOCKET_ERROR"

    // Permission errors
    case permissionDenied = "PERMISSION_DENIED"
    case permissionRevoked = "PERMISSION_REVOKED"

    // Display/Window errors
    case displayNotFound = "DISPLAY_NOT_FOUND"
    case displayDisconnected = "DISPLAY_DISCONNECTED"
    case windowNotFound = "WINDOW_NOT_FOUND"
    case windowClosed = "WINDOW_CLOSED"

    // Capture errors
    case captureFailed = "CAPTURE_FAILED"
    case captureNotActive = "CAPTURE_NOT_ACTIVE"
    case invalidCaptureType = "INVALID_CAPTURE_TYPE"

    // WebRTC errors
    case webrtcInitFailed = "WEBRTC_INIT_FAILED"
    case webrtcOfferFailed = "WEBRTC_OFFER_FAILED"
    case webrtcAnswerFailed = "WEBRTC_ANSWER_FAILED"
    case webrtcIceFailed = "WEBRTC_ICE_FAILED"

    // Session errors
    case invalidSession = "INVALID_SESSION"
    case sessionExpired = "SESSION_EXPIRED"

    // General errors
    case invalidRequest = "INVALID_REQUEST"
    case internalError = "INTERNAL_ERROR"
    case notImplemented = "NOT_IMPLEMENTED"
}

/// Standardized error structure for screen capture API responses
struct ScreencapErrorResponse: Codable, LocalizedError {
    let code: ScreencapErrorCode
    let message: String
    let details: AnyCodable?
    let timestamp: String

    init(code: ScreencapErrorCode, message: String, details: Any? = nil) {
        self.code = code
        self.message = message
        self.details = details.map(AnyCodable.init)
        self.timestamp = ISO8601DateFormatter().string(from: Date())
    }

    var errorDescription: String? {
        message
    }

    /// Convert to dictionary for JSON serialization
    func toDictionary() -> [String: Any] {
        var dict: [String: Any] = [
            "code": code.rawValue,
            "message": message,
            "timestamp": timestamp
        ]
        if let details {
            dict["details"] = details.value
        }
        return dict
    }

    /// Create from an existing error
    static func from(_ error: Error) -> Self {
        if let screencapError = error as? Self {
            return screencapError
        }

        // Map known errors
        switch error {
        case ScreencapService.ScreencapError.webSocketNotConnected:
            return Self(
                code: .websocketClosed,
                message: error.localizedDescription
            )
        case ScreencapService.ScreencapError.windowNotFound(let id):
            return Self(
                code: .windowNotFound,
                message: error.localizedDescription,
                details: ["windowId": id]
            )
        case ScreencapService.ScreencapError.noDisplay:
            return Self(
                code: .displayNotFound,
                message: error.localizedDescription
            )
        case ScreencapService.ScreencapError.notCapturing:
            return Self(
                code: .captureNotActive,
                message: error.localizedDescription
            )
        case ScreencapService.ScreencapError.serviceNotReady:
            return Self(
                code: .connectionFailed,
                message: error.localizedDescription
            )
        case ScreencapService.ScreencapError.permissionDenied:
            return Self(
                code: .permissionDenied,
                message: error.localizedDescription
            )
        case WebRTCError.failedToCreatePeerConnection:
            return Self(
                code: .webrtcInitFailed,
                message: error.localizedDescription
            )
        case UnixSocketError.notConnected:
            return Self(
                code: .unixSocketError,
                message: error.localizedDescription
            )
        default:
            return Self(
                code: .internalError,
                message: error.localizedDescription,
                details: String(describing: error)
            )
        }
    }
}

/// Type-erased Codable wrapper for arbitrary values
struct AnyCodable: Codable, @unchecked Sendable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let array = try? container.decode([Self].self) {
            value = array.map(\.value)
        } else if let dict = try? container.decode([String: Self].self) {
            value = dict.mapValues { $0.value }
        } else {
            value = NSNull()
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case let bool as Bool:
            try container.encode(bool)
        case let int as Int:
            try container.encode(int)
        case let double as Double:
            try container.encode(double)
        case let string as String:
            try container.encode(string)
        case let array as [Any]:
            try container.encode(array.map(Self.init))
        case let dict as [String: Any]:
            try container.encode(dict.mapValues(Self.init))
        default:
            try container.encodeNil()
        }
    }
}
