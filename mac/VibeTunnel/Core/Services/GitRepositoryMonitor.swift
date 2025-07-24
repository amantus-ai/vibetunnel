import Combine
import Foundation
import Observation
import OSLog

// MARK: - Response Types

struct GitRepoInfoResponse: Codable {
    let isGitRepo: Bool
    let repoPath: String?
}

struct GitRepositoryInfoResponse: Codable {
    let isGitRepo: Bool
    let repoPath: String
    let currentBranch: String?
    let remoteUrl: String?
    let hasChanges: Bool
    let modifiedCount: Int
    let untrackedCount: Int
    let stagedCount: Int
    let addedCount: Int
    let deletedCount: Int
    let aheadCount: Int
    let behindCount: Int
    let hasUpstream: Bool
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
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "GitRepositoryMonitor")

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
        // Use the server endpoint to get branches
        guard let url = serverManager.buildURL(
            endpoint: "/api/repositories/branches",
            queryItems: [URLQueryItem(name: "path", value: repoPath)]
        ) else {
            logger.error("Failed to construct branches URL")
            return []
        }

        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let decoder = JSONDecoder()

            // Define the branch structure we expect from the server
            struct Branch: Codable {
                let name: String
                let current: Bool
                let remote: Bool
                let worktreePath: String?
            }

            let branches = try decoder.decode([Branch].self, from: data)

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
        print("🔍 [GitRepositoryMonitor] findRepository called for: \(filePath)")

        // Validate path first
        guard validatePath(filePath) else {
            print("❌ [GitRepositoryMonitor] Path validation failed for: \(filePath)")
            return nil
        }

        // Check cache first
        if let cached = getCachedRepository(for: filePath) {
            print("📦 [GitRepositoryMonitor] Found cached repository for: \(filePath)")
            return cached
        }

        // Find the Git repository root
        guard let repoPath = await findGitRoot(from: filePath) else {
            print("❌ [GitRepositoryMonitor] No Git root found for: \(filePath)")
            return nil
        }

        print("✅ [GitRepositoryMonitor] Found Git root at: \(repoPath)")

        // Check if we already have this repository cached
        let cachedRepo = repositoryCache[repoPath]
        if let cachedRepo {
            // Cache the file->repo mapping
            fileToRepoCache[filePath] = repoPath
            print("📦 [GitRepositoryMonitor] Using cached repo data for: \(repoPath)")
            return cachedRepo
        }

        // Get repository status
        let repository = await getRepositoryStatus(at: repoPath)

        // Cache the result by repository path
        if let repository {
            cacheRepository(repository, originalFilePath: filePath)
            print("✅ [GitRepositoryMonitor] Repository status obtained and cached for: \(repoPath)")
        } else {
            print("❌ [GitRepositoryMonitor] Failed to get repository status for: \(repoPath)")
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
            print("❌ [GitRepositoryMonitor] Failed to get git repo info: \(error)")
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

            // Check if this is a worktree by looking for .git file instead of directory
            let isWorktree = Self.checkIfWorktree(at: response.repoPath)

            return GitRepository(
                path: response.repoPath,
                modifiedCount: response.modifiedCount,
                addedCount: response.addedCount,
                deletedCount: response.deletedCount,
                untrackedCount: response.untrackedCount,
                currentBranch: response.currentBranch,
                aheadCount: response.aheadCount > 0 ? response.aheadCount : nil,
                behindCount: response.behindCount > 0 ? response.behindCount : nil,
                trackingBranch: response.hasUpstream ? "origin/\(response.currentBranch ?? "main")" : nil,
                isWorktree: isWorktree
            )
        } catch {
            print("❌ [GitRepositoryMonitor] Failed to get git status: \(error)")
            return nil
        }
    }

    /// Check if the given path is a Git worktree
    private nonisolated static func checkIfWorktree(at path: String) -> Bool {
        let gitPath = URL(fileURLWithPath: path).appendingPathComponent(".git")

        // In a worktree, .git is a file containing the path to the real .git directory
        // In a regular repository, .git is a directory
        var isDirectory: ObjCBool = false
        if FileManager.default.fileExists(atPath: gitPath.path, isDirectory: &isDirectory) {
            return !isDirectory.boolValue
        }

        return false
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
                struct RemoteResponse: Codable {
                    let isGitRepo: Bool
                    let repoPath: String?
                    let remoteUrl: String?
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
