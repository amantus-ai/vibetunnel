import Foundation
import Observation
import os.log

/// Server session information returned by the API.
///
/// Represents the current state of a terminal session running on the VibeTunnel server,
/// including its command, directory, process status, and activity information.
struct ServerSessionInfo: Codable {
    let id: String
    let command: [String] // Changed from String to [String] to match server
    let name: String? // Added missing field
    let workingDir: String
    let status: String
    let exitCode: Int?
    let startedAt: String
    let lastModified: String
    let pid: Int? // Made optional since it might not exist for all sessions
    let initialCols: Int? // Added missing field
    let initialRows: Int? // Added missing field
    let activityStatus: ActivityStatus?
    let source: String? // Added for HQ mode
    let attachedViaVT: Bool? // Added for VT attachment tracking

    var isRunning: Bool {
        status == "running"
    }
}

/// Activity status for a session.
///
/// Tracks whether a session is actively being used and provides
/// application-specific status information when available.
struct ActivityStatus: Codable {
    let isActive: Bool
    let specificStatus: SpecificStatus?
}

/// App-specific status information.
///
/// Provides detailed status information for specific applications running
/// within a terminal session, such as Claude's current working state.
struct SpecificStatus: Codable {
    let app: String
    let status: String
}

/// Lightweight session monitor that fetches terminal sessions on-demand.
///
/// Manages the collection of active terminal sessions by periodically polling
/// the server API and caching results for efficient access. Provides real-time
/// session information to the UI with minimal network overhead.
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
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "SessionMonitor")

    /// Reference to GitRepositoryMonitor for pre-caching
    weak var gitRepositoryMonitor: GitRepositoryMonitor?
    
    /// Timer for periodic refresh
    private var refreshTimer: Timer?

    private init() {
        let port = UserDefaults.standard.integer(forKey: "serverPort")
        self.serverPort = port > 0 ? port : 4_020
        
        // Start periodic refresh
        startPeriodicRefresh()
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

            // Pre-cache Git data for all sessions
            if let gitMonitor = gitRepositoryMonitor {
                for session in sessionsArray {
                    // Only fetch if not already cached
                    if gitMonitor.getCachedRepository(for: session.workingDir) == nil {
                        Task {
                            // This will cache the data for immediate access later
                            _ = await gitMonitor.findRepository(for: session.workingDir)
                        }
                    }
                }
            }
        } catch {
            // Only update error if it's not a simple connection error
            if !(error is URLError) {
                self.lastError = error
            }
            logger.error("Failed to fetch sessions: \(error, privacy: .public)")
            self.sessions = [:]
            self.lastFetch = Date() // Still update timestamp to avoid hammering
        }
    }
    
    /// Start periodic refresh of sessions
    private func startPeriodicRefresh() {
        // Clean up any existing timer
        refreshTimer?.invalidate()
        
        // Create a new timer that fires every 3 seconds
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                await self?.refresh()
            }
        }
    }
}
