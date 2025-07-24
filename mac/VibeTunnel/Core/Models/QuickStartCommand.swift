import Foundation

/// A quick start command for terminal sessions.
///
/// This struct represents a predefined command that users can quickly execute
/// when starting a new terminal session. It matches the structure used by the
/// web interface for consistency across platforms.
struct QuickStartCommand: Identifiable, Codable, Equatable {
    /// Unique identifier for the command.
    ///
    /// Generated automatically if not provided during initialization.
    var id: String

    /// Optional human-readable name for the command.
    ///
    /// When provided, this is used for display instead of showing
    /// the raw command string.
    var name: String?

    /// The actual command to execute in the terminal.
    ///
    /// This can be any valid shell command or script.
    var command: String

    /// Display name for the UI.
    ///
    /// Returns the `name` if available, otherwise falls back to the raw `command`.
    /// This provides a cleaner UI experience while still showing the command
    /// when no custom name is set.
    var displayName: String {
        name ?? command
    }

    /// Creates a new quick start command.
    ///
    /// - Parameters:
    ///   - id: Unique identifier. Defaults to a new UUID string.
    ///   - name: Optional display name for the command.
    ///   - command: The shell command to execute.
    init(id: String = UUID().uuidString, name: String? = nil, command: String) {
        self.id = id
        self.name = name
        self.command = command
    }

    /// Custom Codable implementation to handle missing id.
    ///
    /// This decoder ensures backward compatibility by generating a new ID
    /// if one is not present in the decoded data.
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
