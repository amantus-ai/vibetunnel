import Combine
import Foundation
import Observation
import OSLog

// MARK: - Response Types

/// Response from the Git repository info API endpoint.
///
/// This lightweight response is used to quickly determine if a given path
/// is within a Git repository and find the repository root.
///
/// ## Usage
///
/// ```swift
/// let response = GitRepoInfoResponse(
///     isGitRepo: true,
///     repoPath: "/Users/developer/my-project"
/// )
/// ```
struct GitRepoInfoResponse: Codable {
    /// Indicates whether the path is within a Git repository.
    let isGitRepo: Bool

    /// The absolute path to the repository root.
    ///
    /// Only present when `isGitRepo` is `true`.
    let repoPath: String?
}

/// Comprehensive Git repository information response from the API.
///
/// Contains detailed status information about a Git repository including
/// file changes, branch status, and remote tracking information.
///
/// ## Topics
///
/// ### Repository Status
/// - ``isGitRepo``
/// - ``repoPath``
/// - ``hasChanges``
///
/// ### Branch Information
/// - ``currentBranch``
/// - ``remoteUrl``
/// - ``githubUrl``
/// - ``hasUpstream``
///
/// ### File Changes
/// - ``modifiedCount``
/// - ``untrackedCount``
/// - ``stagedCount``
/// - ``addedCount``
/// - ``deletedCount``
///
/// ### Sync Status
/// - ``aheadCount``
/// - ``behindCount``
struct GitRepositoryInfoResponse: Codable {
    /// Indicates whether this is a valid Git repository.
    let isGitRepo: Bool

    /// The absolute path to the repository root.
    ///
    /// Optional to handle cases where `isGitRepo` is false.
    let repoPath: String?

    /// The currently checked-out branch name.
    let currentBranch: String?

    /// The remote URL for the origin remote.
    let remoteUrl: String?

    /// The GitHub URL if this is a GitHub repository.
    ///
    /// Automatically derived from `remoteUrl` when it's a GitHub remote.
    let githubUrl: String?

    /// Whether the repository has any uncommitted changes.
    ///
    /// Optional for when `isGitRepo` is false.
    let hasChanges: Bool?

    /// Number of files with unstaged modifications.
    let modifiedCount: Int?

    /// Number of untracked files.
    let untrackedCount: Int?

    /// Number of files staged for commit.
    let stagedCount: Int?

    /// Number of new files added to the repository.
    let addedCount: Int?

    /// Number of files deleted from the repository.
    let deletedCount: Int?

    /// Number of commits ahead of the upstream branch.
    let aheadCount: Int?

    /// Number of commits behind the upstream branch.
    let behindCount: Int?

    /// Whether this branch has an upstream tracking branch.
    let hasUpstream: Bool?

    /// Whether this repository is a Git worktree.
    let isWorktree: Bool?
}

/// Monitors and caches Git repository status information for efficient UI updates.
///
/// `GitRepositoryMonitor` provides real-time Git repository information for terminal sessions
/// in VibeTunnel. It efficiently tracks repository states with intelligent caching to minimize
/// Git command executions while keeping the UI responsive.
@MainActor
@Observable
public final class GitRepositoryMonitor {
    // MARK: - Types

    /// Errors that can occur during Git operations
    public enum GitError: LocalizedError {
        case gitNotFound
        case invalidRepository
        case commandFailed(String)

        public var errorDescription: String? {
            switch self {
            case .gitNotFound:
                "Git command not found"
            case .invalidRepository:
                "Not a valid git repository"
            case .commandFailed(let error):
                "Git command failed: \(error)"
            }
        }
    }

    // MARK: - Lifecycle

    public init() {
        gitOperationQueue.maxConcurrentOperationCount = 3 // Limit concurrent git processes
    }

    // MARK: - Private Properties

    /// Logger for debugging
    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "GitRepositoryMonitor")

    /// Operation queue for rate limiting git operations
    private let gitOperationQueue = OperationQueue()

    /// Server manager for API requests
    private let serverManager = ServerManager.shared

    // MARK: - Public Methods

    /// Get cached repository information synchronously
    /// - Parameter filePath: Path to a file within a potential Git repository
    /// - Returns: Cached GitRepository information if available, nil otherwise
    public func getCachedRepository(for filePath: String) -> GitRepository? {
        guard let cachedRepoPath = fileToRepoCache[filePath],
              let cached = repositoryCache[cachedRepoPath]
        else {
            return nil
        }
        return cached
    }

    /// Get list of branches for a repository
    /// - Parameter repoPath: Path to the Git repository
    /// - Returns: Array of branch names (without refs/heads/ prefix)
    public func getBranches(for repoPath: String) async -> [String] {
        do {
            // Define the branch structure we expect from the server
            // Represents a Git branch from the server API.
            struct Branch: Codable {
                /// The branch name (e.g., "main", "feature/login").
                let name: String
                /// Whether this is the currently checked-out branch.
                let current: Bool
                /// Whether this is a remote tracking branch.
                let remote: Bool
                /// Path to the worktree using this branch, if any.
                let worktreePath: String?
            }

            let branches = try await serverManager.performRequest(
                endpoint: "/api/repositories/branches",
                method: "GET",
                queryItems: [URLQueryItem(name: "path", value: repoPath)],
                responseType: [Branch].self
            )

            // Filter to local branches only and extract names
            let localBranchNames = branches
                .filter { !$0.remote }
                .map(\.name)

            logger.debug("Retrieved \(localBranchNames.count) local branches from server")
            return localBranchNames
        } catch {
            logger.error("Failed to get branches from server: \(error)")
            return []
        }
    }

    /// Find Git repository for a given file path and return its status
    /// - Parameter filePath: Path to a file within a potential Git repository
    /// - Returns: GitRepository information if found, nil otherwise
    public func findRepository(for filePath: String) async -> GitRepository? {
        logger.info("🔍 findRepository called for: \(filePath)")

        // Validate path first
        guard validatePath(filePath) else {
            logger.warning("❌ Path validation failed for: \(filePath)")
            return nil
        }

        // Check if this path was recently confirmed as non-Git
        if let nonGitCheck = nonGitPathCache[filePath],
           Date().timeIntervalSince(nonGitCheck) < 600.0
        { // 10 minutes for non-Git paths
            logger.debug("⏭️ Skipping known non-Git path: \(filePath)")
            return nil
        }

        // Check cache first
        if let cached = getCachedRepository(for: filePath) {
            logger.debug("📦 Found cached repository for: \(filePath)")

            // Use longer cache duration for common parent directories
            let cacheThreshold = isCommonParentDirectory(filePath) ? 300.0 :
                recentCheckThreshold // 5 minutes vs 30 seconds

            // Check if this was recently checked
            if let lastCheck = recentRepositoryChecks[filePath],
               Date().timeIntervalSince(lastCheck) < cacheThreshold
            {
                logger
                    .debug(
                        "⏭️ Skipping redundant check for: \(filePath) (checked \(Int(Date().timeIntervalSince(lastCheck)))s ago, threshold: \(Int(cacheThreshold))s)"
                    )
                return cached
            }
        }

        // Check if there's already a pending request for this exact path
        if let pendingTask = pendingRepositoryRequests[filePath] {
            logger.debug("🔄 Waiting for existing request for: \(filePath)")
            return await pendingTask.value
        }

        // Create a new task for this request
        let task = Task<GitRepository?, Never> { [weak self] in
            guard let self else { return nil }

            // Find the Git repository root
            guard let repoPath = await self.findGitRoot(from: filePath) else {
                logger.info("❌ No Git root found for: \(filePath)")
                // Mark as recently checked even for non-git paths to avoid repeated checks
                // Use longer cache for common parent directories that aren't Git repos
                await MainActor.run {
                    self.recentRepositoryChecks[filePath] = Date()
                    // Cache the negative result for parent directories longer
                    if self.isCommonParentDirectory(filePath) {
                        // Store as a "non-git" marker for 10 minutes
                        self.nonGitPathCache[filePath] = Date()
                    }
                }
                return nil
            }

            logger.info("✅ Found Git root at: \(repoPath)")

            // Check if we already have this repository cached
            let cachedRepo = await MainActor.run { self.repositoryCache[repoPath] }
            if let cachedRepo {
                // Cache the file->repo mapping
                await MainActor.run {
                    self.fileToRepoCache[filePath] = repoPath
                    self.recentRepositoryChecks[filePath] = Date()
                }
                logger.debug("📦 Using cached repo data for: \(repoPath)")
                return cachedRepo
            }

            // Get repository status
            let repository = await self.getRepositoryStatus(at: repoPath)

            // Cache the result by repository path
            if let repository {
                await MainActor.run {
                    self.cacheRepository(repository, originalFilePath: filePath)
                    self.recentRepositoryChecks[filePath] = Date()
                }
                logger.info("✅ Repository status obtained and cached for: \(repoPath)")
            } else {
                logger.error("❌ Failed to get repository status for: \(repoPath)")
            }

            return repository
        }

        // Store the pending task
        pendingRepositoryRequests[filePath] = task

        // Get the result
        let result = await task.value

        // Clean up the pending task
        pendingRepositoryRequests[filePath] = nil

        return result
    }

    /// Clear the repository cache
    public func clearCache() {
        repositoryCache.removeAll()
        fileToRepoCache.removeAll()
        githubURLCache.removeAll()
        githubURLFetchesInProgress.removeAll()
        pendingRepositoryRequests.removeAll()
        recentRepositoryChecks.removeAll()
        nonGitPathCache.removeAll()
    }

    /// Start monitoring and refreshing all cached repositories
    public func startMonitoring() {
        stopMonitoring()

        // Set up periodic refresh of all cached repositories
        monitoringTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { _ in
            Task { @MainActor in
                await self.refreshAllCached()
            }
        }
    }

    /// Stop monitoring
    public func stopMonitoring() {
        monitoringTimer?.invalidate()
        monitoringTimer = nil
    }

    // MARK: - Private Methods

    /// Refresh all cached repositories
    private func refreshAllCached() async {
        let repoPaths = Array(repositoryCache.keys)
        for repoPath in repoPaths {
            if let fresh = await getRepositoryStatus(at: repoPath) {
                repositoryCache[repoPath] = fresh
            }
        }

        // Clean up stale entries from recent checks cache
        cleanupRecentChecks()
    }

    /// Remove old entries from the recent checks cache
    private func cleanupRecentChecks() {
        let cutoffDate = Date().addingTimeInterval(-recentCheckThreshold * 2) // Remove entries older than 60 seconds
        recentRepositoryChecks = recentRepositoryChecks.filter { _, checkDate in
            checkDate > cutoffDate
        }

        // Also cleanup non-Git path cache (remove entries older than 10 minutes)
        let nonGitCutoff = Date().addingTimeInterval(-600.0)
        nonGitPathCache = nonGitPathCache.filter { _, checkDate in
            checkDate > nonGitCutoff
        }

        logger
            .debug(
                "🧹 Cleaned up caches: \(self.recentRepositoryChecks.count) recent checks, \(self.nonGitPathCache.count) non-Git paths"
            )
    }

    // MARK: - Private Properties

    /// Cache for repository information by repository path (not file path)
    private var repositoryCache: [String: GitRepository] = [:]

    /// Cache mapping file paths to their repository paths
    private var fileToRepoCache: [String: String] = [:]

    /// Cache for GitHub URLs by repository path
    private var githubURLCache: [String: URL] = [:]

    /// Set to track in-progress GitHub URL fetches to prevent duplicates
    private var githubURLFetchesInProgress: Set<String> = []

    /// Timer for periodic monitoring
    private var monitoringTimer: Timer?

    /// Tracks in-flight requests for repository lookups to prevent duplicates
    private var pendingRepositoryRequests: [String: Task<GitRepository?, Never>] = [:]

    /// Tracks recent repository checks with timestamps to skip redundant checks
    private var recentRepositoryChecks: [String: Date] = [:]

    /// Cache for paths that are confirmed NOT to be Git repositories (to avoid repeated filesystem checks)
    private var nonGitPathCache: [String: Date] = [:]

    /// Duration to consider a repository check as "recent" (30 seconds)
    private let recentCheckThreshold: TimeInterval = 30.0

    // MARK: - Private Methods

    /// Check if a path is a common parent directory that should have longer cache duration
    private func isCommonParentDirectory(_ path: String) -> Bool {
        let pathComponents = path.split(separator: "/").map(String.init)

        // Check if this is a common development parent directory
        let commonDevPaths = ["Projects", "Development", "Developer", "Code", "Work", "Source", "Workspace", "Repos"]

        // If the path ends with one of these common directory names, it's likely a parent
        if let lastComponent = pathComponents.last,
           commonDevPaths.contains(lastComponent)
        {
            return true
        }

        // Also check for patterns like /Users/username/Projects
        if pathComponents.count == 3,
           pathComponents[0] == "Users",
           commonDevPaths.contains(pathComponents[2])
        {
            return true
        }

        return false
    }

    private func cacheRepository(_ repository: GitRepository, originalFilePath: String? = nil) {
        repositoryCache[repository.path] = repository

        // Also map the original file path if different from repository path
        if let originalFilePath, originalFilePath != repository.path {
            fileToRepoCache[originalFilePath] = repository.path
        }
    }

    /// Validate and sanitize paths
    private func validatePath(_ path: String) -> Bool {
        let expandedPath = NSString(string: path).expandingTildeInPath
        let url = URL(fileURLWithPath: expandedPath)
        // Ensure path is absolute and exists
        return url.path.hasPrefix("/") && FileManager.default.fileExists(atPath: url.path)
    }

    /// Sanitize path for safe shell execution
    private nonisolated func sanitizePath(_ path: String) -> String? {
        let expandedPath = NSString(string: path).expandingTildeInPath
        let url = URL(fileURLWithPath: expandedPath)

        // Validate it's an absolute path and exists
        guard url.path.hasPrefix("/"),
              FileManager.default.fileExists(atPath: url.path)
        else {
            return nil
        }

        // Return raw path - Process doesn't need shell escaping
        return url.path
    }

    /// Find the Git repository root starting from a given path
    private nonisolated func findGitRoot(from path: String) async -> String? {
        let expandedPath = NSString(string: path).expandingTildeInPath

        // Use HTTP endpoint to check if it's a git repository
        let url = await MainActor.run {
            serverManager.buildURL(
                endpoint: "/api/git/repo-info",
                queryItems: [URLQueryItem(name: "path", value: expandedPath)]
            )
        }

        guard let url else {
            return nil
        }

        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let decoder = JSONDecoder()
            let response = try decoder.decode(GitRepoInfoResponse.self, from: data)

            if response.isGitRepo {
                return response.repoPath
            }
        } catch {
            logger.error("❌ Failed to get git repo info: \(error)")
        }

        return nil
    }

    /// Get repository status by running git status
    private func getRepositoryStatus(at repoPath: String) async -> GitRepository? {
        // First get the basic git status
        let basicRepository = await getBasicGitStatus(at: repoPath)

        guard var repository = basicRepository else {
            return nil
        }

        // Check if we have a cached GitHub URL
        if let cachedURL = githubURLCache[repoPath] {
            repository = GitRepository(
                path: repository.path,
                modifiedCount: repository.modifiedCount,
                addedCount: repository.addedCount,
                deletedCount: repository.deletedCount,
                untrackedCount: repository.untrackedCount,
                currentBranch: repository.currentBranch,
                aheadCount: repository.aheadCount,
                behindCount: repository.behindCount,
                trackingBranch: repository.trackingBranch,
                isWorktree: repository.isWorktree,
                githubURL: cachedURL
            )
        } else {
            // Fetch GitHub URL from remote endpoint or local git command
            Task {
                await fetchGitHubURLInBackground(for: repoPath)
            }
        }

        return repository
    }

    /// Get basic repository status without GitHub URL
    private nonisolated func getBasicGitStatus(at repoPath: String) async -> GitRepository? {
        // Use HTTP endpoint to get git status
        let url = await MainActor.run {
            serverManager.buildURL(
                endpoint: "/api/git/repository-info",
                queryItems: [URLQueryItem(name: "path", value: repoPath)]
            )
        }

        guard let url else {
            return nil
        }

        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let decoder = JSONDecoder()
            let response = try decoder.decode(GitRepositoryInfoResponse.self, from: data)

            if !response.isGitRepo {
                return nil
            }

            // Ensure we have required fields when isGitRepo is true
            guard let repoPath = response.repoPath else {
                logger.error("❌ Invalid response: isGitRepo is true but repoPath is missing")
                return nil
            }

            // Use worktree status from server response
            let isWorktree = response.isWorktree ?? false

            // Parse GitHub URL if provided
            let githubURL = response.githubUrl.flatMap { URL(string: $0) }

            return GitRepository(
                path: repoPath,
                modifiedCount: response.modifiedCount ?? 0,
                addedCount: response.addedCount ?? 0,
                deletedCount: response.deletedCount ?? 0,
                untrackedCount: response.untrackedCount ?? 0,
                currentBranch: response.currentBranch,
                aheadCount: (response.aheadCount ?? 0) > 0 ? response.aheadCount : nil,
                behindCount: (response.behindCount ?? 0) > 0 ? response.behindCount : nil,
                trackingBranch: (response.hasUpstream ?? false) ? "origin/\(response.currentBranch ?? "main")" : nil,
                isWorktree: isWorktree,
                githubURL: githubURL
            )
        } catch {
            logger.error("❌ Failed to get git status: \(error)")
            return nil
        }
    }

    /// Fetch GitHub URL in background and cache it
    @MainActor
    private func fetchGitHubURLInBackground(for repoPath: String) async {
        // Check if already cached or fetch in progress
        if githubURLCache[repoPath] != nil || githubURLFetchesInProgress.contains(repoPath) {
            return
        }

        // Mark as in progress
        githubURLFetchesInProgress.insert(repoPath)

        // Try to get from HTTP endpoint first
        let url = await MainActor.run {
            serverManager.buildURL(
                endpoint: "/api/git/remote",
                queryItems: [URLQueryItem(name: "path", value: repoPath)]
            )
        }

        if let url {
            do {
                let (data, _) = try await URLSession.shared.data(from: url)
                let decoder = JSONDecoder()
                // Response from the Git remote API endpoint.
                struct RemoteResponse: Codable {
                    /// Whether this is a valid Git repository.
                    let isGitRepo: Bool
                    /// The absolute path to the repository root.
                    let repoPath: String?
                    /// The remote origin URL.
                    let remoteUrl: String?
                    /// The GitHub URL if this is a GitHub repository.
                    let githubUrl: String?
                }
                let response = try decoder.decode(RemoteResponse.self, from: data)

                if let githubUrlString = response.githubUrl,
                   let githubURL = URL(string: githubUrlString)
                {
                    self.githubURLCache[repoPath] = githubURL

                    // Update cached repository with GitHub URL
                    if var cachedRepo = self.repositoryCache[repoPath] {
                        cachedRepo = GitRepository(
                            path: cachedRepo.path,
                            modifiedCount: cachedRepo.modifiedCount,
                            addedCount: cachedRepo.addedCount,
                            deletedCount: cachedRepo.deletedCount,
                            untrackedCount: cachedRepo.untrackedCount,
                            currentBranch: cachedRepo.currentBranch,
                            aheadCount: cachedRepo.aheadCount,
                            behindCount: cachedRepo.behindCount,
                            trackingBranch: cachedRepo.trackingBranch,
                            isWorktree: cachedRepo.isWorktree,
                            githubURL: githubURL
                        )
                        self.repositoryCache[repoPath] = cachedRepo
                    }
                }
            } catch {
                // HTTP endpoint failed, log the error but don't fallback to direct git
                logger.debug("Failed to fetch GitHub URL from server: \(error)")
            }
        }

        // Remove from in-progress set
        self.githubURLFetchesInProgress.remove(repoPath)
    }
}
