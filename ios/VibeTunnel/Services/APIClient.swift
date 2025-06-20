import Foundation

enum APIError: LocalizedError {
    case invalidURL
    case noData
    case decodingError(Error)
    case serverError(Int, String?)
    case networkError(Error)
    case noServerConfigured
    
    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .noData:
            return "No data received"
        case .decodingError(let error):
            return "Failed to decode response: \(error.localizedDescription)"
        case .serverError(let code, let message):
            return message ?? "Server error: \(code)"
        case .networkError(let error):
            return error.localizedDescription
        case .noServerConfigured:
            return "No server configured"
        }
    }
}

protocol APIClientProtocol {
    func getSessions() async throws -> [Session]
    func createSession(_ data: SessionCreateData) async throws -> String
    func killSession(_ sessionId: String) async throws
    func cleanupSession(_ sessionId: String) async throws
    func cleanupAllExitedSessions() async throws -> [String]
    func sendInput(sessionId: String, text: String) async throws
    func resizeTerminal(sessionId: String, cols: Int, rows: Int) async throws
}

class APIClient: APIClientProtocol {
    static let shared = APIClient()
    private let session = URLSession.shared
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()
    
    private var baseURL: URL? {
        guard let config = UserDefaults.standard.data(forKey: "savedServerConfig"),
              let serverConfig = try? JSONDecoder().decode(ServerConfig.self, from: config) else {
            return nil
        }
        return serverConfig.baseURL
    }
    
    private init() {}
    
    // MARK: - Session Management
    
    func getSessions() async throws -> [Session] {
        guard let baseURL = baseURL else {
            throw APIError.noServerConfigured
        }
        
        let url = baseURL.appendingPathComponent("api/sessions")
        let (data, response) = try await session.data(from: url)
        
        try validateResponse(response)
        
        do {
            return try decoder.decode([Session].self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    func createSession(_ data: SessionCreateData) async throws -> String {
        guard let baseURL = baseURL else {
            throw APIError.noServerConfigured
        }
        
        let url = baseURL.appendingPathComponent("api/sessions")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(data)
        
        let (responseData, response) = try await session.data(for: request)
        try validateResponse(response)
        
        struct CreateResponse: Codable {
            let sessionId: String
        }
        
        let createResponse = try decoder.decode(CreateResponse.self, from: responseData)
        return createResponse.sessionId
    }
    
    func killSession(_ sessionId: String) async throws {
        guard let baseURL = baseURL else {
            throw APIError.noServerConfigured
        }
        
        let url = baseURL.appendingPathComponent("api/sessions/\(sessionId)")
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        
        let (_, response) = try await session.data(for: request)
        try validateResponse(response)
    }
    
    func cleanupSession(_ sessionId: String) async throws {
        guard let baseURL = baseURL else {
            throw APIError.noServerConfigured
        }
        
        let url = baseURL.appendingPathComponent("api/sessions/\(sessionId)/cleanup")
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        
        let (_, response) = try await session.data(for: request)
        try validateResponse(response)
    }
    
    func cleanupAllExitedSessions() async throws -> [String] {
        guard let baseURL = baseURL else {
            throw APIError.noServerConfigured
        }
        
        let url = baseURL.appendingPathComponent("api/cleanup-exited")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        
        let (data, response) = try await session.data(for: request)
        try validateResponse(response)
        
        struct CleanupResponse: Codable {
            let cleanedSessions: [String]
        }
        
        let cleanupResponse = try decoder.decode(CleanupResponse.self, from: data)
        return cleanupResponse.cleanedSessions
    }
    
    // MARK: - Terminal I/O
    
    func sendInput(sessionId: String, text: String) async throws {
        guard let baseURL = baseURL else {
            throw APIError.noServerConfigured
        }
        
        let url = baseURL.appendingPathComponent("api/sessions/\(sessionId)/input")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let input = TerminalInput(text: text)
        request.httpBody = try encoder.encode(input)
        
        let (_, response) = try await session.data(for: request)
        try validateResponse(response)
    }
    
    func resizeTerminal(sessionId: String, cols: Int, rows: Int) async throws {
        guard let baseURL = baseURL else {
            throw APIError.noServerConfigured
        }
        
        let url = baseURL.appendingPathComponent("api/sessions/\(sessionId)/resize")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let resize = TerminalResize(cols: cols, rows: rows)
        request.httpBody = try encoder.encode(resize)
        
        let (_, response) = try await session.data(for: request)
        try validateResponse(response)
    }
    
    // MARK: - SSE Stream URL
    
    func streamURL(for sessionId: String) -> URL? {
        guard let baseURL = baseURL else { return nil }
        return baseURL.appendingPathComponent("api/sessions/\(sessionId)/stream")
    }
    
    // MARK: - Helpers
    
    private func validateResponse(_ response: URLResponse) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.networkError(URLError(.badServerResponse))
        }
        
        guard 200..<300 ~= httpResponse.statusCode else {
            throw APIError.serverError(httpResponse.statusCode, nil)
        }
    }
}