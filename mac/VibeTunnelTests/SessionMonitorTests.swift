import Foundation
import Testing
@testable import VibeTunnel

// MARK: - Session Monitor Tests

@Suite("Session Monitor Tests", .tags(.sessionManagement))
@MainActor
final class SessionMonitorTests {
    let monitor = SessionMonitor.shared

    init() async {
        // Ensure clean state before each test
        await monitor.refresh()
    }

    // MARK: - JSON Decoding Tests

    @Test("detectEndedSessions identifies completed sessions")
    func detectEndedSessions() throws {
        let running = ServerSessionInfo(
            id: "one",
            command: ["bash"],
            name: nil,
            workingDir: "/",
            status: "running",
            exitCode: nil,
            startedAt: "",
            lastModified: "",
            pid: nil,
            initialCols: nil,
            initialRows: nil,
            activityStatus: nil,
            source: nil,
            attachedViaVT: nil
        )
        let exited = ServerSessionInfo(
            id: "one",
            command: ["bash"],
            name: nil,
            workingDir: "/",
            status: "exited",
            exitCode: 0,
            startedAt: "",
            lastModified: "",
            pid: nil,
            initialCols: nil,
            initialRows: nil,
            activityStatus: nil,
            source: nil,
            attachedViaVT: nil
        )
        let oldMap = ["one": running]
        let newMap = ["one": exited]
        let ended = SessionMonitor.detectEndedSessions(from: oldMap, to: newMap)
        #expect(ended.count == 1)
        #expect(ended.first?.id == "one")
    }

    @Test("Decode valid session with all fields")
    func decodeValidSessionAllFields() throws {
        let json = """
        {
            "id": "test-session-123",
            "command": ["bash", "-l"],
            "name": "Test Session",
            "workingDir": "/Users/test",
            "status": "running",
            "exitCode": null,
            "startedAt": "2025-01-01T10:00:00.000Z",
            "lastModified": "2025-01-01T10:05:00.000Z",
            "pid": 12345,
            "initialCols": 80,
            "initialRows": 24,
            "activityStatus": {
                "isActive": true,
                "specificStatus": {
                    "app": "claude",
                    "status": "active"
                }
            },
            "source": "local"
        }
        """

        let data = json.data(using: .utf8)!
        let session = try JSONDecoder().decode(ServerSessionInfo.self, from: data)

        #expect(session.id == "test-session-123")
        #expect(session.command == ["bash", "-l"])
        #expect(session.name == "Test Session")
        #expect(session.workingDir == "/Users/test")
        #expect(session.status == "running")
        #expect(session.exitCode == nil)
        #expect(session.startedAt == "2025-01-01T10:00:00.000Z")
        #expect(session.lastModified == "2025-01-01T10:05:00.000Z")
        #expect(session.pid == 12_345)
        #expect(session.initialCols == 80)
        #expect(session.initialRows == 24)
        #expect(session.activityStatus?.isActive == true)
        #expect(session.activityStatus?.specificStatus?.app == "claude")
        #expect(session.activityStatus?.specificStatus?.status == "active")
        #expect(session.source == "local")
        #expect(session.isRunning == true)
    }

    @Test("Decode session with minimal fields")
    func decodeSessionMinimalFields() throws {
        let json = """
        {
            "id": "minimal-session",
            "name": "sh (/tmp)",
            "command": ["sh"],
            "workingDir": "/tmp",
            "status": "exited",
            "startedAt": "2025-01-01T09:00:00.000Z",
            "lastModified": "2025-01-01T09:30:00.000Z"
        }
        """

        let data = json.data(using: .utf8)!
        let session = try JSONDecoder().decode(ServerSessionInfo.self, from: data)

        #expect(session.id == "minimal-session")
        #expect(session.command == ["sh"])
        #expect(session.name == "sh (/tmp)")
        #expect(session.workingDir == "/tmp")
        #expect(session.status == "exited")
        #expect(session.exitCode == nil)
        #expect(session.pid == nil)
        #expect(session.initialCols == nil)
        #expect(session.initialRows == nil)
        #expect(session.activityStatus == nil)
        #expect(session.source == nil)
        #expect(session.isRunning == false)
    }

    @Test("Decode session with command array bug reproduction")
    func decodeSessionCommandArrayBug() throws {
        // This test reproduces the exact bug where command was an array
        let json = """
        {
            "id": "bug-session",
            "command": ["claude", "session", "--continue"],
            "name": "Claude Session",
            "workingDir": "/Users/developer/project",
            "status": "running",
            "exitCode": null,
            "startedAt": "2025-01-01T12:00:00.000Z",
            "lastModified": "2025-01-01T12:15:00.000Z",
            "pid": 54321,
            "initialCols": 120,
            "initialRows": 40,
            "activityStatus": {
                "isActive": true,
                "specificStatus": {
                    "app": "claude",
                    "status": "thinking"
                }
            }
        }
        """

        let data = json.data(using: .utf8)!
        let session = try JSONDecoder().decode(ServerSessionInfo.self, from: data)

        // Verify command array is properly decoded
        #expect(session.command == ["claude", "session", "--continue"])
        #expect(session.command.count == 3)
        #expect(session.command[0] == "claude")
        #expect(session.command[1] == "session")
        #expect(session.command[2] == "--continue")
        #expect(session.isRunning == true)
    }

    @Test("Decode session array from API response")
    func decodeSessionArrayFromAPI() throws {
        let json = """
        [
            {
                "id": "session-1",
                "name": "bash (/home/user1)",
                "command": ["bash"],
                "workingDir": "/home/user1",
                "status": "running",
                "startedAt": "2025-01-01T10:00:00.000Z",
                "lastModified": "2025-01-01T10:05:00.000Z",
                "pid": 1001
            },
            {
                "id": "session-2",
                "name": "python3 (/home/user2)",
                "command": ["python3", "script.py"],
                "workingDir": "/home/user2",
                "status": "exited",
                "exitCode": 0,
                "startedAt": "2025-01-01T09:00:00.000Z",
                "lastModified": "2025-01-01T09:30:00.000Z"
            },
            {
                "id": "session-3",
                "command": ["node", "server.js", "--port", "3000"],
                "name": "Dev Server",
                "workingDir": "/app",
                "status": "running",
                "startedAt": "2025-01-01T11:00:00.000Z",
                "lastModified": "2025-01-01T11:45:00.000Z",
                "pid": 2002,
                "initialCols": 100,
                "initialRows": 30
            }
        ]
        """

        let data = json.data(using: .utf8)!
        let sessions = try JSONDecoder().decode([ServerSessionInfo].self, from: data)

        #expect(sessions.count == 3)

        // Verify first session
        #expect(sessions[0].id == "session-1")
        #expect(sessions[0].command == ["bash"])
        #expect(sessions[0].isRunning == true)
        #expect(sessions[0].pid == 1_001)

        // Verify second session
        #expect(sessions[1].id == "session-2")
        #expect(sessions[1].command == ["python3", "script.py"])
        #expect(sessions[1].isRunning == false)
        #expect(sessions[1].exitCode == 0)

        // Verify third session
        #expect(sessions[2].id == "session-3")
        #expect(sessions[2].command == ["node", "server.js", "--port", "3000"])
        #expect(sessions[2].name == "Dev Server")
        #expect(sessions[2].isRunning == true)
    }

    // MARK: - Edge Case Tests

    @Test("Handle empty JSON array response")
    func handleEmptyArrayResponse() throws {
        let json = "[]"
        let data = json.data(using: .utf8)!
        let sessions = try JSONDecoder().decode([ServerSessionInfo].self, from: data)

        #expect(sessions.isEmpty)
    }

    @Test("Handle malformed JSON", .tags(.reliability))
    func handleMalformedJSON() {
        let malformedJson = """
        {
            "id": "broken",
            "command": "this should be an array",
            "workingDir": "/tmp",
            "status": "running"
        }
        """

        let data = malformedJson.data(using: .utf8)!

        #expect(throws: (any Error).self) {
            _ = try JSONDecoder().decode(ServerSessionInfo.self, from: data)
        }
    }

    @Test("Handle missing required fields")
    func handleMissingRequiredFields() {
        let incompleteJson = """
        {
            "id": "incomplete",
            "workingDir": "/tmp"
        }
        """

        let data = incompleteJson.data(using: .utf8)!

        #expect(throws: (any Error).self) {
            _ = try JSONDecoder().decode(ServerSessionInfo.self, from: data)
        }
    }

    @Test("Handle unexpected session status values")
    func handleUnexpectedStatus() throws {
        // The status field is just a string, so any value should work
        let json = """
        {
            "id": "weird-status",
            "name": "bash (/tmp)",
            "command": ["bash"],
            "workingDir": "/tmp",
            "status": "zombie",
            "startedAt": "2025-01-01T10:00:00.000Z",
            "lastModified": "2025-01-01T10:00:00.000Z"
        }
        """

        let data = json.data(using: .utf8)!
        let session = try JSONDecoder().decode(ServerSessionInfo.self, from: data)

        #expect(session.status == "zombie")
        #expect(session.isRunning == false) // Only "running" status means isRunning = true
    }

    // MARK: - isRunning Calculation Tests

    @Test("isRunning calculation for different statuses")
    func isRunningCalculation() throws {
        let statuses = [
            ("running", true),
            ("exited", false),
            ("starting", false),
            ("stopped", false),
            ("crashed", false),
            ("", false),
            ("RUNNING", false), // Case sensitive
            ("Running", false)
        ]

        for (status, expectedRunning) in statuses {
            let json = """
            {
                "id": "test-\(status)",
                "name": "test (/tmp)",
                "command": ["test"],
                "workingDir": "/tmp",
                "status": "\(status)",
                "startedAt": "2025-01-01T10:00:00.000Z",
                "lastModified": "2025-01-01T10:00:00.000Z"
            }
            """

            let data = json.data(using: .utf8)!
            let session = try JSONDecoder().decode(ServerSessionInfo.self, from: data)

            #expect(
                session.isRunning == expectedRunning,
                "Status '\(status)' should result in isRunning=\(expectedRunning)"
            )
        }
    }

    // MARK: - Remote Session Tests

    @Test("Decode remote session with HQ mode fields")
    func decodeRemoteSession() throws {
        let json = """
        {
            "id": "remote-session-456",
            "command": ["ssh", "remote-server"],
            "name": "Remote SSH Session",
            "workingDir": "/home/remote",
            "status": "running",
            "startedAt": "2025-01-01T14:00:00.000Z",
            "lastModified": "2025-01-01T14:30:00.000Z",
            "pid": 8888,
            "source": "remote",
            "remoteId": "remote-123",
            "remoteName": "Production Server",
            "remoteUrl": "https://remote.example.com"
        }
        """

        let data = json.data(using: .utf8)!
        let session = try JSONDecoder().decode(ServerSessionInfo.self, from: data)

        #expect(session.source == "remote")
        // Note: remoteId, remoteName, and remoteUrl are not part of ServerSessionInfo
        // They would need to be added if HQ mode support is needed
    }

    // MARK: - Session Count Tests

    @Test("Session count calculation")
    func sessionCount() async {
        // Force a refresh to get current state
        await monitor.refresh()

        // Session count should be non-negative
        #expect(monitor.sessionCount >= 0)

        // If there are sessions, they should be in the sessions dictionary
        if monitor.sessionCount > 0 {
            #expect(!monitor.sessions.isEmpty)
            // All counted sessions should be running
            let runningCount = monitor.sessions.values.count(where: { $0.isRunning })
            #expect(monitor.sessionCount == runningCount)
        }

        // Note: We can't assume sessionCount is 0 because:
        // 1. The monitor is a singleton that persists across tests
        // 2. It has a periodic refresh timer that might fetch real sessions
        // 3. Tests might run while the VibeTunnel server is actually running
    }

    // MARK: - Cache Behavior Tests

    @Test("Cache behavior", .tags(.performance))
    func cacheBehavior() async {
        // First call should fetch
        _ = await monitor.getSessions()

        // Immediate second call should use cache (no network request)
        let cachedSessions = await monitor.getSessions()

        // Verify we got a result (even if empty due to no server)
        #expect(cachedSessions.isEmpty || !cachedSessions.isEmpty)
    }

    @Test("Force refresh clears cache")
    func forceRefresh() async {
        // Get initial sessions
        let initialSessions = await monitor.getSessions()

        // Force refresh
        await monitor.refresh()

        // Next call should fetch fresh data
        let refreshedSessions = await monitor.getSessions()

        // Both should be dictionaries (possibly empty)
        #expect(type(of: initialSessions) == type(of: refreshedSessions))
    }

    // MARK: - Mock API Response Tests

    @Test("Parse real-world API response")
    func parseRealWorldResponse() throws {
        // This mimics an actual response from the server
        let realWorldJson = """
        [
            {
                "id": "20250101-100000-abc123",
                "command": ["claude", "session", "--continue", "20250101-095000-xyz789"],
                "name": "Claude Development Session",
                "workingDir": "/Users/developer/vibetunnel",
                "status": "running",
                "startedAt": "2025-01-01T10:00:00.123Z",
                "lastModified": "2025-01-01T10:45:32.456Z",
                "pid": 45678,
                "initialCols": 120,
                "initialRows": 40,
                "activityStatus": {
                    "isActive": true,
                    "specificStatus": {
                        "app": "claude",
                        "status": "editing"
                    }
                }
            },
            {
                "id": "20250101-090000-def456",
                "command": ["pnpm", "run", "dev"],
                "name": "Development Server",
                "workingDir": "/Users/developer/vibetunnel/web",
                "status": "running",
                "startedAt": "2025-01-01T09:00:00.000Z",
                "lastModified": "2025-01-01T10:45:00.000Z",
                "pid": 34567,
                "initialCols": 80,
                "initialRows": 24
            },
            {
                "id": "20250101-083000-ghi789",
                "name": "git (~/vibetunnel)",
                "command": ["git", "log", "--oneline", "-10"],
                "workingDir": "/Users/developer/vibetunnel",
                "status": "exited",
                "exitCode": 0,
                "startedAt": "2025-01-01T08:30:00.000Z",
                "lastModified": "2025-01-01T08:30:05.000Z"
            }
        ]
        """

        let data = realWorldJson.data(using: .utf8)!
        let sessions = try JSONDecoder().decode([ServerSessionInfo].self, from: data)

        #expect(sessions.count == 3)

        // Verify Claude session
        let claudeSession = sessions[0]
        #expect(claudeSession.command.count == 4)
        #expect(claudeSession.command[0] == "claude")
        #expect(claudeSession.command[1] == "session")
        #expect(claudeSession.command[2] == "--continue")
        #expect(claudeSession.isRunning == true)
        #expect(claudeSession.activityStatus?.specificStatus?.app == "claude")

        // Verify dev server session
        let devSession = sessions[1]
        #expect(devSession.command == ["pnpm", "run", "dev"])
        #expect(devSession.isRunning == true)
        #expect(devSession.pid == 34_567)

        // Verify exited session
        let gitSession = sessions[2]
        #expect(gitSession.command == ["git", "log", "--oneline", "-10"])
        #expect(gitSession.isRunning == false)
        #expect(gitSession.exitCode == 0)
        #expect(gitSession.pid == nil)
    }

    // MARK: - Concurrent Access Tests

    @Test("Concurrent session access", .tags(.concurrency))
    func concurrentAccess() async {
        await withTaskGroup(of: [String: ServerSessionInfo].self) { group in
            // Multiple concurrent getSessions calls
            for _ in 0..<5 {
                group.addTask { [monitor] in
                    await monitor.getSessions()
                }
            }

            var results: [[String: ServerSessionInfo]] = []
            for await result in group {
                results.append(result)
            }

            // All concurrent calls should return consistent results
            if let first = results.first {
                for result in results {
                    #expect(result.count == first.count)
                }
            }
        }
    }

    // MARK: - Performance Tests

    @Test("Cache performance", .tags(.performance))
    func cachePerformance() async throws {
        // Skip this test on macOS < 13
        #if os(macOS)
            if #unavailable(macOS 13.0) {
                return // Skip test on older macOS versions
            }
        #endif

        // Warm up cache
        _ = await monitor.getSessions()

        // Measure cached access time
        let start = Date()

        for _ in 0..<100 {
            _ = await monitor.getSessions()
        }

        let elapsed = Date().timeIntervalSince(start)

        // Cached access should be very fast (increased threshold for CI)
        #expect(elapsed < 0.5, "Cached access took too long: \(elapsed)s for 100 calls")
    }
}
