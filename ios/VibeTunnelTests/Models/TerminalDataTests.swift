import Foundation
import Testing
@testable import VibeTunnel

@Suite("TerminalData Tests", .tags(.models))
struct TerminalDataTests {
    // MARK: - TerminalEvent Tests

    @Test("Parse header event")
    func parseHeaderEvent() throws {
        let headerJSON = """
        {
            "version": 2,
            "width": 80,
            "height": 24,
            "timestamp": 1234567890.5,
            "duration": 120.5,
            "command": "/bin/bash",
            "title": "Test Session",
            "env": {"TERM": "xterm-256color", "SHELL": "/bin/bash"}
        }
        """

        let event = TerminalEvent(from: headerJSON)
        #expect(event != nil)

        if case .header(let header) = event {
            #expect(header.version == 2)
            #expect(header.width == 80)
            #expect(header.height == 24)
            #expect(header.timestamp == 1_234_567_890.5)
            #expect(header.duration == 120.5)
            #expect(header.command == "/bin/bash")
            #expect(header.title == "Test Session")
            #expect(header.env?["TERM"] == "xterm-256color")
            #expect(header.env?["SHELL"] == "/bin/bash")
        } else {
            Issue.record("Expected header event but got \(String(describing: event))")
        }
    }

    @Test("Parse minimal header event")
    func parseMinimalHeaderEvent() throws {
        let headerJSON = """
        {
            "version": 2,
            "width": 80,
            "height": 24
        }
        """

        let event = TerminalEvent(from: headerJSON)
        #expect(event != nil)

        if case .header(let header) = event {
            #expect(header.version == 2)
            #expect(header.width == 80)
            #expect(header.height == 24)
            #expect(header.timestamp == nil)
            #expect(header.duration == nil)
            #expect(header.command == nil)
            #expect(header.title == nil)
            #expect(header.env == nil)
        } else {
            Issue.record("Expected header event but got \(String(describing: event))")
        }
    }

    @Test("Parse output event")
    func parseOutputEvent() throws {
        let outputJSON = "[1.5, \"o\", \"Hello, world!\\r\\n\"]"

        let event = TerminalEvent(from: outputJSON)
        #expect(event != nil)

        if case .output(let timestamp, let data) = event {
            #expect(timestamp == 1.5)
            #expect(data == "Hello, world!\r\n")
        } else {
            Issue.record("Expected output event but got \(String(describing: event))")
        }
    }

    @Test("Parse resize event")
    func parseResizeEvent() throws {
        let resizeJSON = "[2.5, \"r\", \"80x25\"]"

        let event = TerminalEvent(from: resizeJSON)
        #expect(event != nil)

        if case .resize(let timestamp, let dimensions) = event {
            #expect(timestamp == 2.5)
            #expect(dimensions == "80x25")
        } else {
            Issue.record("Expected resize event but got \(String(describing: event))")
        }
    }

    @Test("Parse exit event")
    func parseExitEvent() throws {
        let exitJSON = "[\"exit\", 0, \"test-session-123\"]"

        let event = TerminalEvent(from: exitJSON)
        #expect(event != nil)

        if case .exit(let code, let sessionId) = event {
            #expect(code == 0)
            #expect(sessionId == "test-session-123")
        } else {
            Issue.record("Expected exit event but got \(String(describing: event))")
        }
    }

    @Test("Parse exit event with non-zero code")
    func parseExitEventNonZero() throws {
        let exitJSON = "[\"exit\", 127, \"error-session\"]"

        let event = TerminalEvent(from: exitJSON)
        #expect(event != nil)

        if case .exit(let code, let sessionId) = event {
            #expect(code == 127)
            #expect(sessionId == "error-session")
        } else {
            Issue.record("Expected exit event but got \(String(describing: event))")
        }
    }

    @Test("Invalid JSON returns nil")
    func invalidJSON() throws {
        let invalidJSON = "not valid json"
        let event = TerminalEvent(from: invalidJSON)
        #expect(event == nil)
    }

    @Test("Invalid event type returns nil")
    func invalidEventType() throws {
        let invalidEvent = "[1.0, \"x\", \"unknown type\"]"
        let event = TerminalEvent(from: invalidEvent)
        #expect(event == nil)
    }

    @Test("Missing array elements returns nil")
    func missingArrayElements() throws {
        let incompleteEvent = "[1.0, \"o\"]"
        let event = TerminalEvent(from: incompleteEvent)
        #expect(event == nil)
    }

    @Test("Wrong data types in array returns nil")
    func wrongDataTypes() throws {
        let wrongTypes = "[\"not-a-number\", \"o\", \"data\"]"
        let event = TerminalEvent(from: wrongTypes)
        #expect(event == nil)
    }

    @Test("Empty string returns nil")
    func emptyString() throws {
        let event = TerminalEvent(from: "")
        #expect(event == nil)
    }

    @Test("Array with wrong exit format returns nil")
    func wrongExitFormat() throws {
        // Wrong first element
        let wrongExit1 = "[\"not-exit\", 0, \"session\"]"
        #expect(TerminalEvent(from: wrongExit1) == nil)

        // Wrong second element type
        let wrongExit2 = "[\"exit\", \"not-a-number\", \"session\"]"
        #expect(TerminalEvent(from: wrongExit2) == nil)

        // Wrong third element type
        let wrongExit3 = "[\"exit\", 0, 123]"
        #expect(TerminalEvent(from: wrongExit3) == nil)

        // Too few elements
        let wrongExit4 = "[\"exit\", 0]"
        #expect(TerminalEvent(from: wrongExit4) == nil)

        // Too many elements
        let wrongExit5 = "[\"exit\", 0, \"session\", \"extra\"]"
        #expect(TerminalEvent(from: wrongExit5) == nil)
    }

    // MARK: - AsciinemaHeader Tests

    @Test("Encode and decode header")
    func encodeDecodeHeader() throws {
        let header = AsciinemaHeader(
            version: 2,
            width: 120,
            height: 40,
            timestamp: 1_234_567_890.123,
            duration: 300.5,
            command: "/bin/zsh",
            title: "My Terminal Session",
            env: ["TERM": "xterm-256color", "USER": "testuser"]
        )

        let encoder = JSONEncoder()
        let data = try encoder.encode(header)

        let decoder = JSONDecoder()
        let decodedHeader = try decoder.decode(AsciinemaHeader.self, from: data)

        #expect(decodedHeader.version == header.version)
        #expect(decodedHeader.width == header.width)
        #expect(decodedHeader.height == header.height)
        #expect(decodedHeader.timestamp == header.timestamp)
        #expect(decodedHeader.duration == header.duration)
        #expect(decodedHeader.command == header.command)
        #expect(decodedHeader.title == header.title)
        #expect(decodedHeader.env?["TERM"] == header.env?["TERM"])
        #expect(decodedHeader.env?["USER"] == header.env?["USER"])
    }

    // MARK: - TerminalInput Tests

    @Test("Create input from text")
    func createInputFromText() {
        let input = TerminalInput(text: "Hello, world!")
        #expect(input.text == "Hello, world!")
    }

    @Test("Create input from special keys")
    func createInputFromSpecialKeys() {
        // Arrow keys
        let arrowUp = TerminalInput(specialKey: .arrowUp)
        #expect(arrowUp.text == "\u{001B}[A")

        let arrowDown = TerminalInput(specialKey: .arrowDown)
        #expect(arrowDown.text == "\u{001B}[B")

        let arrowRight = TerminalInput(specialKey: .arrowRight)
        #expect(arrowRight.text == "\u{001B}[C")

        let arrowLeft = TerminalInput(specialKey: .arrowLeft)
        #expect(arrowLeft.text == "\u{001B}[D")

        // Special keys
        let escape = TerminalInput(specialKey: .escape)
        #expect(escape.text == "\u{001B}")

        let enter = TerminalInput(specialKey: .enter)
        #expect(enter.text == "\r")

        let tab = TerminalInput(specialKey: .tab)
        #expect(tab.text == "\t")

        // Control keys
        let ctrlC = TerminalInput(specialKey: .ctrlC)
        #expect(ctrlC.text == "\u{0003}")

        let ctrlD = TerminalInput(specialKey: .ctrlD)
        #expect(ctrlD.text == "\u{0004}")

        let ctrlZ = TerminalInput(specialKey: .ctrlZ)
        #expect(ctrlZ.text == "\u{001A}")

        let ctrlL = TerminalInput(specialKey: .ctrlL)
        #expect(ctrlL.text == "\u{000C}")

        let ctrlA = TerminalInput(specialKey: .ctrlA)
        #expect(ctrlA.text == "\u{0001}")

        let ctrlE = TerminalInput(specialKey: .ctrlE)
        #expect(ctrlE.text == "\u{0005}")

        // Web compatibility keys
        let ctrlEnter = TerminalInput(specialKey: .ctrlEnter)
        #expect(ctrlEnter.text == "ctrl_enter")

        let shiftEnter = TerminalInput(specialKey: .shiftEnter)
        #expect(shiftEnter.text == "shift_enter")
    }

    @Test("Encode and decode terminal input")
    func encodeDecodeTerminalInput() throws {
        let input = TerminalInput(text: "test input")

        let encoder = JSONEncoder()
        let data = try encoder.encode(input)

        let decoder = JSONDecoder()
        let decodedInput = try decoder.decode(TerminalInput.self, from: data)

        #expect(decodedInput.text == input.text)
    }

    // MARK: - TerminalResize Tests

    @Test("Create and encode terminal resize")
    func createEncodeTerminalResize() throws {
        let resize = TerminalResize(cols: 100, rows: 50)
        #expect(resize.cols == 100)
        #expect(resize.rows == 50)

        let encoder = JSONEncoder()
        let data = try encoder.encode(resize)

        let decoder = JSONDecoder()
        let decodedResize = try decoder.decode(TerminalResize.self, from: data)

        #expect(decodedResize.cols == resize.cols)
        #expect(decodedResize.rows == resize.rows)
    }

    @Test("Edge cases for terminal dimensions")
    func terminalDimensionEdgeCases() throws {
        // Minimum dimensions
        let minResize = TerminalResize(cols: 1, rows: 1)
        #expect(minResize.cols == 1)
        #expect(minResize.rows == 1)

        // Large dimensions
        let largeResize = TerminalResize(cols: 999, rows: 999)
        #expect(largeResize.cols == 999)
        #expect(largeResize.rows == 999)

        // Zero dimensions (though typically invalid in practice)
        let zeroResize = TerminalResize(cols: 0, rows: 0)
        #expect(zeroResize.cols == 0)
        #expect(zeroResize.rows == 0)
    }
}
