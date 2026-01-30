import Foundation
import Observation

/// Cast file theme configuration for terminal appearance.
///
/// This struct represents the theme settings that can be included in an Asciinema cast file,
/// controlling the visual appearance of the terminal recording.
struct CastTheme: Codable {
    let foreground: String?
    let background: String?
    let palette: String?

    enum CodingKeys: String, CodingKey {
        case foreground = "fg"
        case background = "bg"
        case palette
    }
}

/// Represents the header structure of an Asciinema cast v2 file.
///
/// The CastFile struct contains metadata about a terminal recording,
/// including dimensions, timing, and optional theme information.
/// This follows the Asciinema cast v2 format specification.
struct CastFile: Codable {
    let version: Int
    let width: Int
    let height: Int
    let timestamp: TimeInterval?
    let title: String?
    let env: [String: String]?
    let theme: CastTheme?
}

/// Represents a single event in a terminal recording.
///
/// Events capture terminal output, input, or resize operations
/// with timestamps relative to the recording start.
struct CastEvent: Codable {
    let time: TimeInterval
    let type: String // "o" for output, "i" for input, "r" for resize
    let data: String
}

/// Records terminal sessions in Asciinema cast v2 format.
///
/// CastRecorder captures terminal output and resize events during a session,
/// allowing export of the recording as a standard cast file that can be
/// played back with any Asciinema-compatible player.
///
/// ## Usage
/// ```swift
/// let recorder = CastRecorder(sessionId: "session123")
/// recorder.startRecording()
/// // Terminal output is recorded...
/// recorder.stopRecording()
/// let castData = recorder.exportCastFile()
/// ```
@MainActor
@Observable
class CastRecorder {
    var isRecording = false
    var recordingStartTime: Date?
    var events: [CastEvent] = []

    private let sessionId: String
    private let width: Int
    private let height: Int
    private var startTime: TimeInterval = 0

    /// Creates a new cast recorder for a terminal session.
    ///
    /// - Parameters:
    ///   - sessionId: Unique identifier for the session.
    ///   - width: Terminal width in columns (default: 80).
    ///   - height: Terminal height in rows (default: 24).
    init(sessionId: String, width: Int = 80, height: Int = 24) {
        self.sessionId = sessionId
        self.width = width
        self.height = height
    }

    /// Begins recording terminal events.
    ///
    /// Clears any previous events and sets the recording start time.
    /// Has no effect if recording is already in progress.
    func startRecording() {
        guard !self.isRecording else { return }

        self.isRecording = true
        self.recordingStartTime = Date()
        self.startTime = Date().timeIntervalSince1970
        self.events.removeAll()
    }

    /// Stops recording terminal events.
    ///
    /// Has no effect if recording is not in progress.
    func stopRecording() {
        guard self.isRecording else { return }

        self.isRecording = false
        self.recordingStartTime = nil
    }

    /// Records terminal output data.
    ///
    /// - Parameter data: The terminal output text to record.
    ///
    /// Output events are timestamped relative to the recording start time.
    /// Has no effect if recording is not active.
    func recordOutput(_ data: String) {
        guard self.isRecording else { return }

        let currentTime = Date().timeIntervalSince1970
        let relativeTime = currentTime - self.startTime

        let event = CastEvent(
            time: relativeTime,
            type: "o", // output
            data: data)

        self.events.append(event)
    }

    /// Records a terminal resize event.
    ///
    /// - Parameters:
    ///   - cols: New terminal width in columns.
    ///   - rows: New terminal height in rows.
    ///
    /// Resize events are timestamped relative to the recording start time.
    /// Has no effect if recording is not active.
    func recordResize(cols: Int, rows: Int) {
        guard self.isRecording else { return }

        let currentTime = Date().timeIntervalSince1970
        let relativeTime = currentTime - self.startTime

        let resizeData = "\(cols)x\(rows)"
        let event = CastEvent(
            time: relativeTime,
            type: "r", // resize
            data: resizeData)

        self.events.append(event)
    }

    /// Exports the recording as an Asciinema cast v2 file.
    ///
    /// - Returns: The cast file data, or nil if export fails.
    ///
    /// The exported data contains a JSON header followed by
    /// newline-delimited JSON arrays representing each event.
    func exportCastFile() -> Data? {
        // Create header
        let header = CastFile(
            version: 2,
            width: width,
            height: height,
            timestamp: startTime,
            title: "VibeTunnel Recording - \(sessionId)",
            env: ["TERM": "xterm-256color", "SHELL": "/bin/zsh"],
            theme: nil)

        guard let headerData = try? JSONEncoder().encode(header),
              let headerString = String(data: headerData, encoding: .utf8)
        else {
            return nil
        }

        // Build the cast file content
        var castContent = headerString + "\n"

        // Add all events
        for event in self.events {
            // Cast events are encoded as arrays [time, type, data]
            let eventArray: [JSONValue] = [
                .number(event.time),
                .string(event.type),
                .string(event.data),
            ]

            if let jsonData = try? JSONEncoder().encode(eventArray),
               let jsonString = String(data: jsonData, encoding: .utf8)
            {
                castContent += jsonString + "\n"
            }
        }

        return castContent.data(using: .utf8)
    }
}

/// Plays back terminal recordings from Asciinema cast files.
///
/// CastPlayer parses cast v2 files and provides playback functionality
/// with proper timing between events.
///
/// ## Example
/// ```swift
/// if let player = CastPlayer(data: castFileData) {
///     player.play(onEvent: { event in
///         // Handle each event
///     }, completion: {
///         // Playback complete
///     })
/// }
/// ```
class CastPlayer {
    /// The cast file header containing metadata.
    let header: CastFile

    /// All events in the recording.
    let events: [CastEvent]

    /// Creates a cast player from cast file data.
    ///
    /// - Parameter data: Raw cast file data.
    ///
    /// - Returns: A configured player, or nil if the data is invalid.
    ///
    /// The initializer parses the cast file format, extracting the header
    /// from the first line and events from subsequent lines.
    init?(data: Data) {
        guard let content = String(data: data, encoding: .utf8) else {
            return nil
        }

        let lines = content.components(separatedBy: .newlines)
        guard !lines.isEmpty else { return nil }

        // Parse header (first line)
        guard let headerData = lines[0].data(using: .utf8),
              let header = try? JSONDecoder().decode(CastFile.self, from: headerData)
        else {
            return nil
        }

        // Parse events (remaining lines)
        var parsedEvents: [CastEvent] = []
        for index in 1..<lines.count {
            let line = lines[index].trimmingCharacters(in: .whitespacesAndNewlines)
            guard !line.isEmpty,
                  let lineData = line.data(using: .utf8),
                  let array = JSONValue.decodeArray(from: lineData),
                  array.count >= 3,
                  let time = array[0].double,
                  let type = array[1].string,
                  let data = array[2].string
            else {
                continue
            }

            let event = CastEvent(time: time, type: type, data: data)
            parsedEvents.append(event)
        }

        self.header = header
        self.events = parsedEvents
    }

    /// The total duration of the recording in seconds.
    ///
    /// Calculated from the timestamp of the last event.
    var duration: TimeInterval {
        self.events.last?.time ?? 0
    }

    /// Plays back the recording with proper timing.
    ///
    /// - Parameters:
    ///   - onEvent: Closure called for each event during playback.
    ///   - completion: Closure called when playback completes.
    ///
    /// Events are delivered on the main actor with delays matching
    /// their original timing. The playback runs asynchronously.
    func play(onEvent: @escaping @Sendable (CastEvent) -> Void, completion: @escaping @Sendable () -> Void) {
        let eventsToPlay = self.events
        Task { @Sendable in
            for event in eventsToPlay {
                // Wait for the appropriate time
                if event.time > 0 {
                    try? await Task.sleep(nanoseconds: UInt64(event.time * 1_000_000_000))
                }

                await MainActor.run {
                    onEvent(event)
                }
            }

            await MainActor.run {
                completion()
            }
        }
    }

    /// Modern async version of play that supports cancellation and error handling.
    ///
    /// - Parameter onEvent: Async closure called for each event during playback.
    /// - Throws: Throws if playback is cancelled or encounters an error.
    ///
    /// Events are delivered on the main actor with delays matching
    /// their original timing.
    @MainActor
    func play(onEvent: @Sendable (CastEvent) async -> Void) async throws {
        for event in self.events {
            // Check for cancellation
            try Task.checkCancellation()

            // Wait for the appropriate time
            if event.time > 0 {
                try await Task.sleep(nanoseconds: UInt64(event.time * 1_000_000_000))
            }

            await onEvent(event)
        }
    }
}
