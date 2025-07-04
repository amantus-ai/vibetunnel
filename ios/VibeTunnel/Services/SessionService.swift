import Foundation

private let logger = Logger(category: "SessionService")

/// Protocol defining the interface for session service operations
@MainActor
protocol SessionServiceProtocol {
    func getSessions() async throws -> [Session]
    func createSession(_ data: SessionCreateData) async throws -> String
    func killSession(_ sessionId: String) async throws
    func cleanupSession(_ sessionId: String) async throws
    func cleanupAllExitedSessions() async throws -> [String]
    func killAllSessions() async throws
}

/// Service layer for managing terminal sessions.
///
/// SessionService provides a simplified interface for session-related operations,
/// wrapping the APIClient functionality with additional logging and error handling.
@MainActor
class SessionService: SessionServiceProtocol {
    private let apiClient: APIClient

    init(apiClient: APIClient = APIClient.shared) {
        self.apiClient = apiClient
    }

    func getSessions() async throws -> [Session] {
        try await apiClient.getSessions()
    }

    func createSession(_ data: SessionCreateData) async throws -> String {
        do {
            return try await apiClient.createSession(data)
        } catch {
            logger.error("Failed to create session: \(error)")
            throw error
        }
    }

    func killSession(_ sessionId: String) async throws {
        try await apiClient.killSession(sessionId)
    }

    func cleanupSession(_ sessionId: String) async throws {
        try await apiClient.cleanupSession(sessionId)
    }

    func cleanupAllExitedSessions() async throws -> [String] {
        try await apiClient.cleanupAllExitedSessions()
    }

    func killAllSessions() async throws {
        try await apiClient.killAllSessions()
    }

    func sendInput(to sessionId: String, text: String) async throws {
        try await apiClient.sendInput(sessionId: sessionId, text: text)
    }

    func resizeTerminal(sessionId: String, cols: Int, rows: Int) async throws {
        try await apiClient.resizeTerminal(sessionId: sessionId, cols: cols, rows: rows)
    }
}
