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

    // MARK: - Control Message Structure

    struct ControlMessage: Codable {
        let id: String
        let type: MessageType
        let category: Category
        let action: String
        var payload: [String: Any]?
        var sessionId: String?
        var error: String?

        /// Custom encoding/decoding for Any type payload
        enum CodingKeys: String, CodingKey {
            case id
            case type
            case category
            case action
            case payload
            case sessionId
            case error
        }

        init(
            id: String = UUID().uuidString,
            type: MessageType,
            category: Category,
            action: String,
            payload: [String: Any]? = nil,
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

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            id = try container.decode(String.self, forKey: .id)
            type = try container.decode(MessageType.self, forKey: .type)
            category = try container.decode(Category.self, forKey: .category)
            action = try container.decode(String.self, forKey: .action)
            sessionId = try container.decodeIfPresent(String.self, forKey: .sessionId)
            error = try container.decodeIfPresent(String.self, forKey: .error)

            // Decode payload as generic JSON dictionary
            if let payloadData = try? container.decode(Data.self, forKey: .payload),
               let json = try? JSONSerialization.jsonObject(with: payloadData) as? [String: Any]
            {
                payload = json
            } else if let json = try? container.decode([String: Any].self, forKey: .payload) {
                payload = json
            }
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(id, forKey: .id)
            try container.encode(type, forKey: .type)
            try container.encode(category, forKey: .category)
            try container.encode(action, forKey: .action)
            try container.encodeIfPresent(sessionId, forKey: .sessionId)
            try container.encodeIfPresent(error, forKey: .error)

            // Encode payload as JSON data
            if let payload {
                let data = try JSONSerialization.data(withJSONObject: payload)
                try container.encode(data, forKey: .payload)
            }
        }
    }

    // MARK: - Helper Functions

    static func createRequest(
        category: Category,
        action: String,
        payload: [String: Any]? = nil,
        sessionId: String? = nil
    )
        -> ControlMessage
    {
        ControlMessage(
            type: .request,
            category: category,
            action: action,
            payload: payload,
            sessionId: sessionId
        )
    }

    static func createResponse(
        to request: ControlMessage,
        payload: [String: Any]? = nil,
        error: String? = nil,
        overrideAction: String? = nil
    )
        -> ControlMessage
    {
        ControlMessage(
            id: request.id,
            type: .response,
            category: request.category,
            action: overrideAction ?? request.action,
            payload: payload,
            sessionId: request.sessionId,
            error: error
        )
    }

    static func createEvent(
        category: Category,
        action: String,
        payload: [String: Any]? = nil,
        sessionId: String? = nil
    )
        -> ControlMessage
    {
        ControlMessage(
            type: .event,
            category: category,
            action: action,
            payload: payload,
            sessionId: sessionId
        )
    }

    // MARK: - Message Serialization

    static func encode(_ message: ControlMessage) throws -> Data {
        let encoder = JSONEncoder()
        return try encoder.encode(message)
    }

    static func decode(_ data: Data) throws -> ControlMessage {
        let decoder = JSONDecoder()
        return try decoder.decode(ControlMessage.self, from: data)
    }
}

// MARK: - JSON Extensions for Any type

private let maxDecodingDepth = 10

extension KeyedDecodingContainer {
    func decode(_ type: [String: Any].Type, forKey key: K) throws -> [String: Any] {
        let container = try nestedContainer(keyedBy: JSONCodingKeys.self, forKey: key)
        return try container.decodeWithDepth(type, depth: 0)
    }

    func decode(_ type: [String: Any].Type) throws -> [String: Any] {
        try decodeWithDepth(type, depth: 0)
    }

    private func decodeWithDepth(_ type: [String: Any].Type, depth: Int) throws -> [String: Any] {
        guard depth < maxDecodingDepth else {
            // Return empty dictionary if we've hit the depth limit
            return [:]
        }

        var dictionary = [String: Any]()

        for key in allKeys {
            if let value = try? decode(Bool.self, forKey: key) {
                dictionary[key.stringValue] = value
            } else if let value = try? decode(String.self, forKey: key) {
                dictionary[key.stringValue] = value
            } else if let value = try? decode(Int.self, forKey: key) {
                dictionary[key.stringValue] = value
            } else if let value = try? decode(Double.self, forKey: key) {
                dictionary[key.stringValue] = value
            } else if depth < maxDecodingDepth - 1,
                      let container = try? nestedContainer(keyedBy: JSONCodingKeys.self, forKey: key)
            {
                dictionary[key.stringValue] = try container.decodeWithDepth(type, depth: depth + 1)
            }
        }
        return dictionary
    }
}

struct JSONCodingKeys: CodingKey {
    var stringValue: String
    var intValue: Int?

    init?(stringValue: String) {
        self.stringValue = stringValue
    }

    init?(intValue: Int) {
        self.intValue = intValue
        self.stringValue = "\(intValue)"
    }
}
