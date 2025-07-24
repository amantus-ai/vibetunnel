import Foundation

// MARK: - Control Message Structure (with generic payload support)

/// A generic control message for communication between VibeTunnel components.
///
/// This struct represents messages exchanged through the control protocol,
/// supporting various message types, categories, and generic payloads for
/// flexible communication between the native app and web server.
struct ControlMessage<Payload: Codable>: Codable {
    /// Unique identifier for the message.
    ///
    /// Generated automatically if not provided. Used for message tracking
    /// and correlation of requests with responses.
    let id: String

    /// The type of message (request, response, event, etc.).
    ///
    /// Determines how the message should be processed by the receiver.
    let type: ControlProtocol.MessageType

    /// The functional category of the message.
    ///
    /// Groups related actions together (e.g., auth, session, config).
    let category: ControlProtocol.Category

    /// The specific action to perform within the category.
    ///
    /// Combined with the category, this uniquely identifies what
    /// operation the message represents.
    let action: String

    /// Optional payload data specific to the action.
    ///
    /// The generic type allows different message types to carry
    /// appropriate data structures while maintaining type safety.
    let payload: Payload?

    /// Optional session identifier this message relates to.
    ///
    /// Used when the message is specific to a particular terminal session.
    let sessionId: String?

    /// Optional error message for response messages.
    ///
    /// Populated when a request fails or an error occurs during processing.
    let error: String?

    /// Creates a new control message.
    ///
    /// - Parameters:
    ///   - id: Unique message identifier. Defaults to a new UUID string.
    ///   - type: The message type (request, response, event, etc.).
    ///   - category: The functional category of the message.
    ///   - action: The specific action within the category.
    ///   - payload: Optional payload data for the action.
    ///   - sessionId: Optional session identifier this message relates to.
    ///   - error: Optional error message for error responses.
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
