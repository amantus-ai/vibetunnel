import Foundation

// Server's actual session format
struct ServerSession: Codable {
    let id: String
    let name: String?
    let command: [String]  // Server uses array
    let workingDir: String  // Server uses workingDir
    let startedAt: Date  // Server uses startedAt
    let status: Session.SessionStatus
    let exitCode: Int?
    let pid: Int?
}

actor APIClient {
    static let shared = APIClient()
    
    private let session: URLSession
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()
    
    private init() {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 60
        self.session = URLSession(configuration: configuration)
        
        // Configure decoder for date handling
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let dateString = try container.decode(String.self)
            
            // Try ISO8601 with fractional seconds first
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatter.date(from: dateString) {
                return date
            }
            
            // Fallback to standard ISO8601
            formatter.formatOptions = [.withInternetDateTime]
            if let date = formatter.date(from: dateString) {
                return date
            }
            
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid date format")
        }
    }
    
    func fetchSessions(serverURL: URL, authHeader: String?) async throws -> [Session] {
        let url = serverURL.appendingPathComponent("api/sessions")
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        
        if let authHeader {
            request.setValue(authHeader, forHTTPHeaderField: "Authorization")
        }
        
        let (data, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
            httpResponse.statusCode == 200 else {
            throw APIError.invalidResponse
        }
        
        // Server returns an array directly, not wrapped in an object
        let serverSessions = try decoder.decode([ServerSession].self, from: data)
        
        // Convert server format to client format
        return serverSessions.map { serverSession in
            Session(
                id: serverSession.id,
                name: serverSession.name,
                command: serverSession.command.joined(separator: " "), // Server has array, client expects string
                cwd: serverSession.workingDir, // Server uses workingDir, client uses cwd
                createdAt: serverSession.startedAt, // Server uses startedAt, client uses createdAt
                status: serverSession.status,
                exitCode: serverSession.exitCode,
                pid: serverSession.pid
            )
        }
    }
    
    func createSession(
        serverURL: URL,
        authHeader: String?,
        command: String,
        workingDirectory: String,
        name: String?,
        spawnInNativeTerminal: Bool
    ) async throws -> CreateSessionResponse {
        let url = serverURL.appendingPathComponent("api/sessions")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        
        if let authHeader {
            request.setValue(authHeader, forHTTPHeaderField: "Authorization")
        }
        
        if spawnInNativeTerminal {
            request.setValue("true", forHTTPHeaderField: "X-Spawn-In-Native-Terminal")
        }
        
        let createRequest = CreateSessionRequest(
            command: command,
            cwd: workingDirectory,
            name: name
        )
        
        request.httpBody = try encoder.encode(createRequest)
        
        let (data, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
            httpResponse.statusCode == 200 || httpResponse.statusCode == 201 else {
            throw APIError.invalidResponse
        }
        
        return try decoder.decode(CreateSessionResponse.self, from: data)
    }
    
    func killSession(serverURL: URL, authHeader: String?, sessionId: String) async throws {
        let url = serverURL.appendingPathComponent("api/sessions/\(sessionId)")
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        
        if let authHeader {
            request.setValue(authHeader, forHTTPHeaderField: "Authorization")
        }
        
        let (_, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
            httpResponse.statusCode == 200 || httpResponse.statusCode == 204 else {
            throw APIError.invalidResponse
        }
    }
    
    func cleanupExitedSessions(serverURL: URL, authHeader: String?) async throws {
        let url = serverURL.appendingPathComponent("api/cleanup-exited")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        
        if let authHeader {
            request.setValue(authHeader, forHTTPHeaderField: "Authorization")
        }
        
        let (_, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
            httpResponse.statusCode == 200 || httpResponse.statusCode == 204 else {
            throw APIError.invalidResponse
        }
    }
    
    func sendInput(serverURL: URL, authHeader: String?, sessionId: String, input: String) async throws {
        let url = serverURL.appendingPathComponent("api/sessions/\(sessionId)/input")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("text/plain", forHTTPHeaderField: "Content-Type")
        
        if let authHeader {
            request.setValue(authHeader, forHTTPHeaderField: "Authorization")
        }
        
        request.httpBody = input.data(using: .utf8)
        
        let (_, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
            httpResponse.statusCode == 200 || httpResponse.statusCode == 204 else {
            throw APIError.invalidResponse
        }
    }
    
    func resizeTerminal(serverURL: URL, authHeader: String?, sessionId: String, cols: Int, rows: Int) async throws {
        let url = serverURL.appendingPathComponent("api/sessions/\(sessionId)/resize")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        if let authHeader {
            request.setValue(authHeader, forHTTPHeaderField: "Authorization")
        }
        
        let resizeRequest = ["cols": cols, "rows": rows]
        request.httpBody = try JSONSerialization.data(withJSONObject: resizeRequest)
        
        let (_, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
            httpResponse.statusCode == 200 || httpResponse.statusCode == 204 else {
            throw APIError.invalidResponse
        }
    }
    
    func getTerminalSnapshot(serverURL: URL, authHeader: String?, sessionId: String) async throws -> String {
        let url = serverURL.appendingPathComponent("api/sessions/\(sessionId)/snapshot")
        var request = URLRequest(url: url)
        request.setValue("text/plain", forHTTPHeaderField: "Accept")
        
        if let authHeader {
            request.setValue(authHeader, forHTTPHeaderField: "Authorization")
        }
        
        let (data, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
            httpResponse.statusCode == 200 else {
            throw APIError.invalidResponse
        }
        
        guard let snapshot = String(data: data, encoding: .utf8) else {
            throw APIError.decodingError
        }
        
        return snapshot
    }
}
