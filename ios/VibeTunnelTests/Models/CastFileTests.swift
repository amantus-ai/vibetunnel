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

        let data = castContent.data(using: .utf8)!
        let player = CastPlayer(data: data)!

        // Verify header
        #expect(player.header.version == 2)
        #expect(player.header.width == 80)
        #expect(player.header.height == 24)

        // Verify events
        #expect(player.events.count == 4)

        // First event
        #expect(player.events[0].time == 0.123)
        #expect(player.events[0].type == "o")
        #expect(player.events[0].data == "Hello, World!\r\n")

        // Input event
        #expect(player.events[2].type == "i")
        #expect(player.events[2].data == "exit\r")
    }

    @Test("Parse cast file with all header fields")
    func parseCastFileFullHeader() throws {
        let castContent = """
        {"version": 2, "width": 120, "height": 40, "timestamp": 1700000000, "title": "Demo Recording", "env": {"SHELL": "/bin/bash", "TERM": "xterm-256color"}}
        [0.0, "o", "Starting..."]
        """

        let data = castContent.data(using: .utf8)!
        let player = CastPlayer(data: data)!

        #expect(player.header.version == 2)
        #expect(player.header.width == 120)
        #expect(player.header.height == 40)
        #expect(player.header.timestamp == 1700000000)
        #expect(player.header.title == "Demo Recording")
        #expect(player.header.env?["SHELL"] == "/bin/bash")
        #expect(player.header.env?["TERM"] == "xterm-256color")
    }

    @Test("Parse malformed cast file")
    func parseMalformedCastFile() {
        let malformedContent = "This is not a valid cast file"
        let data = malformedContent.data(using: .utf8)!

        let player = CastPlayer(data: data)
        #expect(player == nil)
    }

    @Test("Parse cast file with invalid header")
    func parseInvalidHeader() {
        let invalidHeader = """
        {"invalid": "header"}
        [0.0, "o", "test"]
        """
        let data = invalidHeader.data(using: .utf8)!

        let player = CastPlayer(data: data)
        #expect(player == nil)
    }

    @Test("Parse cast file with invalid event")
    func parseInvalidEvent() {
        let invalidEvent = """
        {"version": 2, "width": 80, "height": 24}
        [0.0, "invalid", "test"]
        """
        let data = invalidEvent.data(using: .utf8)!

        // Should still parse successfully, including invalid events
        let player = CastPlayer(data: data)
        #expect(player != nil)
        #expect(player?.events.count == 1) // Invalid event is included but may have unknown type
    }

    @Test("Cast file duration calculation")
    func castFileDuration() throws {
        let castContent = """
        {"version": 2, "width": 80, "height": 24}
        [0.0, "o", "Start"]
        [5.5, "o", "Middle"]
        [10.25, "o", "End"]
        """

        let data = castContent.data(using: .utf8)!
        let player = CastPlayer(data: data)!

        #expect(player.duration == 10.25)
    }

    @Test("Empty cast file")
    func emptyCastFile() throws {
        let emptyContent = """
        {"version": 2, "width": 80, "height": 24}
        """

        let data = emptyContent.data(using: .utf8)!
        let player = CastPlayer(data: data)!

        #expect(player.events.isEmpty)
        #expect(player.duration == 0.0)
    }

    @Test("Cast file with resize events")
    func castFileWithResize() throws {
        let resizeContent = """
        {"version": 2, "width": 80, "height": 24}
        [0.0, "o", "Initial size"]
        [1.0, "r", "120x40"]
        [2.0, "o", "After resize"]
        """

        let data = resizeContent.data(using: .utf8)!
        let player = CastPlayer(data: data)!

        #expect(player.events.count == 3)
        #expect(player.events[1].type == "r")
        #expect(player.events[1].data == "120x40")
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

        let data = castContent.data(using: .utf8)!
        let player = CastPlayer(data: data)!

        // Get events up to time 2.5
        let eventsUpTo2_5 = player.events.filter { $0.time <= 2.5 }
        #expect(eventsUpTo2_5.count == 3)
        #expect(eventsUpTo2_5.last?.data == "Event 3")

        // Get events between 1.5 and 3.5
        let eventsBetween = player.events.filter { $0.time >= 1.5 && $0.time <= 3.5 }
        #expect(eventsBetween.count == 2)
        #expect(eventsBetween.first?.data == "Event 3")
        #expect(eventsBetween.last?.data == "Event 4")
    }

    @Test("Parse cast file from file URL")
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

        // Read from URL and parse
        let data = try Data(contentsOf: fileURL)
        let player = CastPlayer(data: data)!

        #expect(player.header.version == 2)
        #expect(player.events.count == 1)
        #expect(player.events[0].data == "Test from file")

        // Clean up
        try FileManager.default.removeItem(at: fileURL)
    }

    @Test("Cast recorder functionality")
    @MainActor
    func castRecorderFunctionality() {
        let recorder = CastRecorder(sessionId: "test-session", width: 120, height: 40)

        // Initial state
        #expect(recorder.isRecording == false)
        #expect(recorder.recordingStartTime == nil)
        #expect(recorder.events.isEmpty)

        // Start recording
        recorder.startRecording()
        #expect(recorder.isRecording == true)
        #expect(recorder.recordingStartTime != nil)

        // Record some output
        recorder.recordOutput("Hello, World!")
        recorder.recordOutput("Another line")
        #expect(recorder.events.count == 2)
        #expect(recorder.events[0].type == "o")
        #expect(recorder.events[0].data == "Hello, World!")

        // Record resize
        recorder.recordResize(cols: 100, rows: 30)
        #expect(recorder.events.count == 3)
        #expect(recorder.events[2].type == "r")
        #expect(recorder.events[2].data == "100x30")

        // Stop recording
        recorder.stopRecording()
        #expect(recorder.isRecording == false)
        #expect(recorder.recordingStartTime == nil)

        // Export cast file
        let castData = recorder.exportCastFile()
        #expect(castData != nil)

        // Verify exported data can be parsed back
        let player = CastPlayer(data: castData!)
        #expect(player != nil)
        #expect(player?.header.version == 2)
        #expect(player?.header.width == 120)
        #expect(player?.header.height == 40)
        #expect(player?.events.count == 3)
    }

    @Test("Cast player playback functionality")
    @MainActor
    func castPlayerPlayback() async throws {
        let castContent = """
        {"version": 2, "width": 80, "height": 24}
        [0.0, "o", "First"]
        [0.1, "o", "Second"]
        [0.2, "o", "Third"]
        """

        let data = castContent.data(using: .utf8)!
        let player = CastPlayer(data: data)!

        actor EventCollector {
            private var events: [CastEvent] = []
            
            func addEvent(_ event: CastEvent) {
                events.append(event)
            }
            
            func getEvents() -> [CastEvent] {
                return events
            }
        }
        
        let collector = EventCollector()

        // Test async play method
        try await player.play { event in
            await collector.addEvent(event)
        }

        let receivedEvents = await collector.getEvents()
        #expect(receivedEvents.count == 3)
        #expect(receivedEvents[0].data == "First")
        #expect(receivedEvents[1].data == "Second")
        #expect(receivedEvents[2].data == "Third")
    }

    @Test("Cast file with theme information")
    func castFileWithTheme() throws {
        let castContent = """
        {"version": 2, "width": 80, "height": 24, "theme": {"fg": "#FFFFFF", "bg": "#000000", "palette": "solarized"}}
        [0.0, "o", "Themed output"]
        """

        let data = castContent.data(using: .utf8)!
        let player = CastPlayer(data: data)!

        #expect(player.header.theme?.foreground == "#FFFFFF")
        #expect(player.header.theme?.background == "#000000")
        #expect(player.header.theme?.palette == "solarized")
    }

    @Test("Recording with no output produces empty events")
    @MainActor
    func recordingWithNoOutput() {
        let recorder = CastRecorder(sessionId: "empty-test")

        recorder.startRecording()
        // Record nothing
        recorder.stopRecording()

        let castData = recorder.exportCastFile()
        #expect(castData != nil)

        let player = CastPlayer(data: castData!)
        #expect(player != nil)
        #expect(player?.events.isEmpty == true)
        #expect(player?.duration == 0.0)
    }
}