import Foundation
import Testing
@testable import VibeTunnel

@Suite("Session Integration Tests", .tags(.integration, .networking))
struct SessionIntegrationTests {

    @Test("Session lifecycle - create, list, kill", .tags(.critical))
    @MainActor
    func sessionLifecycle() async throws {
        // Note: These are integration tests that would run against a real server
        // In CI, we'd need a test server running or use mocks

        let serverConfig = ServerConfig(
            host: "localhost",
            port: 8888,
            name: "Test Server"
        )

        // Test basic connectivity first
        let apiClient = APIClient.shared

        // Skip test if server is not available
        do {
            let isHealthy = try await apiClient.checkHealth()
            guard isHealthy else {
                throw Issue.record("Test server is not healthy")
                return
            }
        } catch {
            throw Issue.record("Test server is not available: \(error)")
            return
        }

        // Create a test session
        let sessionData = SessionCreateData(
            command: "/bin/echo",
            workingDir: "/tmp",
            name: "Test Session \(UUID().uuidString)",
            cols: 80,
            rows: 24
        )

        let sessionId = try await apiClient.createSession(sessionData)
        #expect(!sessionId.isEmpty)

        // List sessions and verify our session exists
        let sessions = try await apiClient.getSessions()
        let ourSession = sessions.first { $0.id == sessionId }
        #expect(ourSession != nil)
        #expect(ourSession?.name == sessionData.name)
        #expect(ourSession?.command.first == "/bin/echo")

        // Send some input
        try await apiClient.sendInput(sessionId: sessionId, text: "Hello, World!\n")

        // Give the process time to execute
        try? await Task.sleep(nanoseconds: 500_000_000) // 0.5 seconds

        // Kill the session
        try await apiClient.killSession(sessionId)

        // Verify session is marked as exited
        let updatedSessions = try await apiClient.getSessions()
        let killedSession = updatedSessions.first { $0.id == sessionId }
        #expect(killedSession?.isRunning == false)
    }

    @Test("WebSocket streaming", .tags(.critical))
    @MainActor
    func webSocketStreaming() async throws {
        // Skip if server not available
        guard try await APIClient.shared.checkHealth() else {
            throw Issue.record("Test server is not available")
            return
        }

        // Create a session that outputs data
        let sessionData = SessionCreateData(
            command: "/bin/bash",
            workingDir: "/tmp",
            name: "WebSocket Test",
            cols: 80,
            rows: 24
        )

        let sessionId = try await APIClient.shared.createSession(sessionData)

        // Set up WebSocket client
        let serverConfig = ServerConfig(host: "localhost", port: 8888)
        let wsClient = BufferWebSocketClient(serverConfig: serverConfig)

        var receivedEvents: [TerminalWebSocketEvent] = []
        let expectation = AsyncExpectation()

        // Subscribe to events
        wsClient.subscribe(to: sessionId) { event in
            receivedEvents.append(event)

            // Complete after receiving some output
            if case .output = event {
                expectation.fulfill()
            }
        }

        // Connect WebSocket
        wsClient.connect()

        // Wait for connection
        try? await Task.sleep(nanoseconds: 500_000_000) // 0.5 seconds

        // Send a command that produces output
        try await APIClient.shared.sendInput(sessionId: sessionId, text: "echo 'Hello from WebSocket'\n")

        // Wait for output event
        await expectation.wait(timeout: 5.0)

        // Verify we received events
        #expect(!receivedEvents.isEmpty)

        // Clean up
        wsClient.disconnect()
        try await APIClient.shared.killSession(sessionId)
    }

    @Test("Terminal resize")
    @MainActor
    func terminalResize() async throws {
        guard try await APIClient.shared.checkHealth() else {
            throw Issue.record("Test server is not available")
            return
        }

        // Create session
        let sessionId = try await APIClient.shared.createSession(
            SessionCreateData(
                command: "/bin/bash",
                workingDir: "/tmp",
                name: "Resize Test",
                cols: 80,
                rows: 24
            )
        )

        // Resize terminal
        try await APIClient.shared.resizeTerminal(
            sessionId: sessionId,
            cols: 120,
            rows: 40
        )

        // Clean up
        try await APIClient.shared.killSession(sessionId)
    }

    @Test("Multiple sessions")
    @MainActor
    func multipleSessions() async throws {
        guard try await APIClient.shared.checkHealth() else {
            throw Issue.record("Test server is not available")
            return
        }

        var sessionIds: [String] = []

        // Create multiple sessions
        for i in 1...3 {
            let sessionId = try await APIClient.shared.createSession(
                SessionCreateData(
                    command: "/bin/sleep",
                    workingDir: "/tmp",
                    name: "Multi Test \(i)",
                    cols: 80,
                    rows: 24
                )
            )
            sessionIds.append(sessionId)
        }

        // Verify all sessions exist
        let sessions = try await APIClient.shared.getSessions()
        for id in sessionIds {
            #expect(sessions.contains { $0.id == id })
        }

        // Kill all sessions
        for id in sessionIds {
            try await APIClient.shared.killSession(id)
        }
    }
}

// MARK: - Helper for async expectations

class AsyncExpectation {
    private var continuation: CheckedContinuation<Void, Never>?

    func fulfill() {
        continuation?.resume()
        continuation = nil
    }

    func wait(timeout: TimeInterval) async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask {
                await withCheckedContinuation { continuation in
                    self.continuation = continuation
                }
            }

            group.addTask {
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                self.continuation?.resume()
                self.continuation = nil
            }

            await group.next()
            group.cancelAll()
        }
    }
}
