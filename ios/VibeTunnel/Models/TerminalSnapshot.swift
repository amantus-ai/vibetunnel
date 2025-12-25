import Foundation

/// A snapshot of terminal session output and events.
///
/// TerminalSnapshot captures the current state of a terminal session,
/// including all output events and metadata, useful for previews
/// and session history.
struct TerminalSnapshot: Codable {
    let sessionId: String
    let header: AsciinemaHeader?
    let events: [AsciinemaEvent]

    enum CodingKeys: String, CodingKey {
        case sessionId = "session_id"
        case header
        case events
    }
}

/// Represents a single event in the Asciinema format.
///
/// Events capture terminal interactions with timestamps
/// and can represent output, input, resize, or marker events.
struct AsciinemaEvent: Codable {
    let time: Double
    let type: EventType
    let data: String

    /// Types of events that can occur in a terminal session.
    enum EventType: String, Codable {
        /// Terminal output event.
        case output = "o"

        /// User input event.
        case input = "i"

        /// Terminal resize event.
        case resize = "r"

        /// Marker event (for annotations).
        case marker = "m"
    }
}

extension TerminalSnapshot {
    /// Generates a preview of the terminal output.
    ///
    /// - Returns: The last 4 non-empty lines of terminal output.
    ///
    /// This property combines all output events and extracts
    /// the most recent lines for display in session lists.
    var outputPreview: String {
        // Combine all output events
        let outputEvents = self.events.filter { $0.type == .output }
        let combinedOutput = outputEvents.map(\.data).joined()

        // Split into lines and get last few non-empty lines
        let lines = combinedOutput.components(separatedBy: .newlines)
        let nonEmptyLines = lines.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }

        // Take last 3-5 lines for preview
        let previewLines = Array(nonEmptyLines.suffix(4))
        return previewLines.joined(separator: "\n")
    }

    /// Generates a preview with ANSI escape codes removed.
    ///
    /// - Returns: Clean text suitable for display in UI elements
    ///   that don't support ANSI formatting.
    ///
    /// This implementation removes common ANSI escape sequences
    /// for colors, cursor movement, and formatting.
    var cleanOutputPreview: String {
        let output = self.outputPreview
        // Remove common ANSI escape sequences (this is a simplified version)
        let pattern = "\\x1B\\[[0-9;]*[mGKHf]"
        let regex = try? NSRegularExpression(pattern: pattern, options: [])
        let range = NSRange(location: 0, length: output.utf16.count)
        let cleaned = regex?.stringByReplacingMatches(in: output, options: [], range: range, withTemplate: "") ?? output
        return cleaned
    }
}
