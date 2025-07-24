import Foundation

/// Quick start command structure matching the web interface
struct QuickStartCommand: Identifiable, Codable, Equatable {
    var id: String
    var name: String?
    var command: String

    /// Display name for the UI - uses name if available, otherwise command
    var displayName: String {
        name ?? command
    }

    init(id: String = UUID().uuidString, name: String? = nil, command: String) {
        self.id = id
        self.name = name
        self.command = command
    }

    /// Custom Codable implementation to handle missing id
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        self.name = try container.decodeIfPresent(String.self, forKey: .name)
        self.command = try container.decode(String.self, forKey: .command)
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case name
        case command
    }
}
