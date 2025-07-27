import XCTest
@testable import VibeTunnel

final class ServerEventTests: XCTestCase {
    
    // MARK: - Codable Tests
    
    func testServerEventCodableRoundTrip() throws {
        let originalEvent = ServerEvent(
            type: .sessionStart,
            sessionId: "test-session-123",
            sessionName: "Test Session",
            command: "ls -la",
            exitCode: nil,
            duration: nil,
            processInfo: nil,
            message: "Session started successfully"
        )
        
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()
        
        let data = try encoder.encode(originalEvent)
        let decodedEvent = try decoder.decode(ServerEvent.self, from: data)
        
        XCTAssertEqual(originalEvent.type, decodedEvent.type)
        XCTAssertEqual(originalEvent.sessionId, decodedEvent.sessionId)
        XCTAssertEqual(originalEvent.sessionName, decodedEvent.sessionName)
        XCTAssertEqual(originalEvent.command, decodedEvent.command)
        XCTAssertEqual(originalEvent.message, decodedEvent.message)
    }
    
    func testServerEventWithAllFields() throws {
        let event = ServerEvent(
            type: .commandFinished,
            sessionId: "session-456",
            sessionName: "Long Running Command",
            command: "npm install",
            exitCode: 0,
            duration: 15000,
            processInfo: "Node.js process",
            message: "Command completed successfully"
        )
        
        let data = try JSONEncoder().encode(event)
        let decoded = try JSONDecoder().decode(ServerEvent.self, from: data)
        
        XCTAssertEqual(decoded.type, .commandFinished)
        XCTAssertEqual(decoded.sessionId, "session-456")
        XCTAssertEqual(decoded.sessionName, "Long Running Command")
        XCTAssertEqual(decoded.command, "npm install")
        XCTAssertEqual(decoded.exitCode, 0)
        XCTAssertEqual(decoded.duration, 15000)
        XCTAssertEqual(decoded.processInfo, "Node.js process")
        XCTAssertEqual(decoded.message, "Command completed successfully")
    }
    
    func testServerEventWithMinimalFields() throws {
        let event = ServerEvent(type: .bell)
        
        let data = try JSONEncoder().encode(event)
        let decoded = try JSONDecoder().decode(ServerEvent.self, from: data)
        
        XCTAssertEqual(decoded.type, .bell)
        XCTAssertNil(decoded.sessionId)
        XCTAssertNil(decoded.sessionName)
        XCTAssertNil(decoded.command)
        XCTAssertNil(decoded.exitCode)
        XCTAssertNil(decoded.duration)
        XCTAssertNil(decoded.processInfo)
        XCTAssertNil(decoded.message)
        XCTAssertNotNil(decoded.timestamp)
    }
    
    // MARK: - Event Type Tests
    
    func testAllEventTypes() {
        let eventTypes: [ServerEventType] = [
            .sessionStart,
            .sessionExit,
            .commandFinished,
            .commandError,
            .bell,
            .claudeTurn,
            .connected
        ]
        
        for eventType in eventTypes {
            let event = ServerEvent(type: eventType)
            XCTAssertEqual(event.type, eventType)
        }
    }
    
    func testEventTypeRawValues() {
        XCTAssertEqual(ServerEventType.sessionStart.rawValue, "session-start")
        XCTAssertEqual(ServerEventType.sessionExit.rawValue, "session-exit")
        XCTAssertEqual(ServerEventType.commandFinished.rawValue, "command-finished")
        XCTAssertEqual(ServerEventType.commandError.rawValue, "command-error")
        XCTAssertEqual(ServerEventType.bell.rawValue, "bell")
        XCTAssertEqual(ServerEventType.claudeTurn.rawValue, "claude-turn")
        XCTAssertEqual(ServerEventType.connected.rawValue, "connected")
    }
    
    func testEventTypeDescriptions() {
        XCTAssertEqual(ServerEventType.sessionStart.description, "Session Started")
        XCTAssertEqual(ServerEventType.sessionExit.description, "Session Ended")
        XCTAssertEqual(ServerEventType.commandFinished.description, "Command Completed")
        XCTAssertEqual(ServerEventType.commandError.description, "Command Error")
        XCTAssertEqual(ServerEventType.bell.description, "Terminal Bell")
        XCTAssertEqual(ServerEventType.claudeTurn.description, "Your Turn")
        XCTAssertEqual(ServerEventType.connected.description, "Connected")
    }
    
    func testEventTypeShouldNotify() {
        XCTAssertTrue(ServerEventType.sessionStart.shouldNotify)
        XCTAssertTrue(ServerEventType.sessionExit.shouldNotify)
        XCTAssertTrue(ServerEventType.claudeTurn.shouldNotify)
        XCTAssertFalse(ServerEventType.commandFinished.shouldNotify)
        XCTAssertFalse(ServerEventType.commandError.shouldNotify)
        XCTAssertFalse(ServerEventType.bell.shouldNotify)
        XCTAssertFalse(ServerEventType.connected.shouldNotify)
    }
    
    // MARK: - Edge Cases
    
    func testServerEventWithEmptyStrings() throws {
        let event = ServerEvent(
            type: .sessionStart,
            sessionId: "",
            sessionName: "",
            command: "",
            message: ""
        )
        
        let data = try JSONEncoder().encode(event)
        let decoded = try JSONDecoder().decode(ServerEvent.self, from: data)
        
        XCTAssertEqual(decoded.sessionId, "")
        XCTAssertEqual(decoded.sessionName, "")
        XCTAssertEqual(decoded.command, "")
        XCTAssertEqual(decoded.message, "")
    }
    
    func testServerEventWithSpecialCharacters() throws {
        let event = ServerEvent(
            type: .commandError,
            sessionId: "session-123",
            sessionName: "Test Session with \"quotes\" and 'apostrophes'",
            command: "echo 'Hello, World!' && echo \"Test\"",
            exitCode: -1,
            message: "Error: Command failed with special chars: <>&\"'"
        )
        
        let data = try JSONEncoder().encode(event)
        let decoded = try JSONDecoder().decode(ServerEvent.self, from: data)
        
        XCTAssertEqual(decoded.sessionName, "Test Session with \"quotes\" and 'apostrophes'")
        XCTAssertEqual(decoded.command, "echo 'Hello, World!' && echo \"Test\"")
        XCTAssertEqual(decoded.message, "Error: Command failed with special chars: <>&\"'")
    }
    
    // MARK: - Performance Tests
    
    func testServerEventEncodingPerformance() throws {
        let event = ServerEvent(
            type: .sessionStart,
            sessionId: "performance-test-session",
            sessionName: "Performance Test Session",
            command: "long command with many arguments",
            duration: 5000,
            message: "Performance test message"
        )
        
        measure {
            for _ in 0..<1000 {
                _ = try? JSONEncoder().encode(event)
            }
        }
    }
    
    func testServerEventDecodingPerformance() throws {
        let event = ServerEvent(
            type: .commandFinished,
            sessionId: "perf-session",
            sessionName: "Performance Session",
            command: "test command",
            duration: 1000
        )
        
        let data = try JSONEncoder().encode(event)
        
        measure {
            for _ in 0..<1000 {
                _ = try? JSONDecoder().decode(ServerEvent.self, from: data)
            }
        }
    }
    
    // MARK: - Convenience Initializers Tests
    
    func testSessionStartConvenienceInitializer() {
        let event = ServerEvent.sessionStart(
            sessionId: "test-123",
            sessionName: "Test Session",
            command: "ls -la"
        )
        
        XCTAssertEqual(event.type, .sessionStart)
        XCTAssertEqual(event.sessionId, "test-123")
        XCTAssertEqual(event.sessionName, "Test Session")
        XCTAssertEqual(event.command, "ls -la")
        XCTAssertTrue(event.shouldNotify)
    }
    
    func testSessionExitConvenienceInitializer() {
        let event = ServerEvent.sessionExit(
            sessionId: "test-456",
            sessionName: "Test Session",
            exitCode: 0
        )
        
        XCTAssertEqual(event.type, .sessionExit)
        XCTAssertEqual(event.sessionId, "test-456")
        XCTAssertEqual(event.sessionName, "Test Session")
        XCTAssertEqual(event.exitCode, 0)
        XCTAssertTrue(event.shouldNotify)
    }
    
    func testCommandFinishedConvenienceInitializer() {
        let event = ServerEvent.commandFinished(
            sessionId: "test-789",
            command: "npm install",
            duration: 15000,
            exitCode: 0
        )
        
        XCTAssertEqual(event.type, .commandFinished)
        XCTAssertEqual(event.sessionId, "test-789")
        XCTAssertEqual(event.command, "npm install")
        XCTAssertEqual(event.duration, 15000)
        XCTAssertEqual(event.exitCode, 0)
        XCTAssertFalse(event.shouldNotify)
    }
    
    func testClaudeTurnConvenienceInitializer() {
        let event = ServerEvent.claudeTurn(
            sessionId: "claude-session",
            sessionName: "Claude Chat"
        )
        
        XCTAssertEqual(event.type, .claudeTurn)
        XCTAssertEqual(event.sessionId, "claude-session")
        XCTAssertEqual(event.sessionName, "Claude Chat")
        XCTAssertEqual(event.message, "Claude has finished responding")
        XCTAssertTrue(event.shouldNotify)
    }
    
    func testBellConvenienceInitializer() {
        let event = ServerEvent.bell(sessionId: "bell-session")
        
        XCTAssertEqual(event.type, .bell)
        XCTAssertEqual(event.sessionId, "bell-session")
        XCTAssertEqual(event.message, "Terminal bell")
        XCTAssertFalse(event.shouldNotify)
    }
    
    // MARK: - Computed Properties Tests
    
    func testDisplayName() {
        let event1 = ServerEvent(type: .sessionStart, sessionName: "My Session")
        XCTAssertEqual(event1.displayName, "My Session")
        
        let event2 = ServerEvent(type: .sessionStart, command: "ls -la")
        XCTAssertEqual(event2.displayName, "ls -la")
        
        let event3 = ServerEvent(type: .sessionStart, sessionId: "session-123")
        XCTAssertEqual(event3.displayName, "session-123")
        
        let event4 = ServerEvent(type: .sessionStart)
        XCTAssertEqual(event4.displayName, "Unknown Session")
    }
    
    func testFormattedDuration() {
        let event1 = ServerEvent(type: .commandFinished, duration: 500)
        XCTAssertEqual(event1.formattedDuration, "500ms")
        
        let event2 = ServerEvent(type: .commandFinished, duration: 2500)
        XCTAssertEqual(event2.formattedDuration, "2.5s")
        
        let event3 = ServerEvent(type: .commandFinished, duration: 125000)
        XCTAssertEqual(event3.formattedDuration, "2m 5s")
        
        let event4 = ServerEvent(type: .sessionStart)
        XCTAssertNil(event4.formattedDuration)
    }
    
    func testFormattedTimestamp() {
        let timestamp = Date()
        let event = ServerEvent(type: .sessionStart, timestamp: timestamp)
        
        let formatter = DateFormatter()
        formatter.timeStyle = .medium
        let expected = formatter.string(from: timestamp)
        
        XCTAssertEqual(event.formattedTimestamp, expected)
    }
    
    func testIdentifiable() {
        let event1 = ServerEvent(type: .sessionStart)
        let event2 = ServerEvent(type: .sessionStart)
        
        XCTAssertNotEqual(event1.id, event2.id)
        XCTAssertNotNil(event1.id)
        XCTAssertNotNil(event2.id)
    }
    
    func testEquatable() {
        let timestamp = Date()
        let event1 = ServerEvent(type: .sessionStart, sessionId: "test", timestamp: timestamp)
        let event2 = ServerEvent(type: .sessionStart, sessionId: "test", timestamp: timestamp)
        let event3 = ServerEvent(type: .sessionExit, sessionId: "test", timestamp: timestamp)
        
        XCTAssertEqual(event1, event2)
        XCTAssertNotEqual(event1, event3)
    }
} 