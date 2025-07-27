//  Server event model for notification handling
//

import Foundation

/// Types of server events that can be received from the VibeTunnel server.
///
/// `ServerEventType` defines all possible event types that flow through the Server-Sent Events (SSE)
/// connection between the VibeTunnel server and the macOS app. Each event type corresponds to
/// a specific terminal session lifecycle event or user interaction.
///
/// ## Topics
///
/// ### Event Categories
///
/// - ``sessionStart``: Terminal session creation events
/// - ``sessionExit``: Terminal session termination events
/// - ``commandFinished``: Command completion events
/// - ``commandError``: Command failure events
/// - ``bell``: Terminal bell notifications
/// - ``claudeTurn``: AI assistant interaction events
/// - ``connected``: Connection establishment events
///
/// ### Event Properties
///
/// - ``description``: Human-readable event descriptions
/// - ``shouldNotify``: Notification eligibility
enum ServerEventType: String, Codable, CaseIterable {
    /// Indicates a new terminal session has been started.
    case sessionStart = "session-start"
    
    /// Indicates a terminal session has ended.
    case sessionExit = "session-exit"
    
    /// Indicates a command has finished executing successfully.
    case commandFinished = "command-finished"
    
    /// Indicates a command has failed with an error.
    case commandError = "command-error"
    
    /// Indicates a terminal bell character was received.
    case bell = "bell"
    
    /// Indicates Claude (AI assistant) has finished responding and it's the user's turn.
    case claudeTurn = "claude-turn"
    
    /// Indicates the SSE connection has been established.
    case connected = "connected"
    
    /// Returns a human-readable description of the event type.
    ///
    /// This property provides user-friendly labels suitable for display in
    /// notifications and UI elements.
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
    
    /// Determines whether this event type should trigger a user notification.
    ///
    /// This property helps filter which events should result in system notifications.
    /// Currently, session lifecycle events and Claude turn events are eligible for
    /// notifications, while command completion and system events are not.
    ///
    /// - Returns: `true` if the event should trigger a notification, `false` otherwise.
    var shouldNotify: Bool {
        switch self {
        case .sessionStart, .sessionExit, .claudeTurn:
            return true
        case .commandFinished, .commandError, .bell, .connected:
            return false
        }
    }
}

/// Represents a server event received via Server-Sent Events (SSE).
///
/// `ServerEvent` encapsulates all the information about terminal session events that flow
/// from the VibeTunnel server to the macOS app. Each event carries contextual information
/// about what happened, when it happened, and which session it relates to.
///
/// ## Overview
///
/// Server events are the primary communication mechanism for real-time updates about
/// terminal sessions. They enable the macOS app to:
/// - Track session lifecycle (creation, termination)
/// - Monitor command execution and completion
/// - Detect AI assistant interactions
/// - Handle system notifications like terminal bells
///
/// ## Topics
///
/// ### Creating Events
///
/// - ``init(type:sessionId:sessionName:command:exitCode:duration:processInfo:message:timestamp:)``
/// - ``sessionStart(sessionId:sessionName:command:)``
/// - ``sessionExit(sessionId:sessionName:exitCode:)``
/// - ``commandFinished(sessionId:command:duration:exitCode:)``
/// - ``claudeTurn(sessionId:sessionName:)``
/// - ``bell(sessionId:)``
///
/// ### Event Properties
///
/// - ``type``: The type of event
/// - ``sessionId``: Associated session identifier
/// - ``sessionName``: Human-readable session name
/// - ``command``: Command that was executed
/// - ``exitCode``: Process exit code
/// - ``duration``: Execution duration in milliseconds
/// - ``processInfo``: Additional process information
/// - ``message``: Event message
/// - ``timestamp``: When the event occurred
///
/// ### Computed Properties
///
/// - ``displayName``: User-friendly name for display
/// - ``shouldNotify``: Whether to show a notification
/// - ``formattedDuration``: Human-readable duration
/// - ``formattedTimestamp``: Formatted timestamp
struct ServerEvent: Codable, Identifiable, Equatable {
    /// Unique identifier for the event instance.
    let id = UUID()
    
    /// The type of server event.
    let type: ServerEventType
    
    /// The terminal session identifier this event relates to.
    let sessionId: String?
    
    /// Human-readable name of the session.
    let sessionName: String?
    
    /// The command that was executed (for command-related events).
    let command: String?
    
    /// The process exit code (for exit and error events).
    let exitCode: Int?
    
    /// Duration in milliseconds (for command completion events).
    let duration: Int?
    
    /// Additional process information.
    let processInfo: String?
    
    /// Optional message providing additional context.
    let message: String?
    
    /// When the event occurred.
    let timestamp: Date
    
    /// Creates a new server event with the specified properties.
    ///
    /// - Parameters:
    ///   - type: The type of event.
    ///   - sessionId: Optional session identifier.
    ///   - sessionName: Optional human-readable session name.
    ///   - command: Optional command that was executed.
    ///   - exitCode: Optional process exit code.
    ///   - duration: Optional duration in milliseconds.
    ///   - processInfo: Optional additional process information.
    ///   - message: Optional contextual message.
    ///   - timestamp: When the event occurred (defaults to current time).
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
    
    /// Creates a session start event.
    ///
    /// Use this convenience method when a new terminal session is created.
    ///
    /// - Parameters:
    ///   - sessionId: The unique identifier for the session.
    ///   - sessionName: Optional human-readable name for the session.
    ///   - command: Optional command that started the session.
    /// - Returns: A configured `ServerEvent` of type ``ServerEventType/sessionStart``.
    static func sessionStart(sessionId: String, sessionName: String? = nil, command: String? = nil) -> ServerEvent {
        ServerEvent(
            type: .sessionStart,
            sessionId: sessionId,
            sessionName: sessionName,
            command: command
        )
    }
    
    /// Creates a session exit event.
    ///
    /// Use this convenience method when a terminal session ends.
    ///
    /// - Parameters:
    ///   - sessionId: The unique identifier for the session.
    ///   - sessionName: Optional human-readable name for the session.
    ///   - exitCode: Optional process exit code.
    /// - Returns: A configured `ServerEvent` of type ``ServerEventType/sessionExit``.
    static func sessionExit(sessionId: String, sessionName: String? = nil, exitCode: Int? = nil) -> ServerEvent {
        ServerEvent(
            type: .sessionExit,
            sessionId: sessionId,
            sessionName: sessionName,
            exitCode: exitCode
        )
    }
    
    /// Creates a command finished event.
    ///
    /// Use this convenience method when a command completes execution.
    ///
    /// - Parameters:
    ///   - sessionId: The unique identifier for the session.
    ///   - command: The command that was executed.
    ///   - duration: Execution time in milliseconds.
    ///   - exitCode: Optional process exit code.
    /// - Returns: A configured `ServerEvent` of type ``ServerEventType/commandFinished``.
    static func commandFinished(sessionId: String, command: String, duration: Int, exitCode: Int? = nil) -> ServerEvent {
        ServerEvent(
            type: .commandFinished,
            sessionId: sessionId,
            command: command,
            exitCode: exitCode,
            duration: duration
        )
    }
    
    /// Creates a command error event.
    ///
    /// Use this convenience method when a command fails with a non-zero exit code.
    ///
    /// - Parameters:
    ///   - sessionId: The unique identifier for the session.
    ///   - command: The command that failed.
    ///   - exitCode: The process exit code.
    ///   - duration: Optional execution time in milliseconds.
    /// - Returns: A configured `ServerEvent` of type ``ServerEventType/commandError``.
    static func commandError(sessionId: String, command: String, exitCode: Int, duration: Int? = nil) -> ServerEvent {
        ServerEvent(
            type: .commandError,
            sessionId: sessionId,
            command: command,
            exitCode: exitCode,
            duration: duration
        )
    }
    
    /// Creates a Claude turn event.
    ///
    /// Use this convenience method when Claude (AI assistant) finishes responding
    /// and it's the user's turn to interact.
    ///
    /// - Parameters:
    ///   - sessionId: The unique identifier for the session.
    ///   - sessionName: Optional human-readable name for the session.
    /// - Returns: A configured `ServerEvent` of type ``ServerEventType/claudeTurn``.
    static func claudeTurn(sessionId: String, sessionName: String? = nil) -> ServerEvent {
        ServerEvent(
            type: .claudeTurn,
            sessionId: sessionId,
            sessionName: sessionName,
            message: "Claude has finished responding"
        )
    }
    
    /// Creates a bell event.
    ///
    /// Use this convenience method when a terminal bell character is received.
    ///
    /// - Parameter sessionId: The unique identifier for the session.
    /// - Returns: A configured `ServerEvent` of type ``ServerEventType/bell``.
    static func bell(sessionId: String) -> ServerEvent {
        ServerEvent(
            type: .bell,
            sessionId: sessionId,
            message: "Terminal bell"
        )
    }
    
    // MARK: - Computed Properties
    
    /// Returns a user-friendly display name for the event.
    ///
    /// The display name is determined by the following priority:
    /// 1. Session name (if available)
    /// 2. Command (if available)
    /// 3. Session ID (if available)
    /// 4. "Unknown Session" as fallback
    var displayName: String {
        sessionName ?? command ?? sessionId ?? "Unknown Session"
    }
    
    /// Determines whether this event should trigger a user notification.
    ///
    /// This delegates to the event type's ``ServerEventType/shouldNotify`` property.
    var shouldNotify: Bool {
        type.shouldNotify
    }
    
    /// Returns a human-readable formatted duration string.
    ///
    /// The duration is formatted based on its length:
    /// - Less than 1 second: Shows milliseconds (e.g., "500ms")
    /// - Less than 1 minute: Shows seconds with one decimal (e.g., "2.5s")
    /// - 1 minute or more: Shows minutes and seconds (e.g., "2m 5s")
    ///
    /// - Returns: A formatted duration string, or `nil` if no duration is set.
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
    
    /// Returns a formatted timestamp string.
    ///
    /// The timestamp is formatted using medium time style, which typically
    /// shows hours, minutes, and seconds (e.g., "3:45:32 PM").
    var formattedTimestamp: String {
        let formatter = DateFormatter()
        formatter.timeStyle = .medium
        return formatter.string(from: timestamp)
    }
} 
