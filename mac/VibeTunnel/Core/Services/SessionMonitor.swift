import Foundation
import Observation

/// Server session information returned by the API
struct ServerSessionInfo: Codable {
    let id: String
    let command: String
    let workingDir: String
    let status: String
    let exitCode: Int?
    let startedAt: String
    let lastModified: String
    let pid: Int
    let activityStatus: ActivityStatus?

    var isRunning: Bool {
        status == "running"
    }
}

/// Activity status for a session
struct ActivityStatus: Codable {
    let isActive: Bool
    let specificStatus: SpecificStatus?
}

/// App-specific status (e.g., Claude status)
struct SpecificStatus: Codable {
    let app: String
    let status: String
}

/// Lightweight session monitor that fetches terminal sessions on-demand
@MainActor
@Observable
final class SessionMonitor {
    static let shared = SessionMonitor()

    private(set) var sessions: [String: ServerSessionInfo] = [:]
    private(set) var lastError: Error?

    private var lastFetch: Date?
    private let cacheInterval: TimeInterval = 2.0
    private let serverPort: Int
    private var localAuthToken: String?

    private init() {
        let port = UserDefaults.standard.integer(forKey: "serverPort")
        self.serverPort = port > 0 ? port : 4_020
    }

    /// Set the local auth token for server requests
    func setLocalAuthToken(_ token: String?) {
        self.localAuthToken = token
    }

    /// Number of running sessions
    var sessionCount: Int {
        sessions.values.count { $0.isRunning }
    }

    /// Get all sessions, using cache if available
    func getSessions() async -> [String: ServerSessionInfo] {
        // Use cache if available and fresh
        if let lastFetch, Date().timeIntervalSince(lastFetch) < cacheInterval {
            return sessions
        }

        await fetchSessions()
        return sessions
    }

    /// Force refresh session data
    func refresh() async {
        lastFetch = nil
        await fetchSessions()
    }

    // MARK: - Private Methods

    private func fetchSessions() async {
        do {
            // Get current port (might have changed)
            let port = UserDefaults.standard.integer(forKey: "serverPort")
            let actualPort = port > 0 ? port : serverPort

            guard let url = URL(string: "http://localhost:\(actualPort)/api/sessions") else {
                throw URLError(.badURL)
            }

            var request = URLRequest(url: url, timeoutInterval: 3.0)

            // Add Host header to ensure request is recognized as local
            request.setValue("localhost", forHTTPHeaderField: "Host")

            // Add local auth token if available
            if let token = localAuthToken {
                request.setValue(token, forHTTPHeaderField: "X-VibeTunnel-Local")
            }

            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200
            else {
                throw URLError(.badServerResponse)
            }

            let sessionsArray = try JSONDecoder().decode([ServerSessionInfo].self, from: data)

            // Convert to dictionary
            var sessionsDict: [String: ServerSessionInfo] = [:]
            for session in sessionsArray {
                sessionsDict[session.id] = session
            }

            self.sessions = sessionsDict
            self.lastError = nil
            self.lastFetch = Date()

            // Update WindowTracker
            WindowTracker.shared.updateFromSessions(sessionsArray)
        } catch {
            // Only update error if it's not a simple connection error
            if !(error is URLError) {
                self.lastError = error
            }
            self.sessions = [:]
            self.lastFetch = Date() // Still update timestamp to avoid hammering
        }
    }
}
