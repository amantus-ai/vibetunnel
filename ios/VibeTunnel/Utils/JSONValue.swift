import Foundation

enum JSONValue: Codable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case array([JSONValue])
    case object([String: JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if container.decodeNil() {
            self = .null
        } else if let bool = try? container.decode(Bool.self) {
            self = .bool(bool)
        } else if let number = try? container.decode(Double.self) {
            self = .number(number)
        } else if let string = try? container.decode(String.self) {
            self = .string(string)
        } else if let array = try? container.decode([JSONValue].self) {
            self = .array(array)
        } else if let object = try? container.decode([String: JSONValue].self) {
            self = .object(object)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unsupported JSON value")
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()

        switch self {
        case let .string(value):
            try container.encode(value)
        case let .number(value):
            try container.encode(value)
        case let .bool(value):
            try container.encode(value)
        case let .array(value):
            try container.encode(value)
        case let .object(value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }

    var string: String? {
        if case let .string(value) = self { return value }
        return nil
    }

    var double: Double? {
        if case let .number(value) = self { return value }
        return nil
    }

    var int: Int? {
        if case let .number(value) = self { return Int(value) }
        return nil
    }

    var bool: Bool? {
        if case let .bool(value) = self { return value }
        return nil
    }

    var array: [JSONValue]? {
        if case let .array(value) = self { return value }
        return nil
    }

    var object: [String: JSONValue]? {
        if case let .object(value) = self { return value }
        return nil
    }

    init?(any: Any) {
        switch any {
        case let value as String:
            self = .string(value)
        case let value as Bool:
            self = .bool(value)
        case let value as Int:
            self = .number(Double(value))
        case let value as Double:
            self = .number(value)
        case let value as Float:
            self = .number(Double(value))
        case let value as [Any]:
            let converted = value.compactMap(JSONValue.init(any:))
            guard converted.count == value.count else { return nil }
            self = .array(converted)
        case let value as [String: Any]:
            var converted: [String: JSONValue] = [:]
            converted.reserveCapacity(value.count)
            for (key, element) in value {
                guard let jsonValue = JSONValue(any: element) else { return nil }
                converted[key] = jsonValue
            }
            self = .object(converted)
        case is NSNull:
            self = .null
        default:
            return nil
        }
    }
}

extension JSONValue {
    static func decodeObject(from data: Data) -> [String: JSONValue]? {
        try? JSONDecoder().decode([String: JSONValue].self, from: data)
    }

    static func decodeArray(from data: Data) -> [JSONValue]? {
        try? JSONDecoder().decode([JSONValue].self, from: data)
    }

    static func encode(_ value: JSONValue) -> Data? {
        try? JSONEncoder().encode(value)
    }
}
