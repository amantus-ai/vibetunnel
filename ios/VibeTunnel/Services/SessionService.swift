import Foundation

@MainActor
class SessionService {
    static let shared = SessionService()
    private let apiClient = APIClient.shared
    
    private init() {}
    
    func getSessions() async throws -> [Session] {
        return try await apiClient.getSessions()
    }
    
    func createSession(_ data: SessionCreateData) async throws -> String {
        do {
            return try await apiClient.createSession(data)
        } catch {
            print("[SessionService] Failed to create session: \(error)")
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
        return try await apiClient.cleanupAllExitedSessions()
    }
    
    func sendInput(to sessionId: String, text: String) async throws {
        try await apiClient.sendInput(sessionId: sessionId, text: text)
    }
    
    func resizeTerminal(sessionId: String, cols: Int, rows: Int) async throws {
        try await apiClient.resizeTerminal(sessionId: sessionId, cols: cols, rows: rows)
    }
}