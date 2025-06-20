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
            if let message = message {
                return message
            }
            switch code {
            case 400:
                return "Bad request - check your input"
            case 401:
                return "Unauthorized - authentication required"
            case 403:
                return "Forbidden - access denied"
            case 404:
                return "Not found - endpoint doesn't exist"
            case 500:
                return "Server error - internal server error"
            case 502:
                return "Bad gateway - server is down"
            case 503:
                return "Service unavailable"
            default:
                return "Server error: \(code)"
            }
        case .networkError(let error):
            if let urlError = error as? URLError {
                switch urlError.code {
                case .notConnectedToInternet:
                    return "No internet connection"
                case .cannotFindHost:
                    return "Cannot find server - check the address"
                case .cannotConnectToHost:
                    return "Cannot connect to server - is it running?"
                case .timedOut:
                    return "Connection timed out"
                case .networkConnectionLost:
                    return "Network connection lost"
                default:
                    return urlError.localizedDescription
                }
            }
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

@MainActor
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
            print("[APIClient] No server configured")
            throw APIError.noServerConfigured
        }
        
        let url = baseURL.appendingPathComponent("api/sessions")
        print("[APIClient] Creating session at URL: \(url)")
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        do {
            request.httpBody = try encoder.encode(data)
            if let bodyString = String(data: request.httpBody ?? Data(), encoding: .utf8) {
                print("[APIClient] Request body: \(bodyString)")
            }
        } catch {
            print("[APIClient] Failed to encode session data: \(error)")
            throw error
        }
        
        do {
            let (responseData, response) = try await session.data(for: request)
            
            print("[APIClient] Response received")
            if let httpResponse = response as? HTTPURLResponse {
                print("[APIClient] Status code: \(httpResponse.statusCode)")
                print("[APIClient] Headers: \(httpResponse.allHeaderFields)")
            }
            
            if let responseString = String(data: responseData, encoding: .utf8) {
                print("[APIClient] Response body: \(responseString)")
            }
            
            try validateResponse(response)
            
            struct CreateResponse: Codable {
                let sessionId: String
            }
            
            let createResponse = try decoder.decode(CreateResponse.self, from: responseData)
            print("[APIClient] Session created with ID: \(createResponse.sessionId)")
            return createResponse.sessionId
        } catch {
            print("[APIClient] Request failed: \(error)")
            if let urlError = error as? URLError {
                print("[APIClient] URL Error code: \(urlError.code), description: \(urlError.localizedDescription)")
            }
            throw error
        }
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
        
        // Handle empty response (204 No Content) from Go server
        if data.isEmpty {
            return []
        }
        
        struct CleanupResponse: Codable {
            let cleanedSessions: [String]
        }
        
        do {
            let cleanupResponse = try decoder.decode(CleanupResponse.self, from: data)
            return cleanupResponse.cleanedSessions
        } catch {
            // If decoding fails, return empty array
            return []
        }
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
    
    func snapshotURL(for sessionId: String) -> URL? {
        guard let baseURL = baseURL else { return nil }
        return baseURL.appendingPathComponent("api/sessions/\(sessionId)/snapshot")
    }
    
    // MARK: - Helpers
    
    private func validateResponse(_ response: URLResponse) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            print("[APIClient] Invalid response type (not HTTP)")
            throw APIError.networkError(URLError(.badServerResponse))
        }
        
        guard 200..<300 ~= httpResponse.statusCode else {
            print("[APIClient] Server error: HTTP \(httpResponse.statusCode)")
            throw APIError.serverError(httpResponse.statusCode, nil)
        }
    }
}