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
        self.getSessionsCalled = true
        if self.shouldThrowError {
            throw self.errorToThrow
        }
        if self.responseDelay > 0 {
            try await Task.sleep(nanoseconds: UInt64(self.responseDelay * 1_000_000_000))
        }
        if !self.sessionsToReturn.isEmpty {
            return self.sessionsToReturn
        }
        return try self.sessionsResponse.get()
    }

    func getSession(_ sessionId: String) async throws -> Session {
        self.getSessionCalled = true
        self.getSessionId = sessionId
        if self.responseDelay > 0 {
            try await Task.sleep(nanoseconds: UInt64(self.responseDelay * 1_000_000_000))
        }
        return try self.sessionResponse.get()
    }

    func createSession(_ data: SessionCreateData) async throws -> String {
        self.createSessionCalled = true
        self.createSessionData = data
        self.lastCreateData = data
        if self.responseDelay > 0 {
            try await Task.sleep(nanoseconds: UInt64(self.responseDelay * 1_000_000_000))
        }
        if !self.sessionIdToReturn.isEmpty {
            return self.sessionIdToReturn
        }
        return try self.createSessionResponse.get()
    }

    func killSession(_ sessionId: String) async throws {
        self.killSessionCalled = true
        self.killSessionId = sessionId
        self.lastKilledSessionId = sessionId
        self.killSessionCallCount += 1
        self.killedSessionIds.append(sessionId)
        if self.responseDelay > 0 {
            try await Task.sleep(nanoseconds: UInt64(self.responseDelay * 1_000_000_000))
        }
        try self.killSessionResponse.get()
    }

    func cleanupSession(_ sessionId: String) async throws {
        self.cleanupSessionCalled = true
        self.cleanupSessionId = sessionId
        if self.responseDelay > 0 {
            try await Task.sleep(nanoseconds: UInt64(self.responseDelay * 1_000_000_000))
        }
        try self.cleanupSessionResponse.get()
    }

    func cleanupAllExitedSessions() async throws -> [String] {
        self.cleanupAllExitedSessionsCalled = true
        if self.responseDelay > 0 {
            try await Task.sleep(nanoseconds: UInt64(self.responseDelay * 1_000_000_000))
        }
        return try self.cleanupAllResponse.get()
    }

    func killAllSessions() async throws {
        self.killAllSessionsCalled = true
        if self.responseDelay > 0 {
            try await Task.sleep(nanoseconds: UInt64(self.responseDelay * 1_000_000_000))
        }
        try self.killAllResponse.get()
    }

    func sendInput(sessionId: String, text: String) async throws {
        self.sendInputCalled = true
        self.sendInputSessionId = sessionId
        self.sendInputText = text
        self.lastInputSessionId = sessionId
        self.lastInputText = text
        if self.responseDelay > 0 {
            try await Task.sleep(nanoseconds: UInt64(self.responseDelay * 1_000_000_000))
        }
        try self.sendInputResponse.get()
    }

    func resizeTerminal(sessionId: String, cols: Int, rows: Int) async throws {
        self.resizeTerminalCalled = true
        self.resizeTerminalSessionId = sessionId
        self.resizeTerminalCols = cols
        self.resizeTerminalRows = rows
        self.lastResizeSessionId = sessionId
        self.lastResizeCols = cols
        self.lastResizeRows = rows
        if self.responseDelay > 0 {
            try await Task.sleep(nanoseconds: UInt64(self.responseDelay * 1_000_000_000))
        }
        try self.resizeResponse.get()
    }

    func checkHealth() async throws -> Bool {
        self.checkHealthCalled = true
        if self.responseDelay > 0 {
            try await Task.sleep(nanoseconds: UInt64(self.responseDelay * 1_000_000_000))
        }
        return try self.healthResponse.get()
    }

    /// Helper to reset all tracking properties
    func reset() {
        self.getSessionsCalled = false
        self.getSessionCalled = false
        self.getSessionId = nil
        self.createSessionCalled = false
        self.createSessionData = nil
        self.killSessionCalled = false
        self.killSessionId = nil
        self.cleanupSessionCalled = false
        self.cleanupSessionId = nil
        self.cleanupAllExitedSessionsCalled = false
        self.killAllSessionsCalled = false
        self.sendInputCalled = false
        self.sendInputSessionId = nil
        self.sendInputText = nil
        self.resizeTerminalCalled = false
        self.resizeTerminalSessionId = nil
        self.resizeTerminalCols = nil
        self.resizeTerminalRows = nil
        self.checkHealthCalled = false
    }
}
