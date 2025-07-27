import Foundation
import Observation
import os.log
import UserNotifications

/// Server session information returned by the API.
///
/// Represents the current state of a terminal session running on the VibeTunnel server,
/// including its command, directory, process status, and activity information.
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
    let activityStatus: ActivityStatus?
    let source: String?
    let remoteId: String?
    let remoteName: String?
    let remoteUrl: String?

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

    /// Previous session states for exit detection
    private var previousSessions: [String: ServerSessionInfo] = [:]
    private var firstFetchDone = false

    /// Track last known activity state per session for Claude transition detection
    private var lastActivityState: [String: Bool] = [:]
    /// Sessions that have already triggered a "Your Turn" alert
    private var claudeIdleNotified: Set<String> = []

    /// Detect sessions that transitioned from running to not running
    static func detectEndedSessions(
        from old: [String: ServerSessionInfo],
        to new: [String: ServerSessionInfo]
    )
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

    /// Timer for periodic refresh
    private var refreshTimer: Timer?

    private init() {
        // Start periodic refresh
        startPeriodicRefresh()
    }

    /// Set the local auth token for server requests
    func setLocalAuthToken(_ token: String?) {}

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
            // Snapshot previous sessions for exit notifications
            let oldSessions = sessions

            let sessionsArray = try await serverManager.performRequest(
                endpoint: APIEndpoints.sessions,
                method: "GET",
                responseType: [ServerSessionInfo].self
            )

            // Convert to dictionary
            var sessionsDict: [String: ServerSessionInfo] = [:]
            for session in sessionsArray {
                sessionsDict[session.id] = session
            }

            self.sessions = sessionsDict
            self.lastError = nil

            // Notify for sessions that have just ended
            if firstFetchDone && UserDefaults.standard.bool(forKey: "showNotifications") {
                let ended = Self.detectEndedSessions(from: oldSessions, to: sessionsDict)
                for session in ended {
                    let id = session.id
                    let title = "Session Completed"
                    let displayName = session.name ?? session.command.joined(separator: " ")
                    let content = UNMutableNotificationContent()
                    content.title = title
                    content.body = displayName
                    content.sound = .default
                    let request = UNNotificationRequest(identifier: "session_\(id)", content: content, trigger: nil)
                    do {
                        try await UNUserNotificationCenter.current().add(request)
                    } catch {
                        self.logger
                            .error(
                                "Failed to deliver session notification: \(error.localizedDescription, privacy: .public)"
                            )
                    }
                }

                // Detect Claude "Your Turn" transitions
                await detectAndNotifyClaudeTurns(from: oldSessions, to: sessionsDict)
            }

            // Set firstFetchDone AFTER detecting ended sessions
            firstFetchDone = true
            self.lastFetch = Date()

            // Update WindowTracker
            WindowTracker.shared.updateFromSessions(sessionsArray)

            // Pre-cache Git data for all sessions (deduplicated by repository)
            if let gitMonitor = gitRepositoryMonitor {
                await preCacheGitRepositories(for: sessionsArray, using: gitMonitor)
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

    /// Pre-cache Git repositories for sessions, deduplicating by repository root
    private func preCacheGitRepositories(for sessions: [ServerSessionInfo], using gitMonitor: GitRepositoryMonitor) async {
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
                    if commonDevPaths.contains(component) && index < pathComponents.count - 1 {
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

        logger
            .debug(
                "Pre-caching Git data for \(uniqueDirectoriesToCheck.count) unique directories (from \(sessions.count) sessions)"
            )
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

    /// Detect and notify when Claude sessions transition from active to inactive ("Your Turn")
    private func detectAndNotifyClaudeTurns(
        from old: [String: ServerSessionInfo],
        to new: [String: ServerSessionInfo]
    )
        async
    {
        // Check if Claude notifications are enabled using ConfigManager
        let claudeNotificationsEnabled = ConfigManager.shared.notificationClaudeTurn
        guard claudeNotificationsEnabled else { return }

        for (id, newSession) in new {
            // Only process running sessions
            guard newSession.isRunning else { continue }

            // Check if this is a Claude session
            let isClaudeSession = newSession.activityStatus?.specificStatus?.app.lowercased()
                .contains("claude") ?? false ||
                newSession.command.joined(separator: " ").lowercased().contains("claude")

            guard isClaudeSession else { continue }

            // Get current activity state
            let currentActive = newSession.activityStatus?.isActive ?? false

            // Get previous activity state (from our tracking or old session data)
            let previousActive = lastActivityState[id] ?? (old[id]?.activityStatus?.isActive ?? false)

            // Reset when Claude speaks again
            if !previousActive && currentActive {
                claudeIdleNotified.remove(id)
            }

            // First active ➜ idle transition ⇒ alert
            let alreadyNotified = claudeIdleNotified.contains(id)
            if previousActive && !currentActive && !alreadyNotified {
                logger.info("🔔 Detected Claude transition to idle for session: \(id)")
                let sessionName = newSession.name ?? newSession.command.joined(separator: " ")
                await NotificationService.shared.sendCommandCompletionNotification(
                    command: sessionName,
                    duration: 0
                )
                claudeIdleNotified.insert(id)
            }

            // Update tracking *after* detection logic
            lastActivityState[id] = currentActive
        }

        // Clean up tracking for ended/closed sessions
        for id in lastActivityState.keys {
            if new[id] == nil || !(new[id]?.isRunning ?? false) {
                lastActivityState.removeValue(forKey: id)
                claudeIdleNotified.remove(id)
            }
        }
    }
}
