//  Server event model for notification handling
//

import Foundation

/// Types of server events that can be received
enum ServerEventType: String, Codable, CaseIterable {
    case sessionStart = "session-start"
    case sessionExit = "session-exit"
    case commandFinished = "command-finished"
    case commandError = "command-error"
    case bell = "bell"
    case claudeTurn = "claude-turn"
    case connected = "connected"
    
    /// Human-readable description of the event type
    var description: String {
        switch self {
        case .sessionStart:
            return "Session Started"
        case .sessionExit:
            return "Session Ended"
        case .commandFinished:
            return "Command Completed"
        case .commandError:
            return "Command Error"
        case .bell:
            return "Terminal Bell"
        case .claudeTurn:
            return "Your Turn"
        case .connected:
            return "Connected"
        }
    }
    
    /// Whether this event type should trigger a notification
    var shouldNotify: Bool {
        switch self {
        case .sessionStart, .sessionExit, .claudeTurn:
            return true
        case .commandFinished, .commandError, .bell, .connected:
            return false
        }
    }
}

/// Represents a server event received via Server-Sent Events (SSE)
struct ServerEvent: Codable, Identifiable, Equatable {
    let id = UUID()
    let type: ServerEventType
    let sessionId: String?
    let sessionName: String?
    let command: String?
    let exitCode: Int?
    let duration: Int?
    let processInfo: String?
    let message: String?
    let timestamp: Date
    
    // Regular initializer for creating events manually
    init(
        type: ServerEventType,
        sessionId: String? = nil,
        sessionName: String? = nil,
        command: String? = nil,
        exitCode: Int? = nil,
        duration: Int? = nil,
        processInfo: String? = nil,
        message: String? = nil,
        timestamp: Date = Date()
    ) {
        self.type = type
        self.sessionId = sessionId
        self.sessionName = sessionName
        self.command = command
        self.exitCode = exitCode
        self.duration = duration
        self.processInfo = processInfo
        self.message = message
        self.timestamp = timestamp
    }
    
    // MARK: - Convenience Initializers
    
    /// Create a session start event
    static func sessionStart(sessionId: String, sessionName: String? = nil, command: String? = nil) -> ServerEvent {
        ServerEvent(
            type: .sessionStart,
            sessionId: sessionId,
            sessionName: sessionName,
            command: command
        )
    }
    
    /// Create a session exit event
    static func sessionExit(sessionId: String, sessionName: String? = nil, exitCode: Int? = nil) -> ServerEvent {
        ServerEvent(
            type: .sessionExit,
            sessionId: sessionId,
            sessionName: sessionName,
            exitCode: exitCode
        )
    }
    
    /// Create a command finished event
    static func commandFinished(sessionId: String, command: String, duration: Int, exitCode: Int? = nil) -> ServerEvent {
        ServerEvent(
            type: .commandFinished,
            sessionId: sessionId,
            command: command,
            exitCode: exitCode,
            duration: duration
        )
    }
    
    /// Create a Claude turn event
    static func claudeTurn(sessionId: String, sessionName: String? = nil) -> ServerEvent {
        ServerEvent(
            type: .claudeTurn,
            sessionId: sessionId,
            sessionName: sessionName,
            message: "Claude has finished responding"
        )
    }
    
    /// Create a bell event
    static func bell(sessionId: String) -> ServerEvent {
        ServerEvent(
            type: .bell,
            sessionId: sessionId,
            message: "Terminal bell"
        )
    }
    
    // MARK: - Computed Properties
    
    /// Display name for the event (session name or command)
    var displayName: String {
        sessionName ?? command ?? sessionId ?? "Unknown Session"
    }
    
    /// Whether this event should trigger a notification
    var shouldNotify: Bool {
        type.shouldNotify
    }
    
    /// Formatted duration string (if available)
    var formattedDuration: String? {
        guard let duration = duration else { return nil }
        
        if duration < 1000 {
            return "\(duration)ms"
        } else if duration < 60000 {
            return String(format: "%.1fs", Double(duration) / 1000.0)
        } else {
            let minutes = duration / 60000
            let seconds = (duration % 60000) / 1000
            return "\(minutes)m \(seconds)s"
        }
    }
    
    /// Formatted timestamp
    var formattedTimestamp: String {
        let formatter = DateFormatter()
        formatter.timeStyle = .medium
        return formatter.string(from: timestamp)
    }
} 
