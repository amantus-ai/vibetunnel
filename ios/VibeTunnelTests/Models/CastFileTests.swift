import Foundation
import Testing
@testable import VibeTunnel

@Suite("CastFile Tests", .tags(.models))
struct CastFileTests {

    @Test("Parse simple cast file")
    func parseSimpleCastFile() throws {
        let castContent = """
        {"version": 2, "width": 80, "height": 24}
        [0.123, "o", "Hello, World!\\r\\n"]
        [1.456, "o", "$ "]
        [2.789, "i", "exit\\r"]
        [3.012, "o", "exit\\r\\n"]
        """

        let castFile = try CastFile.parse(from: castContent)

        // Verify header
        #expect(castFile.header.version == 2)
        #expect(castFile.header.width == 80)
        #expect(castFile.header.height == 24)

        // Verify events
        #expect(castFile.events.count == 4)

        // First event
        #expect(castFile.events[0].time == 0.123)
        #expect(castFile.events[0].type == .output)
        #expect(castFile.events[0].data == "Hello, World!\r\n")

        // Input event
        #expect(castFile.events[2].type == .input)
        #expect(castFile.events[2].data == "exit\r")
    }

    @Test("Parse cast file with all header fields")
    func parseCastFileFullHeader() throws {
        let castContent = """
        {"version": 2, "width": 120, "height": 40, "timestamp": 1700000000, "title": "Demo Recording", "env": {"SHELL": "/bin/bash", "TERM": "xterm-256color"}}
        [0.0, "o", "Starting..."]
        """

        let castFile = try CastFile.parse(from: castContent)

        #expect(castFile.header.version == 2)
        #expect(castFile.header.width == 120)
        #expect(castFile.header.height == 40)
        #expect(castFile.header.timestamp == 1700000000)
        #expect(castFile.header.title == "Demo Recording")
        #expect(castFile.header.env?["SHELL"] == "/bin/bash")
        #expect(castFile.header.env?["TERM"] == "xterm-256color")
    }

    @Test("Parse malformed cast file")
    func parseMalformedCastFile() {
        let malformedContent = "This is not a valid cast file"

        #expect(throws: CastFile.ParseError.self) {
            try CastFile.parse(from: malformedContent)
        }
    }

    @Test("Parse cast file with invalid header")
    func parseInvalidHeader() {
        let invalidHeader = """
        {"invalid": "header"}
        [0.0, "o", "test"]
        """

        #expect(throws: CastFile.ParseError.self) {
            try CastFile.parse(from: invalidHeader)
        }
    }

    @Test("Parse cast file with invalid event")
    func parseInvalidEvent() {
        let invalidEvent = """
        {"version": 2, "width": 80, "height": 24}
        [0.0, "invalid", "test"]
        """

        #expect(throws: CastFile.ParseError.self) {
            try CastFile.parse(from: invalidEvent)
        }
    }

    @Test("Cast file duration calculation")
    func castFileDuration() throws {
        let castContent = """
        {"version": 2, "width": 80, "height": 24}
        [0.0, "o", "Start"]
        [5.5, "o", "Middle"]
        [10.25, "o", "End"]
        """

        let castFile = try CastFile.parse(from: castContent)

        #expect(castFile.duration == 10.25)
    }

    @Test("Empty cast file")
    func emptyCastFile() throws {
        let emptyContent = """
        {"version": 2, "width": 80, "height": 24}
        """

        let castFile = try CastFile.parse(from: emptyContent)

        #expect(castFile.events.isEmpty)
        #expect(castFile.duration == 0.0)
    }

    @Test("Cast file with resize events")
    func castFileWithResize() throws {
        let resizeContent = """
        {"version": 2, "width": 80, "height": 24}
        [0.0, "o", "Initial size"]
        [1.0, "r", "120x40"]
        [2.0, "o", "After resize"]
        """

        let castFile = try CastFile.parse(from: resizeContent)

        #expect(castFile.events.count == 3)
        #expect(castFile.events[1].type == .resize)
        #expect(castFile.events[1].data == "120x40")
    }

    @Test("Playback state management")
    @MainActor
    func playbackState() {
        let playback = CastPlayback()

        // Initial state
        #expect(playback.isPlaying == false)
        #expect(playback.currentTime == 0.0)
        #expect(playback.playbackSpeed == 1.0)

        // Change playback speed
        playback.playbackSpeed = 2.0
        #expect(playback.playbackSpeed == 2.0)

        // Update current time
        playback.currentTime = 5.5
        #expect(playback.currentTime == 5.5)
    }

    @Test("Event filtering by time")
    func eventFilteringByTime() throws {
        let castContent = """
        {"version": 2, "width": 80, "height": 24}
        [0.0, "o", "Event 1"]
        [1.0, "o", "Event 2"]
        [2.0, "o", "Event 3"]
        [3.0, "o", "Event 4"]
        [4.0, "o", "Event 5"]
        """

        let castFile = try CastFile.parse(from: castContent)

        // Get events up to time 2.5
        let eventsUpTo2_5 = castFile.events.filter { $0.time <= 2.5 }
        #expect(eventsUpTo2_5.count == 3)
        #expect(eventsUpTo2_5.last?.data == "Event 3")

        // Get events between 1.5 and 3.5
        let eventsBetween = castFile.events.filter { $0.time >= 1.5 && $0.time <= 3.5 }
        #expect(eventsBetween.count == 2)
        #expect(eventsBetween.first?.data == "Event 2")
        #expect(eventsBetween.last?.data == "Event 4")
    }

    @Test("Parse cast file from URL")
    @MainActor
    func parseCastFileFromURL() async throws {
        // Create a temporary file
        let tempDir = FileManager.default.temporaryDirectory
        let fileURL = tempDir.appendingPathComponent("test.cast")

        let castContent = """
        {"version": 2, "width": 80, "height": 24}
        [0.0, "o", "Test from file"]
        """

        try castContent.write(to: fileURL, atomically: true, encoding: .utf8)

        // Parse from URL
        let castFile = try await CastFile.load(from: fileURL)

        #expect(castFile.header.version == 2)
        #expect(castFile.events.count == 1)
        #expect(castFile.events[0].data == "Test from file")

        // Clean up
        try FileManager.default.removeItem(at: fileURL)
    }
}
