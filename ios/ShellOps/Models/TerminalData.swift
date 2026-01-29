import Foundation

/// Represents different types of events that can occur in a terminal session.
///
/// TerminalEvent encapsulates the various event types from the Asciinema
/// streaming format, including headers, output, resize events, and session exits.
enum TerminalEvent {
    /// Header event containing session metadata.
    case header(AsciinemaHeader)

    /// Terminal output event with timestamp and text data.
    case output(timestamp: Double, data: String)

    /// Terminal resize event with timestamp and dimensions.
    case resize(timestamp: Double, dimensions: String)

    /// Session exit event with exit code and session ID.
    case exit(code: Int, sessionId: String)

    /// Creates a terminal event from a JSON line.
    ///
    /// - Parameter line: A JSON-formatted string representing an event.
    /// - Returns: A parsed TerminalEvent, or nil if parsing fails.
    ///
    /// This initializer handles multiple event formats:
    /// - Asciinema header objects
    /// - Array-based events for output/resize
    /// - Exit events with status information
    init?(from line: String) {
        guard let data = line.data(using: .utf8) else { return nil }

        // Try to parse as header first
        if let header = try? JSONDecoder().decode(AsciinemaHeader.self, from: data) {
            self = .header(header)
            return
        }

        // Try to parse as array event
        guard let array = JSONValue.decodeArray(from: data) else {
            return nil
        }

        // Check for exit event: ["exit", exitCode, sessionId]
        if array.count == 3,
           array[0].string == "exit",
           let exitCode = array[1].int,
           let sessionId = array[2].string
        {
            self = .exit(code: exitCode, sessionId: sessionId)
            return
        }

        // Parse normal events: [timestamp, "type", "data"]
        guard array.count >= 3,
              let timestamp = array[0].double,
              let typeString = array[1].string,
              let eventData = array[2].string
        else {
            return nil
        }

        switch typeString {
        case "o":
            self = .output(timestamp: timestamp, data: eventData)
        case "r":
            self = .resize(timestamp: timestamp, dimensions: eventData)
        default:
            return nil
        }
    }
}

/// Header structure for Asciinema format streams.
///
/// Contains metadata about the terminal session including
/// dimensions, timing, and environment information.
struct AsciinemaHeader: Codable {
    let version: Int
    let width: Int
    let height: Int
    let timestamp: Double?
    let duration: Double?
    let command: String?
    let title: String?
    let env: [String: String]?
}

/// Represents input to be sent to the terminal.
///
/// TerminalInput handles both regular text input and special
/// key sequences like arrow keys, control combinations, etc.
struct TerminalInput: Codable {
    let text: String

    /// Special key sequences that can be sent to the terminal.
    enum SpecialKey: String {
        // MARK: - Arrow Keys

        /// Up arrow key (ANSI escape sequence).
        case arrowUp = "\u{001B}[A"
        /// Down arrow key (ANSI escape sequence).
        case arrowDown = "\u{001B}[B"
        /// Right arrow key (ANSI escape sequence).
        case arrowRight = "\u{001B}[C"
        /// Left arrow key (ANSI escape sequence).
        case arrowLeft = "\u{001B}[D"

        // MARK: - Special Keys

        /// Escape key.
        case escape = "\u{001B}"
        /// Enter/Return key (carriage return).
        case enter = "\r"
        /// Tab key.
        case tab = "\t"

        // MARK: - Control Keys

        /// Control-C (interrupt signal).
        case ctrlC = "\u{0003}"
        /// Control-D (end of transmission).
        case ctrlD = "\u{0004}"
        /// Control-Z (suspend signal).
        case ctrlZ = "\u{001A}"
        /// Control-L (clear screen).
        case ctrlL = "\u{000C}"
        /// Control-A (move to beginning of line).
        case ctrlA = "\u{0001}"
        /// Control-E (move to end of line).
        case ctrlE = "\u{0005}"

        // MARK: - Function Keys

        /// F1 key.
        case f1 = "\u{001B}OP"
        /// F2 key.
        case f2 = "\u{001B}OQ"
        /// F3 key.
        case f3 = "\u{001B}OR"
        /// F4 key.
        case f4 = "\u{001B}OS"
        /// F5 key.
        case f5 = "\u{001B}[15~"
        /// F6 key.
        case f6 = "\u{001B}[17~"
        /// F7 key.
        case f7 = "\u{001B}[18~"
        /// F8 key.
        case f8 = "\u{001B}[19~"
        /// F9 key.
        case f9 = "\u{001B}[20~"
        /// F10 key.
        case f10 = "\u{001B}[21~"
        /// F11 key.
        case f11 = "\u{001B}[23~"
        /// F12 key.
        case f12 = "\u{001B}[24~"

        // MARK: - Additional Special Characters

        /// Backslash character.
        case backslash = "\\"
        /// Pipe character.
        case pipe = "|"
        /// Backtick character.
        case backtick = "`"
        /// Tilde character.
        case tilde = "~"

        // MARK: - Web Compatibility

        /// Control-Enter combination (web frontend compatibility).
        case ctrlEnter = "ctrl_enter"
        /// Shift-Enter combination (web frontend compatibility).
        case shiftEnter = "shift_enter"
    }

    /// Creates a terminal input from a special key.
    ///
    /// - Parameter specialKey: The special key to send.
    init(specialKey: SpecialKey) {
        self.text = specialKey.rawValue
    }

    /// Creates a terminal input from regular text.
    ///
    /// - Parameter text: The text to send to the terminal.
    init(text: String) {
        self.text = text
    }
}

/// Represents a terminal resize request.
///
/// Used to notify the server when the terminal dimensions change.
struct TerminalResize: Codable {
    let cols: Int
    let rows: Int
}
