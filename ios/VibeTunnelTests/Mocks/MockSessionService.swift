import Foundation
@testable import VibeTunnel

/// Mock implementation of SessionServiceProtocol for testing
@MainActor
class MockSessionService: SessionServiceProtocol {
    var sessions: [Session] = []
    var shouldThrowError = false
    var thrownError: Error = APIError.networkError(URLError(.notConnectedToInternet))

    // Track method calls for verification
    var getSessionsCallCount = 0
    var killSessionCallCount = 0
    var cleanupSessionCallCount = 0
    var cleanupAllExitedCallCount = 0
    var killAllSessionsCallCount = 0

    var killedSessionIds: [String] = []
    var cleanedUpSessionIds: [String] = []

    func getSessions() async throws -> [Session] {
        self.getSessionsCallCount += 1
        if self.shouldThrowError {
            throw self.thrownError
        }
        return self.sessions
    }

    func createSession(_ data: SessionCreateData) async throws -> String {
        throw APIError.serverError(501, "Not implemented in mock")
    }

    func killSession(_ sessionId: String) async throws {
        self.killSessionCallCount += 1
        self.killedSessionIds.append(sessionId)
        if self.shouldThrowError {
            throw self.thrownError
        }
    }

    func cleanupSession(_ sessionId: String) async throws {
        self.cleanupSessionCallCount += 1
        self.cleanedUpSessionIds.append(sessionId)
        if self.shouldThrowError {
            throw self.thrownError
        }
    }

    func cleanupAllExitedSessions() async throws -> [String] {
        self.cleanupAllExitedCallCount += 1
        if self.shouldThrowError {
            throw self.thrownError
        }
        let exitedIds = self.sessions.filter { !$0.isRunning }.map(\.id)
        return exitedIds
    }

    func killAllSessions() async throws {
        self.killAllSessionsCallCount += 1
        if self.shouldThrowError {
            throw self.thrownError
        }
    }

    func sendInput(to sessionId: String, text: String) async throws {
        throw APIError.serverError(501, "Not implemented in mock")
    }

    func resizeTerminal(sessionId: String, cols: Int, rows: Int) async throws {
        throw APIError.serverError(501, "Not implemented in mock")
    }
}
