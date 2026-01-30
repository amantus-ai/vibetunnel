import Foundation
import Testing
@testable import VibeTunnel

@Suite("Session Model Tests", .tags(.models))
struct SessionTests {
    @Test("Decodes valid session JSON")
    func decodeValidSession() throws {
        // Arrange
        let json = """
        {
            "id": "test-123",
            "command": ["/bin/bash"],
            "workingDir": "/Users/test",
            "name": "Test Session",
            "status": "running",
            "startedAt": "2024-01-01T10:00:00Z",
            "lastModified": "2024-01-01T10:05:00Z",
            "pid": 12345,
            "waiting": false,
            "width": 80,
            "height": 24
        }
        """

        // Act
        let data = json.data(using: .utf8)!
        let session = try JSONDecoder().decode(Session.self, from: data)

        // Assert
        #expect(session.id == "test-123")
        #expect(session.command == ["/bin/bash"])
        #expect(session.workingDir == "/Users/test")
        #expect(session.name == "Test Session")
        #expect(session.status == .running)
        #expect(session.pid == 12345)
        #expect(session.exitCode == nil)
        #expect(session.isRunning == true)
        #expect(session.width == 80)
        #expect(session.height == 24)
    }

    @Test("Decodes exited session JSON")
    func decodeExitedSession() throws {
        // Arrange
        let json = """
        {
            "id": "exited-456",
            "command": ["/usr/bin/echo"],
            "workingDir": "/tmp",
            "name": "Echo Command",
            "status": "exited",
            "exitCode": 0,
            "startedAt": "2024-01-01T09:00:00Z",
            "lastModified": "2024-01-01T09:00:05Z",
            "waiting": false,
            "width": 80,
            "height": 24
        }
        """

        // Act
        let data = json.data(using: .utf8)!
        let session = try JSONDecoder().decode(Session.self, from: data)

        // Assert
        #expect(session.id == "exited-456")
        #expect(session.status == .exited)
        #expect(session.pid == nil)
        #expect(session.exitCode == 0)
        #expect(session.isRunning == false)
    }

    @Test("Handles optional fields correctly")
    func optionalFields() throws {
        // Arrange - Minimal valid JSON
        let json = """
        {
            "id": "minimal",
            "command": ["ls"],
            "workingDir": "/",
            "status": "running",
            "startedAt": "2024-01-01T10:00:00Z"
        }
        """

        // Act
        let data = json.data(using: .utf8)!
        let session = try JSONDecoder().decode(Session.self, from: data)

        // Assert
        #expect(session.id == "minimal")
        #expect(session.name == nil)
        #expect(session.pid == nil)
        #expect(session.exitCode == nil)
        #expect(session.lastModified == nil)
        #expect(session.waiting == nil)
        #expect(session.width == nil)
        #expect(session.height == nil)
    }

    @Test("Computed property isRunning works correctly")
    func isRunningProperty() {
        // Test running session
        let runningSession = TestFixtures.validSession
        #expect(runningSession.isRunning == true)
        #expect(runningSession.status == .running)

        // Test exited session
        let exitedSession = TestFixtures.exitedSession
        #expect(exitedSession.isRunning == false)
        #expect(exitedSession.status == .exited)
    }

    @Test("Display name computed property")
    func testDisplayName() {
        // With custom name
        let namedSession = TestFixtures.validSession
        #expect(namedSession.displayName == "Test Session")

        // Without custom name
        let unnamedSession = Session(
            id: "unnamed-session",
            command: ["/bin/bash"],
            workingDir: "/Users/test",
            name: nil,
            status: .running,
            exitCode: nil,
            startedAt: "2024-01-01T10:00:00Z",
            lastModified: "2024-01-01T10:05:00Z",
            pid: 12345,
            width: 80,
            height: 24,
            waiting: false,
            source: nil,
            remoteId: nil,
            remoteName: nil,
            remoteUrl: nil)
        #expect(unnamedSession.displayName == "/bin/bash")
    }

    @Test("Formatted start time")
    func testFormattedStartTime() throws {
        // Test ISO8601 format
        let session = TestFixtures.validSession
        let formattedTime = session.formattedStartTime

        // Should format to a time string (exact format depends on locale)
        #expect(!formattedTime.isEmpty)
        #expect(formattedTime != session.startedAt) // Should be formatted, not raw
    }

    @Test("Decode array of sessions")
    func decodeSessionArray() throws {
        // Arrange
        let json = TestFixtures.sessionsJSON

        // Act
        let data = json.data(using: .utf8)!
        let sessions = try JSONDecoder().decode([Session].self, from: data)

        // Assert
        #expect(sessions.count == 2)
        #expect(sessions[0].id == "test-session-123")
        #expect(sessions[1].id == "exited-session-456")
        #expect(sessions[0].isRunning == true)
        #expect(sessions[1].isRunning == false)
    }

    @Test("Throws on invalid JSON")
    func invalidJSON() throws {
        // Arrange - Missing required fields
        let json = """
        {
            "id": "invalid",
            "workingDir": "/tmp"
        }
        """

        // Act & Assert
        let data = json.data(using: .utf8)!
        #expect(throws: Error.self) {
            try JSONDecoder().decode(Session.self, from: data)
        }
    }

    @Test("Session equality")
    func sessionEquality() {
        let session1 = TestFixtures.validSession
        var session2 = TestFixtures.validSession

        // Same ID = equal
        #expect(session1 == session2)

        // Different ID = not equal
        session2 = Session(
            id: "different-id",
            command: session1.command,
            workingDir: session1.workingDir,
            name: session1.name,
            status: session1.status,
            exitCode: session1.exitCode,
            startedAt: session1.startedAt,
            lastModified: session1.lastModified,
            pid: session1.pid,
            width: session1.width,
            height: session1.height,
            waiting: session1.waiting,
            source: session1.source,
            remoteId: session1.remoteId,
            remoteName: session1.remoteName,
            remoteUrl: session1.remoteUrl)
        #expect(session1 != session2)
    }

    @Test("Session is hashable")
    func sessionHashable() {
        let session1 = TestFixtures.validSession
        let session2 = TestFixtures.exitedSession

        var set = Set<Session>()
        set.insert(session1)
        set.insert(session2)

        #expect(set.count == 2)
        #expect(set.contains(session1))
        #expect(set.contains(session2))
    }
}

// MARK: - SessionCreateData Tests

@Suite("SessionCreateData Tests", .tags(.models))
struct SessionCreateDataTests {
    @Test("Encodes to correct JSON")
    func encoding() throws {
        // Arrange
        let data = SessionCreateData(
            command: "/bin/bash",
            workingDir: "/Users/test",
            name: "Test Session",
            cols: 80,
            rows: 24)

        // Act
        let jsonData = try JSONEncoder().encode(data)
        let decoded = try JSONDecoder().decode(SessionCreateData.self, from: jsonData)

        // Assert
        #expect(decoded.command == ["/bin/bash"])
        #expect(decoded.workingDir == "/Users/test")
        #expect(decoded.name == "Test Session")
        #expect(decoded.cols == 80)
        #expect(decoded.rows == 24)
        #expect(decoded.spawnTerminal == true) // Default is true, not false
    }

    @Test("Uses default terminal size")
    func defaultTerminalSize() {
        // Arrange & Act
        let data = SessionCreateData(
            command: "ls",
            workingDir: "/tmp")

        // Assert
        #expect(data.cols == 120) // Default is 120, not 80
        #expect(data.rows == 30) // Default is 30, not 24
        #expect(data.command == ["ls"])
        #expect(data.spawnTerminal == true)
    }

    @Test("Optional name field")
    func optionalName() throws {
        // Arrange
        let data = SessionCreateData(
            command: "ls",
            workingDir: "/tmp",
            name: nil)

        // Act
        let jsonData = try JSONEncoder().encode(data)
        let decoded = try JSONDecoder().decode(SessionCreateData.self, from: jsonData)

        // Assert
        #expect(decoded.name == nil)
    }
}
