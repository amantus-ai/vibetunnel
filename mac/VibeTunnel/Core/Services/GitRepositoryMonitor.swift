import Combine
import Foundation
import Observation

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

    /// Operation queue for rate limiting git operations
    private let gitOperationQueue = OperationQueue()

    /// Path to the git binary
    private let gitPath: String = {
        // Check common locations
        let locations = ["/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git"]
        for path in locations {
            if FileManager.default.fileExists(atPath: path) {
                return path
            }
        }
        return "/usr/bin/git" // fallback
    }()

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

    /// Find Git repository for a given file path and return its status
    /// - Parameter filePath: Path to a file within a potential Git repository
    /// - Returns: GitRepository information if found, nil otherwise
    public func findRepository(for filePath: String) async -> GitRepository? {
        // Validate path first
        guard validatePath(filePath) else {
            return nil
        }

        // Check cache first
        if let cached = getCachedRepository(for: filePath) {
            return cached
        }

        // Find the Git repository root
        guard let repoPath = await findGitRoot(from: filePath) else {
            return nil
        }

        // Check if we already have this repository cached
        let cachedRepo = repositoryCache[repoPath]
        if let cachedRepo {
            // Cache the file->repo mapping
            fileToRepoCache[filePath] = repoPath
            return cachedRepo
        }

        // Get repository status
        let repository = await getRepositoryStatus(at: repoPath)

        // Cache the result by repository path
        if let repository {
            cacheRepository(repository, originalFilePath: filePath)
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
        var currentPath = URL(fileURLWithPath: expandedPath)

        // If it's a file, start from its directory
        if !currentPath.hasDirectoryPath {
            currentPath = currentPath.deletingLastPathComponent()
        }

        // Search up the directory tree to the root
        while currentPath.path != "/" {
            let gitPath = currentPath.appendingPathComponent(".git")

            if FileManager.default.fileExists(atPath: gitPath.path) {
                return currentPath.path
            }

            currentPath = currentPath.deletingLastPathComponent()
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
                githubURL: cachedURL
            )
        } else {
            // Fetch GitHub URL in background (non-blocking)
            Task {
                fetchGitHubURLInBackground(for: repoPath)
            }
        }

        return repository
    }

    /// Get basic repository status without GitHub URL
    private nonisolated func getBasicGitStatus(at repoPath: String) async -> GitRepository? {
        await withCheckedContinuation { continuation in
            self.gitOperationQueue.addOperation {
                // Sanitize the path before using it
                guard let sanitizedPath = self.sanitizePath(repoPath) else {
                    continuation.resume(returning: nil)
                    return
                }

                let process = Process()
                process.executableURL = URL(fileURLWithPath: self.gitPath)
                process.arguments = ["status", "--porcelain", "--branch"]
                process.currentDirectoryURL = URL(fileURLWithPath: sanitizedPath)

                let outputPipe = Pipe()
                process.standardOutput = outputPipe
                process.standardError = Pipe() // Suppress error output

                do {
                    try process.run()
                    process.waitUntilExit()

                    guard process.terminationStatus == 0 else {
                        continuation.resume(returning: nil)
                        return
                    }

                    let outputData = outputPipe.fileHandleForReading.readDataToEndOfFile()
                    let output = String(data: outputData, encoding: .utf8) ?? ""

                    let result = Self.parseGitStatus(output: output, repoPath: repoPath)
                    continuation.resume(returning: result)
                } catch {
                    continuation.resume(returning: nil)
                }
            }
        }
    }

    /// Parse git status --porcelain output
    private nonisolated static func parseGitStatus(output: String, repoPath: String) -> GitRepository {
        let lines = output.split(separator: "\n")
        var currentBranch: String?
        var modifiedCount = 0
        var addedCount = 0
        var deletedCount = 0
        var untrackedCount = 0

        for line in lines {
            let trimmedLine = line.trimmingCharacters(in: .whitespaces)

            // Parse branch information (first line with --branch flag)
            if trimmedLine.hasPrefix("##") {
                let branchInfo = trimmedLine.dropFirst(2).trimmingCharacters(in: .whitespaces)
                // Extract branch name (format: "branch...tracking" or just "branch")
                if let branchEndIndex = branchInfo.firstIndex(of: ".") {
                    currentBranch = String(branchInfo[..<branchEndIndex])
                } else {
                    currentBranch = branchInfo
                }
                continue
            }

            // Skip empty lines
            guard trimmedLine.count >= 2 else { continue }

            // Get status code (first two characters)
            let statusCode = trimmedLine.prefix(2)

            // Count files based on status codes
            // ?? = untracked
            // M_ or _M = modified
            // A_ or _A = added to index
            // D_ or _D = deleted
            // R_ = renamed
            // C_ = copied
            // U_ = unmerged
            if statusCode == "??" {
                untrackedCount += 1
            } else if statusCode.contains("M") {
                modifiedCount += 1
            } else if statusCode.contains("A") {
                addedCount += 1
            } else if statusCode.contains("D") {
                deletedCount += 1
            } else if statusCode.contains("R") || statusCode.contains("C") {
                // Renamed/copied files count as modified
                modifiedCount += 1
            } else if statusCode.contains("U") {
                // Unmerged files count as modified
                modifiedCount += 1
            }
        }

        return GitRepository(
            path: repoPath,
            modifiedCount: modifiedCount,
            addedCount: addedCount,
            deletedCount: deletedCount,
            untrackedCount: untrackedCount,
            currentBranch: currentBranch
        )
    }

    /// Fetch GitHub URL in background and cache it
    @MainActor
    private func fetchGitHubURLInBackground(for repoPath: String) {
        // Check if already cached or fetch in progress
        if githubURLCache[repoPath] != nil || githubURLFetchesInProgress.contains(repoPath) {
            return
        }

        // Mark as in progress
        githubURLFetchesInProgress.insert(repoPath)

        // Fetch in background
        Task {
            gitOperationQueue.addOperation {
                if let githubURL = GitRepository.getGitHubURL(for: repoPath) {
                    Task { @MainActor in
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
                                githubURL: githubURL
                            )
                            self.repositoryCache[repoPath] = cachedRepo
                        }

                        // Remove from in-progress set
                        self.githubURLFetchesInProgress.remove(repoPath)
                    }
                } else {
                    Task { @MainActor in
                        // Remove from in-progress set even if fetch failed
                        self.githubURLFetchesInProgress.remove(repoPath)
                    }
                }
            }
        }
    }
}
