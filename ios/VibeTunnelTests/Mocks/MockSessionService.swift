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
        getSessionsCallCount += 1
        if shouldThrowError {
            throw thrownError
        }
        return sessions
    }
    
    func createSession(_ data: SessionCreateData) async throws -> String {
        throw APIError.serverError(501, "Not implemented in mock")
    }
    
    func killSession(_ sessionId: String) async throws {
        killSessionCallCount += 1
        killedSessionIds.append(sessionId)
        if shouldThrowError {
            throw thrownError
        }
    }
    
    func cleanupSession(_ sessionId: String) async throws {
        cleanupSessionCallCount += 1
        cleanedUpSessionIds.append(sessionId)
        if shouldThrowError {
            throw thrownError
        }
    }
    
    func cleanupAllExitedSessions() async throws -> [String] {
        cleanupAllExitedCallCount += 1
        if shouldThrowError {
            throw thrownError
        }
        let exitedIds = sessions.filter { !$0.isRunning }.map { $0.id }
        return exitedIds
    }
    
    func killAllSessions() async throws {
        killAllSessionsCallCount += 1
        if shouldThrowError {
            throw thrownError
        }
    }
    
    func sendInput(to sessionId: String, text: String) async throws {
        throw APIError.serverError(501, "Not implemented in mock")
    }
    
    func resizeTerminal(sessionId: String, cols: Int, rows: Int) async throws {
        throw APIError.serverError(501, "Not implemented in mock")
    }
}