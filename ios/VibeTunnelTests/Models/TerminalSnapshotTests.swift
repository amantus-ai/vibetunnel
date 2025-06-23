import Foundation
import Testing
@testable import VibeTunnel

@Suite("TerminalSnapshot Tests", .tags(.models))
struct TerminalSnapshotTests {

    @Test("Terminal snapshot initialization")
    func terminalSnapshotInit() {
        let lines = [
            "Line 1",
            "Line 2 with some text",
            "Line 3"
        ]

        let snapshot = TerminalSnapshot(lines: lines, sessionId: "test-session")

        #expect(snapshot.sessionId == "test-session")
        #expect(snapshot.lines == lines)
        #expect(snapshot.lines.count == 3)
    }

    @Test("Output preview generation")
    func outputPreview() {
        let lines = [
            "First line",
            "Second line",
            "Third line",
            "Fourth line",
            "Fifth line"
        ]

        let snapshot = TerminalSnapshot(lines: lines, sessionId: "test")
        let preview = snapshot.outputPreview

        #expect(preview.contains("First line"))
        #expect(preview.contains("Second line"))
        #expect(preview.contains("Third line"))

        // Should be limited to first 3 lines
        #expect(!preview.contains("Fourth line"))
        #expect(!preview.contains("Fifth line"))
    }

    @Test("Clean output preview removes ANSI codes")
    func cleanOutputPreview() {
        let lines = [
            "\u{001B}[31mRed text\u{001B}[0m",
            "\u{001B}[1;32mBold green\u{001B}[0m",
            "Normal text"
        ]

        let snapshot = TerminalSnapshot(lines: lines, sessionId: "test")
        let cleanPreview = snapshot.cleanOutputPreview

        #expect(cleanPreview.contains("Red text"))
        #expect(cleanPreview.contains("Bold green"))
        #expect(cleanPreview.contains("Normal text"))

        // Should not contain ANSI escape codes
        #expect(!cleanPreview.contains("\u{001B}"))
        #expect(!cleanPreview.contains("[31m"))
        #expect(!cleanPreview.contains("[0m"))
    }

    @Test("Empty lines handling")
    func emptyLinesHandling() {
        let snapshot = TerminalSnapshot(lines: [], sessionId: "empty")

        #expect(snapshot.lines.isEmpty)
        #expect(snapshot.outputPreview.isEmpty)
        #expect(snapshot.cleanOutputPreview.isEmpty)
    }

    @Test("Single line snapshot")
    func singleLineSnapshot() {
        let snapshot = TerminalSnapshot(lines: ["Single line"], sessionId: "single")

        #expect(snapshot.lines.count == 1)
        #expect(snapshot.outputPreview == "Single line")
        #expect(snapshot.cleanOutputPreview == "Single line")
    }

    @Test("Whitespace preservation")
    func whitespacePreservation() {
        let lines = [
            "  Indented line",
            "\tTab indented",
            "Multiple   spaces"
        ]

        let snapshot = TerminalSnapshot(lines: lines, sessionId: "whitespace")

        #expect(snapshot.lines[0] == "  Indented line")
        #expect(snapshot.lines[1] == "\tTab indented")
        #expect(snapshot.lines[2] == "Multiple   spaces")
    }

    @Test("Unicode content handling")
    func unicodeContent() {
        let lines = [
            "Hello 👋",
            "日本語テスト",
            "Émojis: 🎉🎊🎈"
        ]

        let snapshot = TerminalSnapshot(lines: lines, sessionId: "unicode")

        #expect(snapshot.lines[0] == "Hello 👋")
        #expect(snapshot.lines[1] == "日本語テスト")
        #expect(snapshot.lines[2] == "Émojis: 🎉🎊🎈")

        let preview = snapshot.outputPreview
        #expect(preview.contains("👋"))
        #expect(preview.contains("日本語"))
        #expect(preview.contains("🎉"))
    }

    @Test("Complex ANSI sequence removal")
    func complexANSIRemoval() {
        let lines = [
            "\u{001B}[2J\u{001B}[H", // Clear screen and home
            "\u{001B}[?25l", // Hide cursor
            "\u{001B}[38;5;196mExtended color\u{001B}[0m",
            "\u{001B}[48;2;255;0;0mRGB background\u{001B}[0m"
        ]

        let snapshot = TerminalSnapshot(lines: lines, sessionId: "ansi")
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
        // Create many lines
        var lines: [String] = []
        for i in 1...100 {
            lines.append("Line \(i)")
        }

        let snapshot = TerminalSnapshot(lines: lines, sessionId: "large")
        let preview = snapshot.outputPreview

        // Should only include first 3 lines
        #expect(preview.contains("Line 1"))
        #expect(preview.contains("Line 2"))
        #expect(preview.contains("Line 3"))
        #expect(!preview.contains("Line 4"))
        #expect(!preview.contains("Line 100"))
    }
}
