import Foundation

/// Control message protocol for unified Unix socket communication
enum ControlProtocol {
    // MARK: - Message Types

    enum MessageType: String, Codable {
        case request
        case response
        case event
    }

    enum Category: String, Codable {
        case terminal
        case screencap
        case git
        case system
    }

    // MARK: - Control Message Structure (with generic payload support)

    struct ControlMessage<Payload: Codable>: Codable {
        let id: String
        let type: MessageType
        let category: Category
        let action: String
        let payload: Payload?
        let sessionId: String?
        let error: String?

        init(
            id: String = UUID().uuidString,
            type: MessageType,
            category: Category,
            action: String,
            payload: Payload? = nil,
            sessionId: String? = nil,
            error: String? = nil
        ) {
            self.id = id
            self.type = type
            self.category = category
            self.action = action
            self.payload = payload
            self.sessionId = sessionId
            self.error = error
        }
    }
    
    // MARK: - Base message for runtime dispatch
    
    protocol AnyControlMessage {
        var id: String { get }
        var type: MessageType { get }
        var category: Category { get }
        var action: String { get }
        var sessionId: String? { get }
        var error: String? { get }
    }
    
    extension ControlMessage: AnyControlMessage {}
    
    // MARK: - Type aliases for common message types
    
    typealias TerminalSpawnRequestMessage = ControlMessage<TerminalSpawnRequest>
    typealias TerminalSpawnResponseMessage = ControlMessage<TerminalSpawnResponse>
    typealias SystemReadyMessage = ControlMessage<SystemReadyEvent>
    typealias SystemPingRequestMessage = ControlMessage<SystemPingRequest>
    typealias SystemPingResponseMessage = ControlMessage<SystemPingResponse>

    // MARK: - Convenience builders for specific message types
    
    // Terminal messages
    static func terminalSpawnRequest(
        sessionId: String,
        workingDirectory: String? = nil,
        command: String? = nil,
        terminalPreference: String? = nil
    ) -> TerminalSpawnRequestMessage {
        ControlMessage(
            type: .request,
            category: .terminal,
            action: "spawn",
            payload: TerminalSpawnRequest(
                sessionId: sessionId,
                workingDirectory: workingDirectory,
                command: command,
                terminalPreference: terminalPreference
            ),
            sessionId: sessionId
        )
    }
    
    static func terminalSpawnResponse(
        to request: TerminalSpawnRequestMessage,
        success: Bool,
        pid: Int? = nil,
        error: String? = nil
    ) -> TerminalSpawnResponseMessage {
        ControlMessage(
            id: request.id,
            type: .response,
            category: .terminal,
            action: "spawn",
            payload: TerminalSpawnResponse(success: success, pid: pid, error: error),
            sessionId: request.sessionId,
            error: error
        )
    }
    
    // System messages
    static func systemReadyEvent() -> SystemReadyMessage {
        ControlMessage(
            type: .event,
            category: .system,
            action: "ready",
            payload: SystemReadyEvent()
        )
    }
    
    static func systemPingResponse(
        to request: SystemPingRequestMessage
    ) -> SystemPingResponseMessage {
        ControlMessage(
            id: request.id,
            type: .response,
            category: .system,
            action: "ping",
            payload: SystemPingResponse()
        )
    }


    // MARK: - Message Serialization

    static func encode<T: Codable>(_ message: ControlMessage<T>) throws -> Data {
        let encoder = JSONEncoder()
        return try encoder.encode(message)
    }

    static func decode<T: Codable>(_ data: Data, as messageType: ControlMessage<T>.Type) throws -> ControlMessage<T> {
        let decoder = JSONDecoder()
        return try decoder.decode(messageType, from: data)
    }
    
    // For handlers that need to decode specific message types based on action
    static func decodeTerminalSpawnRequest(_ data: Data) throws -> TerminalSpawnRequestMessage {
        return try decode(data, as: TerminalSpawnRequestMessage.self)
    }
    
    static func decodeSystemPingRequest(_ data: Data) throws -> SystemPingRequestMessage {
        return try decode(data, as: SystemPingRequestMessage.self)
    }
}
