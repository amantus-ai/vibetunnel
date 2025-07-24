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

        // Check cache first
        if let cached = getCachedRepository(for: filePath) {
            logger.debug("📦 Found cached repository for: \(filePath)")
            return cached
        }

        // Find the Git repository root
        guard let repoPath = await findGitRoot(from: filePath) else {
            logger.info("❌ No Git root found for: \(filePath)")
            return nil
        }

        logger.info("✅ Found Git root at: \(repoPath)")

        // Check if we already have this repository cached
        let cachedRepo = repositoryCache[repoPath]
        if let cachedRepo {
            // Cache the file->repo mapping
            fileToRepoCache[filePath] = repoPath
            logger.debug("📦 Using cached repo data for: \(repoPath)")
            return cachedRepo
        }

        // Get repository status
        let repository = await getRepositoryStatus(at: repoPath)

        // Cache the result by repository path
        if let repository {
            cacheRepository(repository, originalFilePath: filePath)
            logger.info("✅ Repository status obtained and cached for: \(repoPath)")
        } else {
            logger.error("❌ Failed to get repository status for: \(repoPath)")
        }

        return repository
    }

    /// Clear the repository cache
    public func clearCache() {
        repositoryCache.removeAll()
        fileToRepoCache.removeAll()
        githubURLCache.removeAll()
        githubURLFetchesInProgress.removeAll()
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

    // MARK: - Private Methods

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
