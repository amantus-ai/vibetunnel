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

struct ScreenCaptureOfferEvent: Codable {
    let data: WebRTCOfferData
}

struct WebRTCOfferData: Codable {
    let type: String
    let sdp: String
}

struct ScreenCaptureIceCandidateEvent: Codable {
    let data: IceCandidateData
}

struct IceCandidateData: Codable {
    let candidate: String
    let sdpMLineIndex: Int32
    let sdpMid: String?
}

struct ScreenCaptureErrorEvent: Codable {
    let data: String
}

struct ScreenCaptureAnswerSignal: Codable {
    let data: WebRTCAnswerData
}

struct WebRTCAnswerData: Codable {
    let type: String
    let sdp: String
}

// For initial data response, we use the flexible encoder (screencapApiResponse)
// which handles [String: Any] payloads directly, so we don't need a typed struct
// struct ScreenCaptureGetInitialDataResponse: Codable {
//     let displays: [[String: Any]]
//     let windows: [[String: Any]]
//     let selectedId: String?
//     let captureType: String?
//
//     init(displays: [[String: Any]] = [], windows: [[String: Any]] = [], selectedId: String? = nil, captureType: String? = nil) {
//         self.displays = displays
//         self.windows = windows
//         self.selectedId = selectedId
//         self.captureType = captureType
//     }
//
//     // Use JSONSerialization for the entire object
//     func toDictionary() -> [String: Any] {
//         var dict: [String: Any] = [
//             "displays": displays,
//             "windows": windows
//         ]
//         if let selectedId = selectedId {
//             dict["selectedId"] = selectedId
//         }
//         if let captureType = captureType {
//             dict["captureType"] = captureType
//         }
//         return dict
//     }
// }

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
