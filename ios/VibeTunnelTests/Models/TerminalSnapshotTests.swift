import Foundation
import Testing
@testable import VibeTunnel

@Suite("TerminalSnapshot Tests", .tags(.models))
struct TerminalSnapshotTests {

    @Test("Terminal snapshot initialization")
    func terminalSnapshotInit() {
        let events = [
            AsciinemaEvent(time: 0.0, type: .output, data: "Line 1\n"),
            AsciinemaEvent(time: 1.0, type: .output, data: "Line 2 with some text\n"),
            AsciinemaEvent(time: 2.0, type: .output, data: "Line 3\n")
        ]
        
        let header = AsciinemaHeader(version: 2, width: 80, height: 24, timestamp: nil, duration: nil, command: nil, title: nil, env: nil)
        let snapshot = TerminalSnapshot(sessionId: "test-session", header: header, events: events)

        #expect(snapshot.sessionId == "test-session")
        #expect(snapshot.events.count == 3)
        #expect(snapshot.header?.version == 2)
    }

    @Test("Output preview generation")
    func outputPreview() {
        let events = [
            AsciinemaEvent(time: 0.0, type: .output, data: "First line\n"),
            AsciinemaEvent(time: 1.0, type: .output, data: "Second line\n"),
            AsciinemaEvent(time: 2.0, type: .output, data: "Third line\n"),
            AsciinemaEvent(time: 3.0, type: .output, data: "Fourth line\n"),
            AsciinemaEvent(time: 4.0, type: .output, data: "Fifth line\n")
        ]

        let snapshot = TerminalSnapshot(sessionId: "test", header: nil, events: events)
        let preview = snapshot.outputPreview

        #expect(preview.contains("First line"))
        #expect(preview.contains("Second line"))
        #expect(preview.contains("Third line"))

        // Should be limited to last 4 lines based on the implementation
        #expect(preview.contains("Fourth line"))
        #expect(preview.contains("Fifth line"))
    }

    @Test("Clean output preview removes ANSI codes")
    func cleanOutputPreview() {
        let events = [
            AsciinemaEvent(time: 0.0, type: .output, data: "\u{001B}[31mRed text\u{001B}[0m\n"),
            AsciinemaEvent(time: 1.0, type: .output, data: "\u{001B}[1;32mBold green\u{001B}[0m\n"),
            AsciinemaEvent(time: 2.0, type: .output, data: "Normal text\n")
        ]

        let snapshot = TerminalSnapshot(sessionId: "test", header: nil, events: events)
        let cleanPreview = snapshot.cleanOutputPreview

        #expect(cleanPreview.contains("Red text"))
        #expect(cleanPreview.contains("Bold green"))
        #expect(cleanPreview.contains("Normal text"))

        // Should not contain ANSI escape codes
        #expect(!cleanPreview.contains("\u{001B}"))
        #expect(!cleanPreview.contains("[31m"))
        #expect(!cleanPreview.contains("[0m"))
    }

    @Test("Empty events handling")
    func emptyEventsHandling() {
        let snapshot = TerminalSnapshot(sessionId: "empty", header: nil, events: [])

        #expect(snapshot.events.isEmpty)
        #expect(snapshot.outputPreview.isEmpty)
        #expect(snapshot.cleanOutputPreview.isEmpty)
    }

    @Test("Single event snapshot")
    func singleEventSnapshot() {
        let events = [AsciinemaEvent(time: 0.0, type: .output, data: "Single line\n")]
        let snapshot = TerminalSnapshot(sessionId: "single", header: nil, events: events)

        #expect(snapshot.events.count == 1)
        #expect(snapshot.outputPreview.contains("Single line"))
        #expect(snapshot.cleanOutputPreview.contains("Single line"))
    }

    @Test("Whitespace preservation")
    func whitespacePreservation() {
        let events = [
            AsciinemaEvent(time: 0.0, type: .output, data: "  Indented line\n"),
            AsciinemaEvent(time: 1.0, type: .output, data: "\tTab indented\n"),
            AsciinemaEvent(time: 2.0, type: .output, data: "Multiple   spaces\n")
        ]

        let snapshot = TerminalSnapshot(sessionId: "whitespace", header: nil, events: events)

        #expect(snapshot.events[0].data == "  Indented line\n")
        #expect(snapshot.events[1].data == "\tTab indented\n")
        #expect(snapshot.events[2].data == "Multiple   spaces\n")
    }

    @Test("Unicode content handling")
    func unicodeContent() {
        let events = [
            AsciinemaEvent(time: 0.0, type: .output, data: "Hello 👋\n"),
            AsciinemaEvent(time: 1.0, type: .output, data: "日本語テスト\n"),
            AsciinemaEvent(time: 2.0, type: .output, data: "Émojis: 🎉🎊🎈\n")
        ]

        let snapshot = TerminalSnapshot(sessionId: "unicode", header: nil, events: events)

        #expect(snapshot.events[0].data == "Hello 👋\n")
        #expect(snapshot.events[1].data == "日本語テスト\n")
        #expect(snapshot.events[2].data == "Émojis: 🎉🎊🎈\n")

        let preview = snapshot.outputPreview
        #expect(preview.contains("👋"))
        #expect(preview.contains("日本語"))
        #expect(preview.contains("🎉"))
    }

    @Test("Complex ANSI sequence removal")
    func complexANSIRemoval() {
        let events = [
            AsciinemaEvent(time: 0.0, type: .output, data: "\u{001B}[2J\u{001B}[H"), // Clear screen and home
            AsciinemaEvent(time: 1.0, type: .output, data: "\u{001B}[?25l"), // Hide cursor
            AsciinemaEvent(time: 2.0, type: .output, data: "\u{001B}[38;5;196mExtended color\u{001B}[0m\n"),
            AsciinemaEvent(time: 3.0, type: .output, data: "\u{001B}[48;2;255;0;0mRGB background\u{001B}[0m\n")
        ]

        let snapshot = TerminalSnapshot(sessionId: "ansi", header: nil, events: events)
        let clean = snapshot.cleanOutputPreview

        // Should remove all ANSI sequences
        #expect(clean.contains("Extended color"))
        #expect(clean.contains("RGB background"))
        #expect(!clean.contains("\u{001B}"))
        #expect(!clean.contains("38;5;196"))
        #expect(!clean.contains("48;2;255"))
    }

    @Test("Large output truncation")
    func largeOutputTruncation() {
        // Create many events
        var events: [AsciinemaEvent] = []
        for i in 1...100 {
            events.append(AsciinemaEvent(time: Double(i), type: .output, data: "Line \(i)\n"))
        }

        let snapshot = TerminalSnapshot(sessionId: "large", header: nil, events: events)
        let preview = snapshot.outputPreview

        // Should include last 4 lines based on the implementation
        #expect(preview.contains("Line 97"))
        #expect(preview.contains("Line 98"))
        #expect(preview.contains("Line 99"))
        #expect(preview.contains("Line 100"))
        #expect(!preview.contains("Line 1"))
        #expect(!preview.contains("Line 50"))
    }

    @Test("Event filtering by type")
    func eventFilteringByType() {
        let events = [
            AsciinemaEvent(time: 0.0, type: .output, data: "Output 1\n"),
            AsciinemaEvent(time: 1.0, type: .input, data: "ls"),
            AsciinemaEvent(time: 2.0, type: .output, data: "Output 2\n"),
            AsciinemaEvent(time: 3.0, type: .resize, data: "80x24")
        ]
        
        let snapshot = TerminalSnapshot(sessionId: "mixed", header: nil, events: events)
        
        // Output preview should only include output events
        let preview = snapshot.outputPreview
        #expect(preview.contains("Output 1"))
        #expect(preview.contains("Output 2"))
        #expect(!preview.contains("ls"))
        #expect(!preview.contains("80x24"))
    }

    @Test("Header information preservation")
    func headerInformationPreservation() {
        let header = AsciinemaHeader(
            version: 2,
            width: 120,
            height: 40,
            timestamp: 1700000000,
            duration: nil,
            command: nil,
            title: "Test Recording",
            env: ["SHELL": "/bin/zsh", "TERM": "xterm-256color"]
        )
        
        let snapshot = TerminalSnapshot(sessionId: "header-test", header: header, events: [])
        
        #expect(snapshot.header?.version == 2)
        #expect(snapshot.header?.width == 120)
        #expect(snapshot.header?.height == 40)
        #expect(snapshot.header?.timestamp == 1700000000)
        #expect(snapshot.header?.title == "Test Recording")
        #expect(snapshot.header?.env?["SHELL"] == "/bin/zsh")
        #expect(snapshot.header?.env?["TERM"] == "xterm-256color")
    }
}