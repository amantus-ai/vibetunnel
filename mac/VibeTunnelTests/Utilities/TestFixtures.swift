import Foundation
@testable import VibeTunnel

/// Common test fixtures and helpers
enum TestFixtures {
    // MARK: - Session Fixtures

    static func createSession(
        id: String = "00000000-0000-0000-0000-000000000123",
        createdAt: Date = Date(),
        lastActivity: Date = Date(),
        processID: Int32? = nil,
        isActive: Bool = true
    )
        -> TunnelSession
    {
        var session = TunnelSession(
            id: UUID(uuidString: id) ?? UUID(),
            processID: processID
        )
        session.isActive = isActive
        return session
    }

    static func defaultClientInfo() -> TunnelSession.ClientInfo {
        TunnelSession.ClientInfo(
            hostname: "test-host",
            username: "test-user",
            homeDirectory: "/Users/test",
            operatingSystem: "macOS",
            architecture: "arm64"
        )
    }

    static func createSessionRequest(
        clientInfo: TunnelSession.ClientInfo? = nil
    )
        -> TunnelSession.CreateRequest
    {
        TunnelSession.CreateRequest(clientInfo: clientInfo ?? defaultClientInfo())
    }

    static func createSessionResponse(
        id: String = "00000000-0000-0000-0000-000000000123",
        session: TunnelSession? = nil
    )
        -> TunnelSession.CreateResponse
    {
        TunnelSession.CreateResponse(
            id: id,
            session: session ?? createSession(id: id)
        )
    }

    // MARK: - Command Fixtures

    static func executeCommandRequest(
        sessionId: String = "00000000-0000-0000-0000-000000000123",
        command: String = "echo 'test'",
        environment: [String: String]? = nil,
        workingDirectory: String? = nil
    )
        -> TunnelSession.ExecuteCommandRequest
    {
        TunnelSession.ExecuteCommandRequest(
            sessionId: sessionId,
            command: command,
            environment: environment,
            workingDirectory: workingDirectory
        )
    }

    static func executeCommandResponse(
        exitCode: Int32 = 0,
        stdout: String = "test output",
        stderr: String = ""
    )
        -> TunnelSession.ExecuteCommandResponse
    {
        TunnelSession.ExecuteCommandResponse(
            exitCode: exitCode,
            stdout: stdout,
            stderr: stderr
        )
    }

    // MARK: - Error Response Fixtures

    static func errorResponse(
        error: String = "Test error",
        code: String? = "TEST_ERROR"
    )
        -> TunnelSession.ErrorResponse
    {
        TunnelSession.ErrorResponse(error: error, code: code)
    }

    // MARK: - API Configuration

    static let testAPIKey = "test-api-key-12345"
    static let testServerURL = URL(string: "http://localhost:8080")!

    // MARK: - Date Helpers

    private nonisolated(unsafe) static let iso8601Formatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    static func date(from string: String) -> Date {
        iso8601Formatter.date(from: string) ?? Date()
    }
}

// MARK: - Async Test Helpers

extension TestFixtures {
    /// Wait for a condition to become true with timeout
    static func waitFor(
        _ condition: @escaping () async -> Bool,
        timeout: TimeInterval = 1.0,
        interval: TimeInterval = 0.1
    )
        async throws
    {
        let deadline = Date().addingTimeInterval(timeout)

        while Date() < deadline {
            if await condition() {
                return
            }
            try await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
        }

        throw TestError.timeout
    }

    enum TestError: Error {
        case timeout
        case skip(String)
    }
}
