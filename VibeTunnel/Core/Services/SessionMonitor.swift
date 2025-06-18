import Foundation
import Observation

/// Monitors tty-fwd sessions and provides real-time session count.
///
/// `SessionMonitor` is a singleton that periodically polls the local server to track active terminal sessions.
/// It maintains a count of running sessions and provides detailed information about each session.
/// The monitor automatically starts and stops based on server lifecycle events.
@MainActor
@Observable
class SessionMonitor {
    static let shared = SessionMonitor()

    var sessionCount: Int = 0
    var sessions: [String: SessionInfo] = [:]
    var lastError: String?

    private var monitoringTask: Task<Void, Never>?
    private let refreshInterval: TimeInterval = 5.0 // Check every 5 seconds
    private var serverPort: Int

    /// Information about a terminal session.
    ///
    /// Contains detailed metadata about a tty-fwd session including its process information,
    /// status, and I/O stream paths.
    struct SessionInfo: Codable {
        let id: String
        let command: String
        let workingDir: String
        let status: String
        let exitCode: Int?
        let startedAt: String
        let lastModified: String
        let pid: Int

        var isRunning: Bool {
            status == "running"
        }
    }

    private init() {
        let port = UserDefaults.standard.integer(forKey: "serverPort")
        self.serverPort = port > 0 ? port : 4_020
    }

    func startMonitoring() {
        stopMonitoring()

        // Update port from UserDefaults in case it changed
        let port = UserDefaults.standard.integer(forKey: "serverPort")
        self.serverPort = port > 0 ? port : 4_020

        // Start monitoring task
        monitoringTask = Task {
            // Initial fetch
            await fetchSessions()

            // Set up periodic fetching
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(refreshInterval))
                if !Task.isCancelled {
                    await fetchSessions()
                }
            }
        }
    }

    func stopMonitoring() {
        monitoringTask?.cancel()
        monitoringTask = nil
    }

    @MainActor
    private func fetchSessions() async {
        do {
            // First check if server is running
            guard let healthURL = URL(string: "http://127.0.0.1:\(serverPort)/api/health") else {
                self.sessions = [:]
                self.sessionCount = 0
                self.lastError = nil
                return
            }
            let healthRequest = URLRequest(url: healthURL, timeoutInterval: 2.0)

            do {
                let (_, healthResponse) = try await URLSession.shared.data(for: healthRequest)
                guard let httpResponse = healthResponse as? HTTPURLResponse,
                      httpResponse.statusCode == 200
                else {
                    // Server not running
                    self.sessions = [:]
                    self.sessionCount = 0
                    self.lastError = nil
                    return
                }
            } catch {
                // Server not reachable
                self.sessions = [:]
                self.sessionCount = 0
                self.lastError = nil
                return
            }

            // Server is running, fetch sessions
            guard let url = URL(string: "http://127.0.0.1:\(serverPort)/api/sessions") else {
                self.lastError = "Invalid URL"
                return
            }
            let request = URLRequest(url: url, timeoutInterval: 5.0)
            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200
            else {
                self.lastError = "Failed to fetch sessions"
                return
            }

            // Parse JSON response as an array
            let sessionsArray = try JSONDecoder().decode([SessionInfo].self, from: data)

            // Convert array to dictionary using session id as key
            var sessionsDict: [String: SessionInfo] = [:]
            for session in sessionsArray {
                sessionsDict[session.id] = session
            }

            self.sessions = sessionsDict

            // Count only running sessions
            self.sessionCount = sessionsArray.count { $0.isRunning }
            self.lastError = nil
        } catch {
            // Don't set error for connection issues when server is likely not running
            if !(error is URLError) {
                self.lastError = "Error fetching sessions: \(error.localizedDescription)"
            }
            // Clear sessions on error
            self.sessions = [:]
            self.sessionCount = 0
        }
    }

    func refreshNow() async {
        await fetchSessions()
    }
}
