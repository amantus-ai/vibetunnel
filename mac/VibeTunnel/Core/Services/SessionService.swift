import Foundation
import Observation

/// Service for managing session-related API operations
@MainActor
@Observable
final class SessionService {
    private let serverManager: ServerManager
    private let sessionMonitor: SessionMonitor

    init(serverManager: ServerManager, sessionMonitor: SessionMonitor) {
        self.serverManager = serverManager
        self.sessionMonitor = sessionMonitor
    }

    /// Rename a session
    func renameSession(sessionId: String, to newName: String) async throws {
        let trimmedName = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else {
            throw SessionServiceError.invalidName
        }

        guard let url = URL(string: "http://127.0.0.1:\(serverManager.port)/api/sessions/\(sessionId)") else {
            throw SessionServiceError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("localhost", forHTTPHeaderField: "Host")
        try serverManager.authenticate(request: &request)

        let body = ["name": trimmedName]
        request.httpBody = try JSONEncoder().encode(body)

        let (_, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200
        else {
            throw SessionServiceError.requestFailed(statusCode: (response as? HTTPURLResponse)?.statusCode ?? -1)
        }

        // Force refresh the session monitor to see the update immediately
        await sessionMonitor.refresh()
    }

    /// Terminate a session
    func terminateSession(sessionId: String) async throws {
        guard let url = URL(string: "http://127.0.0.1:\(serverManager.port)/api/sessions/\(sessionId)") else {
            throw SessionServiceError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("localhost", forHTTPHeaderField: "Host")
        try serverManager.authenticate(request: &request)

        let (_, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 || httpResponse.statusCode == 204
        else {
            throw SessionServiceError.requestFailed(statusCode: (response as? HTTPURLResponse)?.statusCode ?? -1)
        }

        // The session monitor will automatically update via its polling mechanism
    }

    /// Create a new session
    func createSession(
        command: [String],
        workingDir: String,
        name: String? = nil,
        titleMode: String = "dynamic",
        spawnTerminal: Bool = false,
        cols: Int = 120,
        rows: Int = 30
    )
        async throws -> String
    {
        guard serverManager.isRunning else {
            throw SessionServiceError.serverNotRunning
        }

        guard let url = URL(string: "http://127.0.0.1:\(serverManager.port)/api/sessions") else {
            throw SessionServiceError.invalidURL
        }

        var body: [String: Any] = [
            "command": command,
            "workingDir": workingDir,
            "titleMode": titleMode
        ]

        if let name = name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
            body["name"] = name
        }

        if spawnTerminal {
            body["spawn_terminal"] = true
        } else {
            // Web sessions need terminal dimensions
            body["cols"] = cols
            body["rows"] = rows
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("localhost", forHTTPHeaderField: "Host")
        try serverManager.authenticate(request: &request)
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200
        else {
            var errorMessage = "Failed to create session"
            if let errorData = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let error = errorData["error"] as? String
            {
                errorMessage = error
            }
            throw SessionServiceError.createFailed(message: errorMessage)
        }

        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let sessionId = json["sessionId"] as? String
        else {
            throw SessionServiceError.invalidResponse
        }

        // Refresh session list
        await sessionMonitor.refresh()

        return sessionId
    }
}

/// Errors that can occur during session service operations
enum SessionServiceError: LocalizedError {
    case invalidName
    case invalidURL
    case serverNotRunning
    case requestFailed(statusCode: Int)
    case createFailed(message: String)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .invalidName:
            "Session name cannot be empty"
        case .invalidURL:
            "Invalid server URL"
        case .serverNotRunning:
            "Server is not running"
        case .requestFailed(let statusCode):
            "Request failed with status code: \(statusCode)"
        case .createFailed(let message):
            message
        case .invalidResponse:
            "Invalid server response"
        }
    }
}
