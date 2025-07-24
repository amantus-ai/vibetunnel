import Foundation

// MARK: - Control Message Structure (with generic payload support)

struct ControlMessage<Payload: Codable>: Codable {
    let id: String
    let type: ControlProtocol.MessageType
    let category: ControlProtocol.Category
    let action: String
    let payload: Payload?
    let sessionId: String?
    let error: String?
    
    init(
        id: String = UUID().uuidString,
        type: ControlProtocol.MessageType,
        category: ControlProtocol.Category,
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

// MARK: - Protocol Conformance

extension ControlMessage: ControlProtocol.AnyControlMessage {}