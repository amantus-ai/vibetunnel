import Foundation
import Observation
import os.log

/// Server session information returned by the API.
///
/// Represents the current state of a terminal session running on the VibeTunnel server,
/// including its command, directory, and process status.
struct ServerSessionInfo: Codable {
    let id: String
    let name: String
    let command: [String]
    let workingDir: String
    let status: String
    let exitCode: Int?
    let startedAt: String
    let pid: Int?
    let initialCols: Int?
    let initialRows: Int?
    let lastClearOffset: Int?
    let version: String?
    let gitRepoPath: String?
    let gitBranch: String?
    let gitAheadCount: Int?
    let gitBehindCount: Int?
    let gitHasChanges: Bool?
    let gitIsWorktree: Bool?
    let gitMainRepoPath: String?

    // Additional fields from Session (not SessionInfo)
    let lastModified: String
    let active: Bool?
    let source: String?
    let remoteId: String?
    let remoteName: String?
    let remoteUrl: String?
    let attachedViaVT: Bool?

    var isRunning: Bool {
        self.status == "running"
    }
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

    /// Previous session states for exit detection
    private var previousSessions: [String: ServerSessionInfo] = [:]
    private var firstFetchDone = false

    /// Detect sessions that transitioned from running to not running
    static func detectEndedSessions(
        from old: [String: ServerSessionInfo],
        to new: [String: ServerSessionInfo])
        -> [ServerSessionInfo]
    {
        old.compactMap { id, oldSession in
            if oldSession.isRunning,
               let updated = new[id], !updated.isRunning
            {
                return oldSession
            }
            return nil
        }
    }

    private(set) var sessions: [String: ServerSessionInfo] = [:]
    private(set) var lastError: Error?

    private var lastFetch: Date?
    private let cacheInterval: TimeInterval = 2.0
    private let serverManager = ServerManager.shared
    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "SessionMonitor")

    /// Reference to GitRepositoryMonitor for pre-caching
    weak var gitRepositoryMonitor: GitRepositoryMonitor?

    private init() {}

    /// Set the local auth token for server requests
    func setLocalAuthToken(_ token: String?) {}

    /// Number of running sessions
    var sessionCount: Int {
        self.sessions.values.count { $0.isRunning }
    }

    /// Get all sessions, using cache if available
    func getSessions() async -> [String: ServerSessionInfo] {
        // Use cache if available and fresh
        if let lastFetch, Date().timeIntervalSince(lastFetch) < cacheInterval {
            return self.sessions
        }

        await self.fetchSessions()
        return self.sessions
    }

    /// Force refresh session data
    func refresh() async {
        self.lastFetch = nil
        await self.fetchSessions()
    }

    // MARK: - Private Methods

    private func fetchSessions() async {
        do {
            // Snapshot previous sessions for exit notifications
            _ = self.sessions

            let sessionsArray = try await serverManager.performRequest(
                endpoint: APIEndpoints.sessions,
                method: "GET",
                responseType: [ServerSessionInfo].self)

            // Convert to dictionary
            var sessionsDict: [String: ServerSessionInfo] = [:]
            for session in sessionsArray {
                sessionsDict[session.id] = session
            }

            self.sessions = sessionsDict
            self.lastError = nil

            // Sessions have been updated

            // Set firstFetchDone AFTER detecting ended sessions
            self.firstFetchDone = true
            self.lastFetch = Date()

            // Update WindowTracker
            WindowTracker.shared.updateFromSessions(sessionsArray)

            // Pre-cache Git data for all sessions (deduplicated by repository)
            if let gitMonitor = gitRepositoryMonitor {
                await self.preCacheGitRepositories(for: sessionsArray, using: gitMonitor)
            }
        } catch {
            // Only update error if it's not a simple connection error
            if !(error is URLError) {
                self.lastError = error
            }
            self.logger.error("Failed to fetch sessions: \(error, privacy: .public)")
            self.sessions = [:]
            self.lastFetch = Date() // Still update timestamp to avoid hammering
        }
    }

    /// Pre-cache Git repositories for sessions, deduplicating by repository root
    private func preCacheGitRepositories(
        for sessions: [ServerSessionInfo],
        using gitMonitor: GitRepositoryMonitor)
        async
    {
        // Track unique directories we need to check
        var uniqueDirectoriesToCheck = Set<String>()

        // First, collect all unique directories that don't have cached data
        for session in sessions {
            // Skip if we already have cached data for this exact path
            if gitMonitor.getCachedRepository(for: session.workingDir) != nil {
                continue
            }

            // Add this directory to check
            uniqueDirectoriesToCheck.insert(session.workingDir)

            // Smart detection: Also check common parent directories
            // This helps when multiple sessions are in subdirectories of the same project
            let pathComponents = session.workingDir.split(separator: "/").map(String.init)

            // Check if this looks like a project directory pattern
            // Common patterns: /Users/*/Projects/*, /Users/*/Development/*, etc.
            if pathComponents.count >= 4 {
                // Check if we're in a common development directory
                let commonDevPaths = ["Projects", "Development", "Developer", "Code", "Work", "Source"]

                for (index, component) in pathComponents.enumerated() {
                    if commonDevPaths.contains(component), index < pathComponents.count - 1 {
                        // This might be a parent project directory
                        // Add the immediate child of the development directory
                        let potentialProjectPath = "/" + pathComponents[0...index + 1].joined(separator: "/")

                        // Only add if we don't have cached data for it
                        if gitMonitor.getCachedRepository(for: potentialProjectPath) == nil {
                            uniqueDirectoriesToCheck.insert(potentialProjectPath)
                        }
                    }
                }
            }
        }

        // Now check each unique directory only once
        for directory in uniqueDirectoriesToCheck {
            Task {
                // This will cache the data for immediate access later
                _ = await gitMonitor.findRepository(for: directory)
            }
        }

        self.logger
            .debug(
                "Pre-caching Git data for \(uniqueDirectoriesToCheck.count) unique directories (from \(sessions.count) sessions)")
    }
}
