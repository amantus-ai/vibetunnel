import Testing
import Foundation
@testable import VibeTunnel

@Suite("ServerEvent")
struct ServerEventTests {
    
    // MARK: - Codable Tests
    // These are valuable - testing JSON encoding/decoding with optional fields
    
    @Test("Codable round-trip with multiple optional fields")
    func codableRoundTrip() throws {
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
        
        let data = try JSONEncoder().encode(originalEvent)
        let decodedEvent = try JSONDecoder().decode(ServerEvent.self, from: data)
        
        #expect(originalEvent.type == decodedEvent.type)
        #expect(originalEvent.sessionId == decodedEvent.sessionId)
        #expect(originalEvent.sessionName == decodedEvent.sessionName)
        #expect(originalEvent.command == decodedEvent.command)
        #expect(originalEvent.message == decodedEvent.message)
    }
    
    @Test("Codable with all fields populated")
    func codableWithAllFields() throws {
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
        
        #expect(decoded.type == .commandFinished)
        #expect(decoded.sessionId == "session-456")
        #expect(decoded.sessionName == "Long Running Command")
        #expect(decoded.command == "npm install")
        #expect(decoded.exitCode == 0)
        #expect(decoded.duration == 15000)
        #expect(decoded.processInfo == "Node.js process")
        #expect(decoded.message == "Command completed successfully")
    }
    
    @Test("Codable with minimal fields preserves nils")
    func codableWithMinimalFields() throws {
        let event = ServerEvent(type: .bell)
        
        let data = try JSONEncoder().encode(event)
        let decoded = try JSONDecoder().decode(ServerEvent.self, from: data)
        
        #expect(decoded.type == .bell)
        #expect(decoded.sessionId == nil)
        #expect(decoded.sessionName == nil)
        #expect(decoded.command == nil)
        #expect(decoded.exitCode == nil)
        #expect(decoded.duration == nil)
        #expect(decoded.processInfo == nil)
        #expect(decoded.message == nil)
        #expect(decoded.timestamp != nil)
    }
    
    // MARK: - Event Type Logic Tests
    // Testing actual business logic, not Swift's enum implementation
    
    @Test("Event type descriptions are user-friendly")
    func eventTypeDescriptions() {
        #expect(ServerEventType.sessionStart.description == "Session Started")
        #expect(ServerEventType.sessionExit.description == "Session Ended")
        #expect(ServerEventType.commandFinished.description == "Command Completed")
        #expect(ServerEventType.commandError.description == "Command Error")
        #expect(ServerEventType.bell.description == "Terminal Bell")
        #expect(ServerEventType.claudeTurn.description == "Your Turn")
        #expect(ServerEventType.connected.description == "Connected")
    }
    
    @Test("shouldNotify returns correct values for notification logic")
    func eventTypeShouldNotify() {
        // These events should trigger notifications
        #expect(ServerEventType.sessionStart.shouldNotify)
        #expect(ServerEventType.sessionExit.shouldNotify)
        #expect(ServerEventType.claudeTurn.shouldNotify)
        
        // These events should not trigger notifications
        #expect(!ServerEventType.commandFinished.shouldNotify)
        #expect(!ServerEventType.commandError.shouldNotify)
        #expect(!ServerEventType.bell.shouldNotify)
        #expect(!ServerEventType.connected.shouldNotify)
    }
    
    // MARK: - Edge Cases
    // These test important edge cases for data integrity
    
    @Test("Handles empty strings correctly")
    func handlesEmptyStrings() throws {
        let event = ServerEvent(
            type: .sessionStart,
            sessionId: "",
            sessionName: "",
            command: "",
            message: ""
        )
        
        let data = try JSONEncoder().encode(event)
        let decoded = try JSONDecoder().decode(ServerEvent.self, from: data)
        
        // Empty strings should be preserved, not converted to nil
        #expect(decoded.sessionId == "")
        #expect(decoded.sessionName == "")
        #expect(decoded.command == "")
        #expect(decoded.message == "")
    }
    
    @Test("Handles special characters in JSON encoding")
    func handlesSpecialCharacters() throws {
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
        
        #expect(decoded.sessionName == "Test Session with \"quotes\" and 'apostrophes'")
        #expect(decoded.command == "echo 'Hello, World!' && echo \"Test\"")
        #expect(decoded.message == "Error: Command failed with special chars: <>&\"'")
    }
    
    // MARK: - Convenience Initializers
    // These test that convenience initializers create properly configured events
    
    @Test("sessionStart convenience initializer sets correct fields")
    func sessionStartInitializer() {
        let event = ServerEvent.sessionStart(
            sessionId: "test-123",
            sessionName: "Test Session",
            command: "ls -la"
        )
        
        #expect(event.type == .sessionStart)
        #expect(event.sessionId == "test-123")
        #expect(event.sessionName == "Test Session")
        #expect(event.command == "ls -la")
        #expect(event.shouldNotify)
    }
    
    @Test("sessionExit convenience initializer sets correct fields")
    func sessionExitInitializer() {
        let event = ServerEvent.sessionExit(
            sessionId: "test-456",
            sessionName: "Test Session",
            exitCode: 0
        )
        
        #expect(event.type == .sessionExit)
        #expect(event.sessionId == "test-456")
        #expect(event.sessionName == "Test Session")
        #expect(event.exitCode == 0)
        #expect(event.shouldNotify)
    }
    
    @Test("commandFinished convenience initializer sets correct fields")
    func commandFinishedInitializer() {
        let event = ServerEvent.commandFinished(
            sessionId: "test-789",
            command: "npm install",
            duration: 15000,
            exitCode: 0
        )
        
        #expect(event.type == .commandFinished)
        #expect(event.sessionId == "test-789")
        #expect(event.command == "npm install")
        #expect(event.duration == 15000)
        #expect(event.exitCode == 0)
        #expect(!event.shouldNotify)
    }
    
    @Test("claudeTurn convenience initializer includes default message")
    func claudeTurnInitializer() {
        let event = ServerEvent.claudeTurn(
            sessionId: "claude-session",
            sessionName: "Claude Chat"
        )
        
        #expect(event.type == .claudeTurn)
        #expect(event.sessionId == "claude-session")
        #expect(event.sessionName == "Claude Chat")
        #expect(event.message == "Claude has finished responding")
        #expect(event.shouldNotify)
    }
    
    @Test("bell convenience initializer includes default message")
    func bellInitializer() {
        let event = ServerEvent.bell(sessionId: "bell-session")
        
        #expect(event.type == .bell)
        #expect(event.sessionId == "bell-session")
        #expect(event.message == "Terminal bell")
        #expect(!event.shouldNotify)
    }
    
    // MARK: - Computed Properties with Logic
    // These test actual business logic in computed properties
    
    @Test("displayName fallback logic works correctly")
    func displayNameLogic() {
        // Priority 1: Session name
        let event1 = ServerEvent(type: .sessionStart, sessionName: "My Session")
        #expect(event1.displayName == "My Session")
        
        // Priority 2: Command (when no session name)
        let event2 = ServerEvent(type: .sessionStart, command: "ls -la")
        #expect(event2.displayName == "ls -la")
        
        // Priority 3: Session ID (when no name or command)
        let event3 = ServerEvent(type: .sessionStart, sessionId: "session-123")
        #expect(event3.displayName == "session-123")
        
        // Fallback: Unknown Session
        let event4 = ServerEvent(type: .sessionStart)
        #expect(event4.displayName == "Unknown Session")
    }
    
    @Test("formattedDuration handles different time ranges", arguments: [
        (500, "500ms"),
        (2500, "2.5s"),
        (125000, "2m 5s"),
        (3661000, "1h 1m 1s")
    ])
    func formattedDurationLogic(duration: Int, expected: String) {
        let event = ServerEvent(type: .commandFinished, duration: duration)
        #expect(event.formattedDuration == expected)
    }
    
    @Test("formattedDuration returns nil when duration is nil")
    func formattedDurationNil() {
        let event = ServerEvent(type: .sessionStart)
        #expect(event.formattedDuration == nil)
    }
    
    @Test("formattedTimestamp uses correct format")
    func formattedTimestampFormat() {
        let timestamp = Date()
        let event = ServerEvent(type: .sessionStart, timestamp: timestamp)
        
        let formatter = DateFormatter()
        formatter.timeStyle = .medium
        let expected = formatter.string(from: timestamp)
        
        #expect(event.formattedTimestamp == expected)
    }
}