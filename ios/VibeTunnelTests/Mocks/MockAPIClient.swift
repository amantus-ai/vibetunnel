import Foundation
@testable import VibeTunnel

/// Mock implementation of APIClientProtocol for testing
@MainActor
class MockAPIClient: APIClientProtocol {
    // Tracking properties
    var getSessionsCalled = false
    var getSessionCalled = false
    var getSessionId: String?
    var createSessionCalled = false
    var createSessionData: SessionCreateData?
    var lastCreateData: SessionCreateData?
    var killSessionCalled = false
    var killSessionId: String?
    var lastKilledSessionId: String?
    var killSessionCallCount = 0
    var killedSessionIds: [String] = []
    var cleanupSessionCalled = false
    var cleanupSessionId: String?
    var cleanupAllExitedSessionsCalled = false
    var killAllSessionsCalled = false
    var sendInputCalled = false
    var sendInputSessionId: String?
    var sendInputText: String?
    var lastInputSessionId: String?
    var lastInputText: String?
    var resizeTerminalCalled = false
    var resizeTerminalSessionId: String?
    var resizeTerminalCols: Int?
    var resizeTerminalRows: Int?
    var lastResizeSessionId: String?
    var lastResizeCols: Int?
    var lastResizeRows: Int?
    var checkHealthCalled = false

    // Simple configuration properties
    var sessionsToReturn: [Session] = []
    var sessionIdToReturn: String = "mock-session-id"
    var shouldThrowError = false
    var errorToThrow: Error = APIError.networkError(URLError(.notConnectedToInternet))

    // Response configuration
    var sessionsResponse: Result<[Session], Error> = .success([])
    var sessionResponse: Result<Session, Error> = .success(TestFixtures.validSession)
    var createSessionResponse: Result<String, Error> = .success("mock-session-id")
    var killSessionResponse: Result<Void, Error> = .success(())
    var cleanupSessionResponse: Result<Void, Error> = .success(())
    var cleanupAllResponse: Result<[String], Error> = .success([])
    var killAllResponse: Result<Void, Error> = .success(())
    var sendInputResponse: Result<Void, Error> = .success(())
    var resizeResponse: Result<Void, Error> = .success(())
    var healthResponse: Result<Bool, Error> = .success(true)

    /// Delay configuration for testing async behavior
    var responseDelay: TimeInterval = 0

    func getSessions() async throws -> [Session] {
        getSessionsCalled = true
        if shouldThrowError {
            throw errorToThrow
        }
        if responseDelay > 0 {
            try await Task.sleep(nanoseconds: UInt64(responseDelay * 1_000_000_000))
        }
        if !sessionsToReturn.isEmpty {
            return sessionsToReturn
        }
        return try sessionsResponse.get()
    }

    func getSession(_ sessionId: String) async throws -> Session {
        getSessionCalled = true
        getSessionId = sessionId
        if responseDelay > 0 {
            try await Task.sleep(nanoseconds: UInt64(responseDelay * 1_000_000_000))
        }
        return try sessionResponse.get()
    }

    func createSession(_ data: SessionCreateData) async throws -> String {
        createSessionCalled = true
        createSessionData = data
        lastCreateData = data
        if responseDelay > 0 {
            try await Task.sleep(nanoseconds: UInt64(responseDelay * 1_000_000_000))
        }
        if !sessionIdToReturn.isEmpty {
            return sessionIdToReturn
        }
        return try createSessionResponse.get()
    }

    func killSession(_ sessionId: String) async throws {
        killSessionCalled = true
        killSessionId = sessionId
        lastKilledSessionId = sessionId
        killSessionCallCount += 1
        killedSessionIds.append(sessionId)
        if responseDelay > 0 {
            try await Task.sleep(nanoseconds: UInt64(responseDelay * 1_000_000_000))
        }
        try killSessionResponse.get()
    }

    func cleanupSession(_ sessionId: String) async throws {
        cleanupSessionCalled = true
        cleanupSessionId = sessionId
        if responseDelay > 0 {
            try await Task.sleep(nanoseconds: UInt64(responseDelay * 1_000_000_000))
        }
        try cleanupSessionResponse.get()
    }

    func cleanupAllExitedSessions() async throws -> [String] {
        cleanupAllExitedSessionsCalled = true
        if responseDelay > 0 {
            try await Task.sleep(nanoseconds: UInt64(responseDelay * 1_000_000_000))
        }
        return try cleanupAllResponse.get()
    }

    func killAllSessions() async throws {
        killAllSessionsCalled = true
        if responseDelay > 0 {
            try await Task.sleep(nanoseconds: UInt64(responseDelay * 1_000_000_000))
        }
        try killAllResponse.get()
    }

    func sendInput(sessionId: String, text: String) async throws {
        sendInputCalled = true
        sendInputSessionId = sessionId
        sendInputText = text
        lastInputSessionId = sessionId
        lastInputText = text
        if responseDelay > 0 {
            try await Task.sleep(nanoseconds: UInt64(responseDelay * 1_000_000_000))
        }
        try sendInputResponse.get()
    }

    func resizeTerminal(sessionId: String, cols: Int, rows: Int) async throws {
        resizeTerminalCalled = true
        resizeTerminalSessionId = sessionId
        resizeTerminalCols = cols
        resizeTerminalRows = rows
        lastResizeSessionId = sessionId
        lastResizeCols = cols
        lastResizeRows = rows
        if responseDelay > 0 {
            try await Task.sleep(nanoseconds: UInt64(responseDelay * 1_000_000_000))
        }
        try resizeResponse.get()
    }

    func checkHealth() async throws -> Bool {
        checkHealthCalled = true
        if responseDelay > 0 {
            try await Task.sleep(nanoseconds: UInt64(responseDelay * 1_000_000_000))
        }
        return try healthResponse.get()
    }

    /// Helper to reset all tracking properties
    func reset() {
        getSessionsCalled = false
        getSessionCalled = false
        getSessionId = nil
        createSessionCalled = false
        createSessionData = nil
        killSessionCalled = false
        killSessionId = nil
        cleanupSessionCalled = false
        cleanupSessionId = nil
        cleanupAllExitedSessionsCalled = false
        killAllSessionsCalled = false
        sendInputCalled = false
        sendInputSessionId = nil
        sendInputText = nil
        resizeTerminalCalled = false
        resizeTerminalSessionId = nil
        resizeTerminalCols = nil
        resizeTerminalRows = nil
        checkHealthCalled = false
    }
}
